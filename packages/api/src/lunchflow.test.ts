import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import * as tables from "./db/schema.ts";
import { createTestDb, testIngestApiKey, testLunchflowApiKey } from "./db/testDb.ts";
import { rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		{ bankId: "card-1", data: rawCardTransaction({ details: { merchant_name: "Lidl" } }) },
		{ bankId: "transfer-1", data: rawTransferSend() },
	],
});
await ingestRawTransactions({ accountNumber: "empty", transactions: [] });

const [account] = await db.select().from(tables.accounts).where(eq(tables.accounts.number, "PL00"));
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

		const [card, transfer] = body.transactions;
		assert.match(transfer.id, /^[0-9a-f-]{36}$/);
		assert.deepEqual(
			{ ...transfer, id: undefined },
			{
				id: undefined,
				accountId: account.id,
				amount: -940,
				currency: "PLN",
				date: "2022-03-29",
				merchant: null,
				description: "CUSTOM TRANSFER NAME",
				notes: [
					"To: SOMEONE WHO RECEIVED MONEY",
					"Account: 12 3456 7890 1234 5678 9012 3456",
					"Title: CUSTOM TRANSFER NAME",
				].join("\n"),
				isPending: false,
			},
		);
		assert.deepEqual([card.amount, card.merchant, card.date], [-57.33, "Lidl", "2022-02-11"]);
		assert.equal("notes" in card, false);
	});

	it("sends the category of a transaction's merchant, and nothing without one", async () => {
		const categoryId = "0192b7a4-5c1e-7c3a-9d2f-1a2b3c4d5e6f";
		const transactions = async () => (await get(`/accounts/${account.id}/transactions`)).body;

		const [cardBefore, transferBefore] = (await transactions()).transactions;
		assert.equal("categoryId" in cardBefore, false);
		assert.equal("categoryId" in transferBefore, false);

		await db
			.update(tables.merchants)
			.set({ sureCategoryId: categoryId })
			.where(eq(tables.merchants.name, "Lidl"));

		const [card, transfer] = (await transactions()).transactions;
		assert.equal(card.categoryId, categoryId);
		assert.equal("categoryId" in transfer, false);

		await db.update(tables.merchants).set({ sureCategoryId: null });
	});

	it("sends the domain of a transaction's merchant, and nothing without one", async () => {
		const transactions = async () =>
			(await get(`/accounts/${account.id}/transactions`)).body.transactions;

		assert.ok((await transactions()).every((item: object) => !("merchantDomain" in item)));

		await db
			.update(tables.merchants)
			.set({ domain: "example.com" })
			.where(eq(tables.merchants.name, "Lidl"));

		const [card, transfer] = await transactions();
		assert.equal(card.merchantDomain, "example.com");
		assert.equal("merchantDomain" in transfer, false);

		await db.update(tables.merchants).set({ domain: null });
	});

	it("filters by inclusive dates, named as Sure or as the docs name them", async () => {
		const dates = async (query: string) =>
			(await get(`/accounts/${account.id}/transactions?${query}`)).body.transactions.map(
				(transaction: { date: string }) => transaction.date,
			);

		assert.deepEqual(await dates("start_date=2022-02-12"), ["2022-03-29"]);
		assert.deepEqual(await dates("end_date=2022-02-11&include_pending=true"), ["2022-02-11"]);
		assert.deepEqual(await dates("from=2022-02-11&to=2022-03-29"), ["2022-02-11", "2022-03-29"]);
		assert.deepEqual(await dates("from=2022-03-30"), []);
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

	it("answers 404 for the balance until one was scraped", async () => {
		const missing = await get(`/accounts/${account.id}/balance`);

		assert.equal(missing.status, 404);
		assert.deepEqual(Object.keys(missing.body), ["error", "message"]);
	});

	it("reports the scraped ledger as the balance, or the bank's balance if the account says so", async () => {
		const scraped = await app.request("/api/accounts/balances", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": testIngestApiKey },
			body: JSON.stringify({
				accounts: [
					{
						accountNumber: "PL00",
						name: "Konto",
						currency: "PLN",
						balance: "1200.15",
						ledger: "1000.05",
					},
				],
			}),
		});
		assert.equal(scraped.status, 200);

		assert.deepEqual((await get(`/accounts/${account.id}/balance`)).body, {
			balance: { amount: 1000.05, currency: "PLN" },
		});

		await db
			.update(tables.accounts)
			.set({ balanceSource: "balance" })
			.where(eq(tables.accounts.id, account.id));

		assert.deepEqual((await get(`/accounts/${account.id}/balance`)).body, {
			balance: { amount: 1200.15, currency: "PLN" },
		});
	});

	it("answers 501 for holdings", async () => {
		assert.equal((await get(`/accounts/${account.id}/holdings`)).status, 501);
	});
});
