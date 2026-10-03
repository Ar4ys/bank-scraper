import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { accounts, rawTransactions } from "./db/schema.ts";
import { createTestDb, testIngestApiKey } from "./db/testDb.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const sourceAccount = "PL00 0000 0000";

describe("ingestRawTransactions", () => {
	beforeEach(async () => {
		await db.delete(rawTransactions);
		await db.delete(accounts);
	});

	it("inserts new transactions as unprocessed", async () => {
		const inserted = await ingestRawTransactions({
			sourceAccount,
			transactions: [
				{ bankId: "1", data: { title: "first" } },
				{ bankId: "2", data: { title: "second" } },
			],
		});

		assert.deepEqual(
			inserted.map((t) => [t.bankId, t.data, t.status]),
			[
				["1", { title: "first" }, "unprocessed"],
				["2", { title: "second" }, "unprocessed"],
			],
		);
	});

	it("creates one account per source account and names it after it", async () => {
		await ingestRawTransactions({ sourceAccount, transactions: [{ bankId: "1", data: {} }] });
		await ingestRawTransactions({ sourceAccount, transactions: [{ bankId: "2", data: {} }] });
		await ingestRawTransactions({ sourceAccount: "other", transactions: [] });

		const stored = await db.select().from(accounts);
		assert.deepEqual(
			stored.map((account) => [account.sourceAccount, account.name]),
			[
				[sourceAccount, sourceAccount],
				["other", "other"],
			],
		);

		const raw = await db.select().from(rawTransactions);
		assert.deepEqual(new Set(raw.map((t) => t.accountId)), new Set([stored[0]?.id]));
	});

	it("skips a transaction that is already stored with the same data", async () => {
		await ingestRawTransactions({
			sourceAccount,
			transactions: [{ bankId: "1", data: { title: "first", amount: "1.00" } }],
		});

		const inserted = await ingestRawTransactions({
			sourceAccount,
			transactions: [
				// Different key order must still count as the same data
				{ bankId: "1", data: { amount: "1.00", title: "first" } },
				{ bankId: "2", data: { title: "second" } },
			],
		});

		assert.deepEqual(
			inserted.map((t) => t.bankId),
			["2"],
		);
		assert.equal((await db.select().from(rawTransactions)).length, 2);
	});

	it("stores the same transaction only once when a batch repeats it", async () => {
		const inserted = await ingestRawTransactions({
			sourceAccount,
			transactions: [
				{ bankId: "1", data: { title: "first" } },
				{ bankId: "1", data: { title: "first" } },
			],
		});

		assert.equal(inserted.length, 1);
	});

	it("keeps a new row when the data of a known transaction changes", async () => {
		await ingestRawTransactions({
			sourceAccount,
			transactions: [{ bankId: "1", data: { title: "first" } }],
		});

		const inserted = await ingestRawTransactions({
			sourceAccount,
			transactions: [{ bankId: "1", data: { title: "first", category: "new field" } }],
		});

		assert.equal(inserted.length, 1);

		const stored = await db.query.rawTransactions.findMany({
			where: { bankId: "1" },
			orderBy: { id: "asc" },
		});
		assert.deepEqual(
			stored.map((t) => t.data),
			[{ title: "first" }, { title: "first", category: "new field" }],
		);
	});

	it("keeps transactions with the same bank id apart when the accounts differ", async () => {
		const transactions = [{ bankId: "1", data: { title: "first" } }];
		await ingestRawTransactions({ sourceAccount, transactions });

		const inserted = await ingestRawTransactions({ sourceAccount: "other", transactions });

		assert.equal(inserted.length, 1);
	});
});

describe("POST /api/transactions/raw", () => {
	const post = (headers: Record<string, string>) =>
		app.request("/api/transactions/raw", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({ sourceAccount, transactions: [{ bankId: "http", data: {} }] }),
		});

	it("rejects a request without the ingest key", async () => {
		assert.equal((await post({})).status, 401);
		assert.equal((await post({ "x-api-key": "wrong" })).status, 401);
	});

	it("stores the batch when the ingest key is sent", async () => {
		const response = await post({ "x-api-key": testIngestApiKey });

		assert.equal(response.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const body = (await response.json()) as Array<{ bankId: string }>;
		assert.deepEqual(
			body.map((t) => t.bankId),
			["http"],
		);
	});
});

describe("POST /api/accounts/balances", () => {
	const post = (
		scrapedAccounts: unknown[],
		headers: Record<string, string> = { "x-api-key": testIngestApiKey },
	) =>
		app.request("/api/accounts/balances", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({ accounts: scrapedAccounts }),
		});

	const scraped = {
		sourceAccount: "balances",
		name: "PKO KONTO",
		currency: "PLN",
		balance: "1200.15",
		ledger: "1000.05",
	};
	const stored = async () =>
		(await db.query.accounts.findFirst({ where: { sourceAccount: "balances" } }))!;

	it("rejects a request without the ingest key and a malformed amount", async () => {
		assert.equal((await post([scraped], {})).status, 401);
		assert.equal((await post([{ ...scraped, balance: "a lot" }])).status, 400);
	});

	it("creates the account with the bank's name, both amounts and its currency", async () => {
		assert.equal((await post([scraped])).status, 200);

		const account = await stored();
		assert.deepEqual(
			[
				account.name,
				account.currency,
				account.balanceAmount,
				account.ledgerAmount,
				account.balanceCurrency,
				account.balanceSource,
			],
			["PKO KONTO", "PLN", 120015n, 100005n, "PLN", "ledger"],
		);
		assert.ok(account.balanceAt);
	});

	it("updates the amounts and follows the bank's name while the account was not renamed", async () => {
		await post([{ ...scraped, name: "Nickname", balance: "5.00", ledger: "-1.50" }]);

		const account = await stored();
		assert.deepEqual(
			[account.name, account.balanceAmount, account.ledgerAmount],
			["PKO KONTO", 500n, -150n],
		);
	});
});
