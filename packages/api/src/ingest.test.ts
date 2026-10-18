import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { accounts, rawTransactions } from "./db/schema.ts";
import { createTestDb, testIngestApiKey } from "./db/testDb.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const accountNumber = "PL00000000";

describe("ingestRawTransactions", () => {
	beforeEach(async () => {
		await db.delete(rawTransactions);
		await db.delete(accounts);
	});

	it("inserts new transactions as unprocessed", async () => {
		const inserted = await ingestRawTransactions({
			accountNumber,
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
		await ingestRawTransactions({ accountNumber, transactions: [{ bankId: "1", data: {} }] });
		await ingestRawTransactions({ accountNumber, transactions: [{ bankId: "2", data: {} }] });
		await ingestRawTransactions({ accountNumber: "other", transactions: [] });

		const stored = await db.select().from(accounts);
		assert.deepEqual(
			stored.map((account) => [account.number, account.name]),
			[
				[accountNumber, accountNumber],
				["other", "other"],
			],
		);

		const raw = await db.select().from(rawTransactions);
		assert.deepEqual(new Set(raw.map((t) => t.accountId)), new Set([stored[0]?.id]));
	});

	it("skips a transaction that is already stored with the same data", async () => {
		await ingestRawTransactions({
			accountNumber,
			transactions: [{ bankId: "1", data: { title: "first", amount: "1.00" } }],
		});

		const inserted = await ingestRawTransactions({
			accountNumber,
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
			accountNumber,
			transactions: [
				{ bankId: "1", data: { title: "first" } },
				{ bankId: "1", data: { title: "first" } },
			],
		});

		assert.equal(inserted.length, 1);
	});

	it("keeps a new row when the data of a known transaction changes", async () => {
		await ingestRawTransactions({
			accountNumber,
			transactions: [{ bankId: "1", data: { title: "first" } }],
		});

		const inserted = await ingestRawTransactions({
			accountNumber,
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
		await ingestRawTransactions({ accountNumber, transactions });

		const inserted = await ingestRawTransactions({ accountNumber: "other", transactions });

		assert.equal(inserted.length, 1);
	});
});

describe("POST /api/transactions/raw", () => {
	const post = (headers: Record<string, string>, number = accountNumber) =>
		app.request("/api/transactions/raw", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({
				accountNumber: number,
				transactions: [{ bankId: "http", data: {} }],
			}),
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

	it("stores the account number without whitespace", async () => {
		await db.delete(rawTransactions);
		await db.delete(accounts);

		await post({ "x-api-key": testIngestApiKey }, "PL00 0000\t0000");

		const stored = await db.select().from(accounts);
		assert.deepEqual(
			stored.map((account) => account.number),
			["PL0000000000"],
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
		accountNumber: "balances",
		name: "PKO KONTO",
		currency: "PLN",
		balance: "1200.15",
		ledger: "1000.05",
	};
	const stored = async () =>
		(await db.query.accounts.findFirst({ where: { number: "balances" } }))!;

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

const path = (account: string) => `/api/accounts/${encodeURIComponent(account)}/synced-through`;

describe("/api/accounts/:accountNumber/synced-through", () => {
	beforeEach(async () => {
		await db.delete(rawTransactions);
		await db.delete(accounts);
	});

	const headers = { "x-api-key": testIngestApiKey };
	const get = async (account: string) =>
		await (await app.request(path(account), { headers })).json();
	const post = (account: string, body: unknown, requestHeaders: Record<string, string> = headers) =>
		app.request(path(account), {
			method: "POST",
			headers: { "Content-Type": "application/json", ...requestHeaders },
			body: JSON.stringify(body),
		});
	const record = async (from: string, through: string) =>
		await (await post(accountNumber, { from, through })).json();

	it("rejects requests without the ingest key, malformed dates and from after through", async () => {
		assert.equal((await app.request(path(accountNumber))).status, 401);
		assert.equal(
			(await post(accountNumber, { from: "2026-01-01", through: "2026-02-01" }, {})).status,
			401,
		);
		assert.equal(
			(await post(accountNumber, { from: "yesterday", through: "2026-02-01" })).status,
			400,
		);
		assert.equal(
			(await post(accountNumber, { from: "2026-02-02", through: "2026-02-01" })).status,
			400,
		);
	});

	it("answers null for an unknown account and one without a finished sync", async () => {
		await ingestRawTransactions({ accountNumber: "empty", transactions: [] });

		assert.deepEqual(await get("unknown"), { syncedThrough: null });
		assert.deepEqual(await get("empty"), { syncedThrough: null });
	});

	it("records the first sync whatever it started from, also for an unknown account", async () => {
		assert.deepEqual(await record("2026-05-01", "2026-06-01"), { syncedThrough: "2026-06-01" });
		assert.deepEqual(await get(accountNumber), { syncedThrough: "2026-06-01" });
	});

	it("moves forward after a sync that started on or before the recorded date", async () => {
		await record("2026-01-01", "2026-06-01");

		assert.deepEqual(await record("2026-05-02", "2026-07-01"), { syncedThrough: "2026-07-01" });
		assert.deepEqual(await record("2026-07-01", "2026-07-15"), { syncedThrough: "2026-07-15" });
	});

	it("stays after a sync that started later, which left a gap, or ended earlier", async () => {
		await record("2026-01-01", "2026-06-01");

		assert.deepEqual(await record("2026-06-02", "2026-07-01"), { syncedThrough: "2026-06-01" });
		assert.deepEqual(await record("2026-03-01", "2026-04-01"), { syncedThrough: "2026-06-01" });
	});

	it("finds the account by its number written with whitespace", async () => {
		await record("2026-01-01", "2026-06-01");

		assert.deepEqual(await get("PL00 0000 00"), { syncedThrough: "2026-06-01" });
	});
});
