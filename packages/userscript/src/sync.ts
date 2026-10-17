import "./global";
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

/** How far before the newest stored transaction a sync starts, for transactions iPKO adds late */
const overlapDays = 30;
const tableUpdateTimeoutMs = 10_000;
const elementTimeoutMs = 5000;

const lastOrderDateSchema = z.object({ orderDate: z.nullable(z.string()) });
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
		if (!(await tableUpdated)) return;

		sync.pages++;
		sync.showProgress();
		await pauseAfterLoad();
	}
}

async function runSync(sync: Sync, from: IsoDate) {
	// "to" first: an older "to" could make the picker refuse a newer "from"
	await setFilterDate(sync, "to", today());
	await setFilterDate(sync, "from", from);
	await loadAllPages(sync);

	await Promise.all(sync.pendingStores);
	checkpoint(sync);

	// The end of the table shows that nothing is left to load
	scrollToBottom(document.querySelector(selectors.table) ?? document.body);
}

async function fetchLastOrderDate(accountNumber: string) {
	const answer = await requestServer(
		`/api/accounts/${encodeURIComponent(accountNumber)}/last-transaction-date`,
	);
	const parsed = lastOrderDateSchema.safeParse(answer);
	if (!parsed.success) throw new Error("Could not get the last transaction date, see the console");
	return parsed.data.orderDate;
}

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

const buttonStyle: Partial<CSSStyleDeclaration> = {
	padding: "6px 14px",
	border: "none",
	borderRadius: "6px",
	background: "#004c9a",
	color: "#fff",
	font: "inherit",
	cursor: "pointer",
};

/**
 * Shows a floating "Sync" panel while the transaction history is open. A sync sets the filter from
 * 30 days before the newest stored transaction of the shown account until today, then presses "Load
 * More" until it disappears or the table stops changing.
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
	const dateInput = createElement("input", { font: "inherit" });
	dateInput.type = "date";
	dateRow.append("No transactions of this account are stored yet. Sync from:", dateInput);
	const button = createElement("button", buttonStyle, "Sync");
	panel.append(status, dateRow, button);

	const showStatus = (text: string) => {
		status.textContent = text;
		status.style.display = text ? "block" : "none";
	};

	let onButton = startSync;
	button.addEventListener("click", () => void onButton());

	function idle(message: string) {
		currentSync = undefined;
		dateRow.style.display = "none";
		button.style.display = "";
		button.textContent = "Sync";
		button.disabled = false;
		onButton = startSync;
		showStatus(message);
	}

	/** Replaces the Sync button with what to do when this copy of the script is outdated */
	async function checkVersion(): Promise<boolean> {
		let problem: string | undefined;
		try {
			problem = await versionProblem();
		} catch (error) {
			idle(error instanceof Error ? error.message : String(error));
			return false;
		}

		if (!problem) return true;

		idle(problem);
		button.style.display = "none";
		return false;
	}

	async function startSync() {
		const accountNumber = lastAccountNumber;
		if (!accountNumber) {
			return idle(
				"The account of the history is not known yet: wait for it to load, or reload the page",
			);
		}

		button.disabled = true;
		showStatus("Checking the version of the userscript…");
		if (!(await checkVersion())) return;

		button.disabled = true;
		showStatus("Asking the server for the last transaction…");

		let lastOrderDate: string | null;
		try {
			lastOrderDate = await fetchLastOrderDate(accountNumber);
		} catch (error) {
			return idle(error instanceof Error ? error.message : String(error));
		}

		if (lastOrderDate) return run(accountNumber, addDays(lastOrderDate, -overlapDays));

		showStatus("");
		dateInput.max = today();
		dateRow.style.display = "flex";
		button.textContent = "Start";
		button.disabled = false;
		onButton = async () => {
			if (!dateInput.value) return showStatus("Pick a date first");
			dateRow.style.display = "none";
			await run(accountNumber, dateInput.value);
		};
	}

	async function run(accountNumber: string, from: IsoDate) {
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

		button.textContent = "Stop";
		button.disabled = false;
		onButton = async () => {
			sync.stopped = true;
			button.disabled = true;
			showStatus("Stopping…");
		};
		showStatus(`Setting the filter to ${formatDate(from)} – ${formatDate(today())}…`);

		try {
			await runSync(sync, from);
			idle(`Done: loaded ${pagesText(sync.pages)} since ${formatDate(from)}`);
		} catch (error) {
			if (error instanceof SyncStopped) return idle(`Stopped after ${pagesText(sync.pages)}`);
			console.error("Sync failed:", error);
			idle(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

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
