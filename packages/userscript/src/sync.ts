import "./global";
import { type FinishedSyncBody } from "@bank-scraper/shared";
import { z } from "zod/mini";

import {
	click,
	humanLikeInput,
	pauseAfterLoad,
	pauseBeforePress,
	scrollToBottom,
	scrollToElement,
} from "./input";
import { requestServer } from "./server";

// iPKO's class names are generated, so these lean on structure, roles and attributes
const selectors = {
	/** The tabs above the history's filter form exist only on the transaction history */
	historyPage: "div:has(div[role='tablist']) ~ div:has(form)",
	/** "From" and "to" of the history filter, in this order */
	dateInputs: "input[type='calendar'][calendararialabel][readonly]",
	datePicker: "div[role='datepicker']",
	/** Switches the open date picker to its years */
	pickerYearsButton: "button[data-text='CALENDAR:CURRENT_DATE']",
	pickerPreviousButton: "button#calendar_arrow_left",
	pickerNextButton: "button#calendar_arrow_right",
	table: "form table",
	loadMore: "form button[value='next']",
};

/** How far before the last finished sync Auto-Sync starts, for transactions iPKO adds late */
const overlapDays = 30;
const tableUpdateTimeoutMs = 10_000;
const elementTimeoutMs = 5000;

const syncedThroughSchema = z.object({ syncedThrough: z.nullable(z.string()) });
const versionSchema = z.object({ version: z.nullable(z.string()) });

/** A date as `YYYY-MM-DD` */
type IsoDate = string;

