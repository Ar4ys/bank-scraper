import "./global";
import { type AccountBalancesBody, type IngestBody } from "@bank-scraper/shared";
import { z } from "zod/mini";

import { requestServer } from "./server";
import { mountSyncPanel, trackOperationsPage } from "./sync";
import { asyncSpyOn } from "./utils";

const OPERATIONS_URL = "/ipko3/accounts/operations/completed/full";
// The page calls this route for many things; the one we want answers with the accounts themselves
const INIT_URL = "/ipko3/init";

// Strict transaction validation and processing will happen on backend
const transactionSchema = z.pipe(
	z.looseObject({
		operation_id: z.string(),
	}),
	z.transform((t) => {
		// Looks like it just returns the requested query back - not very useful for us
		delete t.ref_recipient_history;
		return t;
	}),
);

const fullCompletedOperationsSchema = z.pipe(
	z.intersection(
		z.object({
			ref_operations_download_preferences: z.object({
				data: z.object({
					source_account: z.string(),
				}),
			}),
		}),
		z.union([
			z.object({ items: z.array(transactionSchema) }),
			z.object({ next_items: z.array(transactionSchema) }),
		]),
	),
	z.transform((obj) => ({
		ref_operations_download_preferences: obj.ref_operations_download_preferences,
		items: "items" in obj ? obj.items : obj.next_items,
	})),
);

// Only to show how far back a sync got, so a transaction without it is not an error
const orderDateSchema = z.object({ details: z.object({ order_date: z.string() }) });

const operationsResBodySchema = z.object({
	httpStatus: z.literal(200),
	response: z.object({ data: fullCompletedOperationsSchema }),
});

// Keyed by the same id that the operations response calls `source_account`
const accountsResBodySchema = z.object({
	httpStatus: z.literal(200),
	response: z.object({
		data: z.object({
			accounts: z.record(
				z.string(),
				z.object({
					name: z.string(),
					nickname: z.nullable(z.string()),
					currency: z.string(),
					balance: z.string(),
					ledger: z.string(),
				}),
			),
		}),
	}),
});

async function processOperations(body: unknown) {
	const { data, error } = operationsResBodySchema.safeParse(body);

	if (error) {
		console.error("Response does not satisfy schema:", error);
		return;
	}

	const { items, ref_operations_download_preferences: preferences } = data.response.data;

	const ingestBody = {
		sourceAccount: preferences.data.source_account,
		transactions: items.map((transaction) => ({
			bankId: transaction.operation_id,
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			data: transaction as IngestBody["transactions"][number]["data"],
		})),
	} satisfies IngestBody;

	const stored = storeTransactions(ingestBody);

	const orderDates = items.flatMap(
		(t) => orderDateSchema.safeParse(t).data?.details.order_date ?? [],
	);
	trackOperationsPage(ingestBody.sourceAccount, orderDates.toSorted()[0], stored);

	await stored;
}

/** Resolves to whether the server stored the transactions */
async function storeTransactions(ingestBody: IngestBody) {
	const created = z
		.array(z.unknown())
		.safeParse(await requestServer("/api/transactions/raw", ingestBody));
	if (!created.success) return false;

	if (created.data.length) {
		console.log(`Created new transactions: ${created.data.length}`);
	} else {
		console.log("No new transactions created");
	}
	return true;
}

async function processAccounts(body: unknown) {
	const { data } = accountsResBodySchema.safeParse(body);

	// Any other answer of the init route is not about accounts, so it is not an error
	if (!data) return;

	const balancesBody = {
		accounts: Object.entries(data.response.data.accounts).map(([sourceAccount, account]) => ({
			sourceAccount,
			name: account.nickname || account.name,
			currency: account.currency,
			balance: account.balance,
			ledger: account.ledger,
		})),
	} satisfies AccountBalancesBody;

	if (!balancesBody.accounts.length) return;

	if ((await requestServer("/api/accounts/balances", balancesBody)) !== undefined) {
		console.log(`Sent balances of accounts: ${balancesBody.accounts.length}`);
	}
}

const processors: Record<string, (body: unknown) => Promise<void>> = {
	[OPERATIONS_URL]: processOperations,
	[INIT_URL]: processAccounts,
};

asyncSpyOn(unsafeWindow, "fetch", async ([url, options], response) => {
	const processBody = typeof url === "string" ? processors[url] : undefined;

	if (!processBody || options?.method !== "POST" || !response.ok) {
		return;
	}

	let json: unknown;

	try {
		json = await response.clone().json();
	} catch (e) {
		console.error("Unable to clone and parse response as a json:", e);
		return;
	}

	try {
		await Promise.try(() => processBody(json));
	} catch (e) {
		console.error("Unable to process response:", e);
	}
});

mountSyncPanel();
