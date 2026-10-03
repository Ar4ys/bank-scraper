import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { TransactionAmount } from "@bank-scraper/shared";
import { eq } from "drizzle-orm";

import * as tables from "./db/schema.ts";
import { createTestDb, testLunchflowApiKey } from "./db/testDb.ts";
import { rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

await ingestRawTransactions({
	sourceAccount: "PL00",
	transactions: [
		{ bankId: "card-1", data: rawCardTransaction() },
		{ bankId: "transfer-1", data: rawTransferSend() },
	],
});
await ingestRawTransactions({ sourceAccount: "empty", transactions: [] });

const [account] = await db
	.select()
	.from(tables.accounts)
	.where(eq(tables.accounts.sourceAccount, "PL00"));
assert.ok(account);

async function get(
	path: string,
	headers: Record<string, string> = { "x-api-key": testLunchflowApiKey },
) {
	const response = await app.request(`/api/lunchflow${path}`, { headers });
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return { status: response.status, body: (await response.json()) as any };
}

describe("Lunch Flow API", () => {
	it("requires the Lunch Flow key, as a header or a bearer token", async () => {
		assert.equal((await get("/accounts", {})).status, 401);
		assert.equal((await get("/accounts", { "x-api-key": "wrong" })).status, 401);
		assert.equal(
			(await get("/accounts", { Authorization: `Bearer ${testLunchflowApiKey}` })).status,
			200,
		);
	});

	it("lists the accounts that have processed transactions", async () => {
		const { status, body } = await get("/accounts");

		assert.equal(status, 200);
		assert.deepEqual(body, {
			accounts: [
				{
					id: account.id,
					connection_id: 1,
					name: "PL00",
					institution_name: "PKO Bank Polski",
					institution_logo: "",
					provider: "ipko",
					currency: "PLN",
					status: "ACTIVE",
				},
			],
			total: 1,
		});
	});

	it("lists the transactions of an account in the Lunch Flow shape", async () => {
		const { status, body } = await get(`/accounts/${account.id}/transactions`);

		assert.equal(status, 200);
		assert.equal(body.total, 2);

		const [transfer, card] = body.transactions;
		assert.match(transfer.id, /^[0-9a-f-]{36}$/);
		assert.deepEqual(
			{ ...transfer, id: undefined },
			{
				id: undefined,
				accountId: account.id,
				amount: -1500,
				currency: "PLN",
				date: "2025-05-21",
				merchant: "Jan Kowalski",
				description: "Rent August",
				isPending: false,
			},
		);
		assert.deepEqual([card.amount, card.merchant, card.date], [-12.34, "", "2025-06-06"]);
	});

	it("filters by inclusive dates, named as Sure or as the docs name them", async () => {
		const dates = async (query: string) =>
			(await get(`/accounts/${account.id}/transactions?${query}`)).body.transactions.map(
				(transaction: { date: string }) => transaction.date,
			);

		assert.deepEqual(await dates("start_date=2025-05-22"), ["2025-06-06"]);
		assert.deepEqual(await dates("end_date=2025-05-21&include_pending=true"), ["2025-05-21"]);
		assert.deepEqual(await dates("from=2025-05-21&to=2025-06-06"), ["2025-05-21", "2025-06-06"]);
		assert.deepEqual(await dates("from=2025-06-07"), []);
	});

	it("rejects malformed parameters and unknown accounts", async () => {
		assert.equal(
			(await get(`/accounts/${account.id}/transactions?start_date=yesterday`)).status,
			400,
		);
		assert.equal((await get("/accounts/abc/transactions")).status, 400);
		assert.equal((await get("/accounts/999999/transactions")).status, 404);
		assert.equal((await get("/accounts/999999/balance")).status, 404);
	});

	it("answers 404 for the balance until one was scraped, then returns it", async () => {
		const missing = await get(`/accounts/${account.id}/balance`);
		assert.equal(missing.status, 404);
		assert.deepEqual(Object.keys(missing.body), ["error", "message"]);

		await db
			.update(tables.accounts)
			.set({ balanceAmount: TransactionAmount(123456n), balanceCurrency: "PLN" })
			.where(eq(tables.accounts.id, account.id));

		assert.deepEqual((await get(`/accounts/${account.id}/balance`)).body, {
			balance: { amount: 1234.56, currency: "PLN" },
		});
	});

	it("answers 501 for holdings", async () => {
		assert.equal((await get(`/accounts/${account.id}/holdings`)).status, 501);
	});
});