const isoDate = (date: Date): IsoDate =>
	[
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");

const today = () => isoDate(new Date());

function addDays(date: IsoDate, days: number): IsoDate {
	const [year, month, day] = date.split("-").map(Number);
	return isoDate(new Date(year, month - 1, day + days));
}

/** Reads `Від: 12.07.2026`, `Od: 12.07.2026` or `From: 12.07.2026`, whatever the language */
function parseInputDate(value: string): IsoDate | undefined {
	const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
	return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

const formatDate = (date: IsoDate) => date.split("-").toReversed().join(".");

const pagesText = (count: number) => `${count} ${count === 1 ? "page" : "pages"}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(find: () => T | null | undefined, what: string): Promise<T> {
	const deadline = Date.now() + elementTimeoutMs;
	for (;;) {
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) throw new Error(`Did not find ${what} on the page`);
		await sleep(100);
	}
}

/**
 * Resolves to `true` once rows were added to the table and no more arrived for a moment, or to
 * `false` when none arrived in time. Start it before the action that updates the table.
 */
function waitForTableUpdate(): Promise<boolean> {
	const table = document.querySelector(selectors.table);
	if (!table) return Promise.resolve(false);

	return new Promise((resolve) => {
		let settled: ReturnType<typeof setTimeout> | undefined;

		const finish = (updated: boolean) => {
			observer.disconnect();
			clearTimeout(timeout);
			clearTimeout(settled);
			resolve(updated);
		};

		const observer = new MutationObserver((records) => {
			if (!records.some((record) => record.addedNodes.length)) return;
			clearTimeout(timeout);
			clearTimeout(settled);
			// React can render one page of rows in several commits
			settled = setTimeout(() => finish(true), 300);
		});
		observer.observe(table, { childList: true, subtree: true });

		const timeout = setTimeout(() => finish(false), tableUpdateTimeoutMs);
	});
}

type Sync = {
	accountNumber: string;
	stopped: boolean;
	/** Why the sync has to stop, found outside its own steps */
	failure?: string;
	pages: number;
	oldestDate?: IsoDate;
	pendingStores: Set<Promise<boolean>>;
	showProgress: () => void;
};

let lastAccountNumber: string | undefined;
let currentSync: Sync | undefined;

class SyncStopped extends Error {}

/** Throws when the sync has to end before its next step */
function checkpoint(sync: Sync) {
	if (sync.stopped) throw new SyncStopped();
	if (sync.failure) throw new Error(sync.failure);
	if (!document.querySelector(selectors.historyPage)) {
		throw new Error("The page left the transaction history");
	}
}

/**
 * Records a page of transactions that the site loaded, and the promise of storing it. It tells the
 * sync which account the history shows, how far back it got, and whether storing failed.
 */
export function trackOperationsPage(
	accountNumber: string,
	oldestDate: IsoDate | undefined,
	stored: Promise<boolean>,
) {
	lastAccountNumber = accountNumber;

	const sync = currentSync;
	if (!sync) return;

	if (accountNumber !== sync.accountNumber) {
		sync.failure ??= "The history switched to another account";
	}
	if (oldestDate && (!sync.oldestDate || oldestDate < sync.oldestDate)) {
		sync.oldestDate = oldestDate;
		sync.showProgress();
	}

	sync.pendingStores.add(stored);
	void stored
		.catch(() => false)
		.then((ok) => {
			if (!ok)
				sync.failure ??= "A page of transactions was not stored on the server, see the console";
		})
		.finally(() => sync.pendingStores.delete(stored));
}

/** Records a page of transactions of an account the page did not list, which was not stored */
export function reportUnknownAccount() {
	lastAccountNumber = undefined;
	if (currentSync)
		currentSync.failure ??= "The page did not list the account of the history, reload it";
}

const pickerQuery = (selector: string) =>
	document.querySelector(`${selectors.datePicker} ${selector}`);

const pickerOptions = (kind: "year" | "month" | "day") =>
	Array.from(
		document.querySelectorAll(`${selectors.datePicker} label:has(input[name='${kind}'])`),
	).map((label) => ({
		label,
		// e.g. `month_2026-06-19`: a month or year option carries some day of it
		value: label.getAttribute("aria-labelledby")?.replace(`${kind}_`, "") ?? "",
		enabled: label.querySelector(`input[name='${kind}'][aria-disabled='false']`) !== null,
	}));

/** Clicks the picker's option whose date starts with `prefix` */
async function pickOption(sync: Sync, kind: "year" | "month" | "day", prefix: string) {
	const options = await waitFor(() => {
		const found = pickerOptions(kind);
		return found.length ? found : undefined;
	}, `the ${kind}s of the date picker`);

	const option = options.find(({ value }) => value.startsWith(prefix));
	if (!option?.enabled) throw new Error(`The date picker does not offer the ${kind} ${prefix}`);

	await pauseBeforePress();
	checkpoint(sync);
	await click(option.label);
}

/** Pages through the picker's years until `year` is shown, then clicks it */
async function pickYear(sync: Sync, year: string) {
	for (let page = 0; page < 10; page++) {
		const options = await waitFor(() => {
			const found = pickerOptions("year");
			return found.length ? found : undefined;
		}, "the years of the date picker");

		if (options.some(({ value }) => value.startsWith(year))) {
			return await pickOption(sync, "year", year);
		}

		const shown = options.map(({ value }) => value.slice(0, 4)).toSorted();
		const firstShown = shown[0];
		const button = await waitFor(
			() =>
				pickerQuery(
					year < firstShown ? selectors.pickerPreviousButton : selectors.pickerNextButton,
				),
			"the arrows of the date picker",
		);

		await pauseBeforePress();
		checkpoint(sync);
		await click(button);
		await waitFor(() => pickerOptions("year")[0]?.value.slice(0, 4) !== firstShown, "other years");
	}

	throw new Error(`The date picker does not offer the year ${year}`);
}

/** Picks `date` in the given filter input through iPKO's date picker, and waits for the new rows */
async function setFilterDate(sync: Sync, which: "from" | "to", date: IsoDate) {
	const findInput = () =>
		document.querySelectorAll<HTMLInputElement>(selectors.dateInputs)[which === "from" ? 0 : 1];

	const input = await waitFor(findInput, `the "${which}" date of the filter`);
	if (parseInputDate(input.value) === date) return;

	await scrollToElement(input);
	await pauseBeforePress();
	checkpoint(sync);
	await click(input);

	await waitFor(() => pickerQuery(selectors.pickerYearsButton), "the date picker");
	await pauseBeforePress();
	checkpoint(sync);
	await click(pickerQuery(selectors.pickerYearsButton)!);

	const [year, month] = date.split("-");
	await pickYear(sync, year);
	await pickOption(sync, "month", `${year}-${month}`);

	const tableUpdated = waitForTableUpdate();
	await pickOption(sync, "day", date);
	await waitFor(() => !document.querySelector(selectors.datePicker), "the date picker closing");

	const picked = parseInputDate(findInput()?.value ?? "");
	if (picked !== date) {
		throw new Error(`The "${which}" date is ${picked ?? "empty"} instead of ${formatDate(date)}`);
	}

	// The table may already have shown these rows, then nothing changes and the timeout is fine
	await tableUpdated;
}

/** Loads every page of the history that is older than the filter shows yet */
async function loadAllPages(sync: Sync) {
	for (;;) {
		checkpoint(sync);
		const button = document.querySelector(selectors.loadMore);
		if (!button) return;

		// "Load More" is the last thing on the page
		if (humanLikeInput) await scrollToElement(button);
		else scrollToBottom(button);
		await pauseBeforePress();
		checkpoint(sync);

		const tableUpdated = waitForTableUpdate();
		await click(button);
		// iPKO removes "Load More" after the last page, so a click that loads nothing is a failure
		if (!(await tableUpdated)) {
			throw new Error(
				`iPKO did not load more transactions within ${tableUpdateTimeoutMs / 1000} seconds`,
			);
		}

		sync.pages++;
		sync.showProgress();
		await pauseAfterLoad();
	}
}

async function runSync(sync: Sync, from: IsoDate, through: IsoDate) {
	// "to" first: an older "to" could make the picker refuse a newer "from"
	await setFilterDate(sync, "to", through);
	await setFilterDate(sync, "from", from);
	await loadAllPages(sync);

	await Promise.all(sync.pendingStores);
	checkpoint(sync);

	// The end of the table shows that nothing is left to load
	scrollToBottom(document.querySelector(selectors.table) ?? document.body);
}

const syncedThroughPath = (accountNumber: string) =>
	`/api/accounts/${encodeURIComponent(accountNumber)}/synced-through`;

/** Up to which date the finished syncs of the account loaded its history, `null` before the first */
async function fetchSyncedThrough(accountNumber: string) {
	const parsed = syncedThroughSchema.safeParse(
		await requestServer(syncedThroughPath(accountNumber)),
	);
	if (!parsed.success)
		throw new Error("Could not ask the server for the last sync, see the console");
	return parsed.data.syncedThrough;
}

/** Resolves to the account's `syncedThrough` after the server recorded the sync, `undefined` if not */
async function recordFinishedSync(accountNumber: string, body: FinishedSyncBody) {
	try {
		const answer = await requestServer(syncedThroughPath(accountNumber), { body });
		return syncedThroughSchema.safeParse(answer).data?.syncedThrough;
	} catch (error) {
		console.error("Could not record the sync:", error);
		return undefined;
	}
}

const autoSyncStart = (syncedThrough: IsoDate) => addDays(syncedThrough, -overlapDays);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Why this copy of the userscript must not sync: a message when its version differs from the one
 * the server serves, `undefined` when they are the same. Throws when the server does not answer.
 */
async function versionProblem(): Promise<string | undefined> {
	const parsed = versionSchema.safeParse(
		await requestServer("/api/userscript/version", { withKey: false }),
	);
	if (!parsed.success)
		throw new Error("Could not check the version of the userscript, see the console");

	const installed = GM.info.script.version;
	const served = parsed.data.version ?? "unknown";
	if (installed === served) return undefined;

	// FireMonkey compares versions the same way and updates only to a higher one
	if (installed.localeCompare(served, undefined, { numeric: true }) > 0) {
		return `This userscript is version ${installed}, newer than the ${served} the server has. Deploy the server, then reload this page.`;
	}

	return (
		`This userscript is version ${installed}, the server has ${served}. To update it, open the ` +
		`options of FireMonkey, pick "${GM.info.script.name}" under Scripts and press Update (the ` +
		"download arrow). Then reload this page."
	);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	style: Partial<CSSStyleDeclaration> = {},
	text = "",
) {
	const element = document.createElement(tag);
	Object.assign(element.style, style);
	element.textContent = text;
	return element;
}

const buttonStyle = {
	padding: "6px 14px",
	border: "none",
	borderRadius: "6px",
	background: "#004c9a",
	color: "#fff",
	font: "inherit",
	cursor: "pointer",
} satisfies Partial<CSSStyleDeclaration>;

const secondaryButtonStyle = {
	...buttonStyle,
	background: "#fff",
	color: "#004c9a",
	boxShadow: "inset 0 0 0 1px #004c9a",
} satisfies Partial<CSSStyleDeclaration>;

/**
 * Shows a floating sync panel while the transaction history is open. "Auto-Sync" sets the filter
 * from 30 days before the last finished sync of the shown account until today, or asks for the
 * start date before the first one; "Sync from…" always asks. Either then presses "Load More" until
 * it disappears.
 */
export function mountSyncPanel() {
	const panel = createElement("div", {
		position: "fixed",
		right: "16px",
		bottom: "16px",
		zIndex: "2147483647",
		display: "flex",
		flexDirection: "column",
		gap: "8px",
		maxWidth: "280px",
		padding: "12px",
		borderRadius: "8px",
		background: "#fff",
		color: "#222",
		boxShadow: "0 2px 12px rgba(0, 0, 0, 0.25)",
		font: "13px/1.4 system-ui, sans-serif",
	});
	const status = createElement("div", { display: "none" });
	const dateRow = createElement("label", { display: "none", flexDirection: "column", gap: "4px" });
	const dateText = createElement("span");
	const dateInput = createElement("input", { font: "inherit" });
	dateInput.type = "date";
	dateRow.append(dateText, dateInput);
	const buttons = createElement("div", { display: "flex", gap: "8px" });
	const button = createElement("button", buttonStyle);
	const secondaryButton = createElement("button", secondaryButtonStyle);
	buttons.append(button, secondaryButton);
	panel.append(status, dateRow, buttons);

	const showStatus = (text: string) => {
		status.textContent = text;
		status.style.display = text ? "block" : "none";
	};

	let onButton: () => unknown = startAutoSync;
	let onSecondaryButton: () => unknown = startSyncFrom;
	button.addEventListener("click", () => void onButton());
	secondaryButton.addEventListener("click", () => void onSecondaryButton());

	// Read from the server on every hover, so that it never shows a date a sync in between moved
	let tooltipRequest = 0;
	button.addEventListener("mouseenter", () => {
		const request = ++tooltipRequest;
		void autoSyncTooltip().then((text) => {
			if (request === tooltipRequest && onButton === startAutoSync) button.title = text;
		});
	});
	button.addEventListener("mouseleave", () => {
		tooltipRequest++;
		button.title = "";
	});

	function setButtons(primary: string, secondary?: string) {
		button.title = "";
		button.textContent = primary;
		button.disabled = false;
		secondaryButton.textContent = secondary ?? "";
		secondaryButton.style.display = secondary ? "" : "none";
		secondaryButton.disabled = false;
	}

	function idle(message: string) {
		currentSync = undefined;
		dateRow.style.display = "none";
		buttons.style.display = "flex";
		setButtons("Auto-Sync", "Sync from…");
		onButton = startAutoSync;
		onSecondaryButton = startSyncFrom;
		showStatus(message);
	}

	/** Replaces the sync buttons with what to do when this copy of the script is outdated */
	async function checkVersion(): Promise<boolean> {
		let problem: string | undefined;
		try {
			problem = await versionProblem();
		} catch (error) {
			idle(errorMessage(error));
			return false;
		}

		if (!problem) return true;

		idle(problem);
		buttons.style.display = "none";
		return false;
	}

	async function autoSyncTooltip() {
		const accountNumber = lastAccountNumber;
		if (!accountNumber) return "The account of the history is not known yet";

		try {
			const syncedThrough = await fetchSyncedThrough(accountNumber);
			return syncedThrough
				? `Syncs transactions from ${formatDate(autoSyncStart(syncedThrough))} until today. ` +
						"Transactions that are already stored are skipped."
				: "No sync of this account finished yet, so it asks where to start";
		} catch (error) {
			return errorMessage(error);
		}
	}

	/** The account to sync and its `syncedThrough`, or `undefined` after showing why there is none */
	async function prepareSync() {
		const accountNumber = lastAccountNumber;
		if (!accountNumber) {
			return idle(
				"The account of the history is not known yet: wait for it to load, or reload the page",
			);
		}

		button.disabled = true;
		secondaryButton.disabled = true;
		showStatus("Checking the version of the userscript…");
		if (!(await checkVersion())) return;

		showStatus("Asking the server for the last sync…");
		try {
			return { accountNumber, syncedThrough: await fetchSyncedThrough(accountNumber) };
		} catch (error) {
			return idle(errorMessage(error));
		}
	}

	async function startAutoSync() {
		const prepared = await prepareSync();
		if (!prepared) return;

		const { accountNumber, syncedThrough } = prepared;
		if (syncedThrough) return run(accountNumber, autoSyncStart(syncedThrough));

		askForDate(accountNumber, "No sync of this account finished yet. Sync from:", "");
	}

	async function startSyncFrom() {
		const prepared = await prepareSync();
		if (!prepared) return;

		const { accountNumber, syncedThrough } = prepared;
		askForDate(accountNumber, "Sync from:", syncedThrough ? autoSyncStart(syncedThrough) : "");
	}

	function askForDate(accountNumber: string, text: string, value: IsoDate) {
		showStatus("");
		dateText.textContent = text;
		dateInput.max = today();
		dateInput.value = value;
		dateRow.style.display = "flex";

		setButtons("Start", "Cancel");
		onButton = async () => {
			if (!dateInput.value) return showStatus("Pick a date first");
			await run(accountNumber, dateInput.value);
		};
		onSecondaryButton = () => idle("");
	}

	async function run(accountNumber: string, from: IsoDate) {
		const through = today();
		const sync: Sync = {
			accountNumber,
			stopped: false,
			pages: 0,
			pendingStores: new Set(),
			showProgress: () =>
				showStatus(
					`Loaded ${pagesText(sync.pages)}` +
						(sync.oldestDate ? `, back to ${formatDate(sync.oldestDate)}` : ""),
				),
		};
		currentSync = sync;

		dateRow.style.display = "none";
		setButtons("Stop");
		onButton = async () => {
			sync.stopped = true;
			button.disabled = true;
			showStatus("Stopping…");
		};
		showStatus(`Setting the filter to ${formatDate(from)} – ${formatDate(through)}…`);

		try {
			await runSync(sync, from, through);
		} catch (error) {
			if (error instanceof SyncStopped) return idle(`Stopped after ${pagesText(sync.pages)}`);
			console.error("Sync failed:", error);
			return idle(`Sync failed: ${errorMessage(error)}`);
		}

		button.disabled = true;
		showStatus("Recording the sync on the server…");
		const syncedThrough = await recordFinishedSync(accountNumber, { from, through });

		const done = `Done: loaded ${pagesText(sync.pages)} since ${formatDate(from)}`;
		if (syncedThrough === undefined) {
			return idle(`${done}, but the server did not record it, see the console`);
		}
		// The server keeps the date of the last sync when this one started after it
		if (syncedThrough !== null && syncedThrough < through) {
			return idle(
				`${done}. It started after the last sync ended, so Auto-Sync still starts from ` +
					`${formatDate(autoSyncStart(syncedThrough))}.`,
			);
		}
		idle(done);
	}

	idle("");

	setInterval(() => {
		const onHistory = document.querySelector(selectors.historyPage) !== null;
		if (onHistory && !panel.isConnected) {
			document.body.append(panel);
			void checkVersion();
		}
		// A running sync notices on its own that the history is gone and reports it in the panel
		if (!onHistory && panel.isConnected && !currentSync) panel.remove();
	}, 1000);
}
