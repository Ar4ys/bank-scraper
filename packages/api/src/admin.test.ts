import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction, rawHold, rawTransferSend } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const accountNumber = "PL00";

await ingestRawTransactions({
	accountNumber,
	transactions: [
		{ bankId: "card-1", data: rawCardTransaction() },
		{ bankId: "transfer-1", data: rawTransferSend() },
		{ bankId: "hold-1", data: rawHold() },
		{ bankId: "broken-1", data: rawCardTransaction({ operation_type: "SOMETHING_NEW" }) },
	],
});
await ingestRawTransactions({
	accountNumber,
	transactions: [
		{ bankId: "card-1", data: rawCardTransaction({ details: { merchant_name: "Bolt" } }) },
	],
});

async function request(path: string, init?: RequestInit) {
	const response = await app.request(`/api/admin${path}`, init);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return { status: response.status, body: (await response.json()) as any };
}

const postJson = (path: string, body: unknown, method = "POST") =>
	request(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("admin API", () => {
	it("counts bank transactions by the status of their latest raw version", async () => {
		assert.deepEqual((await request("/dashboard")).body, {
			rawByStatus: { unprocessed: 0, processed: 2, hold: 1, error: 1 },
			transactions: 2,
			transactionsWithoutMerchant: 1,
		});
	});

	it("lists accounts with their counts, and renames them", async () => {
		const { body } = await request("/accounts");
		assert.deepEqual(body, [
			{
				id: body[0].id,
				number: accountNumber,
				name: accountNumber,
				currency: "PLN",
				balance: null,
				ledger: null,
				balanceCurrency: null,
				balanceAt: null,
				balanceSource: "ledger",
				syncedThrough: null,
				transactionCount: 2,
				rawTransactionCount: 4,
			},
		]);

		assert.equal(
			(await postJson(`/accounts/${body[0].id}`, { name: "Main" }, "PATCH")).body.name,
			"Main",
		);
		assert.equal((await postJson("/accounts/999", { name: "Main" }, "PATCH")).status, 404);
		assert.equal((await postJson(`/accounts/${body[0].id}`, { name: " " }, "PATCH")).status, 400);

		const switched = await postJson(
			`/accounts/${body[0].id}`,
			{ balanceSource: "balance" },
			"PATCH",
		);
		assert.deepEqual([switched.body.name, switched.body.balanceSource], ["Main", "balance"]);
		assert.equal(
			(await postJson(`/accounts/${body[0].id}`, { balanceSource: "nope" }, "PATCH")).status,
			400,
		);
	});

	it("lists the latest raw version of every bank transaction", async () => {
		const { body } = await request("/raw-transactions");

		assert.equal(body.total, 4);
		assert.deepEqual(
			body.items.map((item: any) => [item.bankId, item.status, item.versionCount]).toSorted(),
			[
				["broken-1", "error", 1],
				["card-1", "processed", 2],
				["hold-1", "hold", 1],
				["transfer-1", "processed", 1],
			],
		);

		const failed = await request("/raw-transactions?status=error");
		assert.deepEqual(
			failed.body.items.map((item: any) => [item.bankId, item.error.stage]),
			[["broken-1", "schema"]],
		);
	});

	it("returns every raw version of one bank transaction and its transaction", async () => {
		const { body } = await request("/accounts");
		const detail = await request(`/raw-transactions/${body[0].id}/card-1`);

		assert.deepEqual(
			detail.body.versions.map((version: any) => version.data.details.merchant_name),
			[undefined, "Bolt"],
		);
		assert.match(detail.body.transactionId, /^[0-9a-f-]{36}$/);
		assert.deepEqual(
			[detail.body.parsed.$type, detail.body.parsed.details.merchant_name],
			["cardTransaction", "Bolt"],
		);
		assert.equal((await request(`/raw-transactions/${body[0].id}/hold-1`)).body.parsed, null);
		assert.equal((await request(`/raw-transactions/${body[0].id}/nope`)).status, 404);
	});

	it("lists transactions with dates and amounts as text, and filters them", async () => {
		const { body } = await request("/transactions");

		assert.deepEqual(
			body.items.map((item: any) => [item.bankId, item.date, item.amount, item.merchant]),
			[
				["transfer-1", "2022-03-29", "-940.00", null],
				["card-1", "2022-02-11", "-57.33", "Bolt"],
			],
		);

		// Only the notes of the transfer hold the name
		const found = await request("/transactions?search=someone");
		assert.deepEqual(
			found.body.items.map((item: any) => item.bankId),
			["transfer-1"],
		);
		assert.equal((await request("/transactions?withoutMerchant=true")).body.total, 1);
		assert.equal((await request("/transactions?limit=1&offset=1")).body.items[0].bankId, "card-1");
	});

	it("returns a transaction with its version history", async () => {
		const list = await request("/transactions?search=card-1");
		const { body } = await request(`/transactions/${list.body.items[0].id}`);

		assert.equal(body.transaction.merchant, "Bolt");
		assert.deepEqual(
			body.versions.map((version: any) => [
				version.cause,
				version.data.merchant,
				version.appCommit,
				version.fieldRules,
			]),
			[
				["raw", null, "unknown", []],
				["raw", "Bolt", "unknown", []],
			],
		);
		assert.equal((await request("/transactions/nope")).status, 404);
	});

	it("reprocesses with a report, and writes nothing on a dry run", async () => {
		const dryRun = await postJson("/reprocess", { scope: "all", dryRun: true });
		assert.deepEqual(
			[
				dryRun.body.changes.length,
				dryRun.body.unchanged,
				dryRun.body.holds,
				dryRun.body.errors.length,
			],
			[0, 2, 1, 1],
		);
		assert.equal(dryRun.body.errors[0].error.stage, "schema");

		const failed = await postJson("/reprocess", { scope: "failed", dryRun: false });
		assert.deepEqual([failed.body.unchanged, failed.body.errors.length], [0, 1]);
	});

	it("answers unknown API paths with 404", async () => {
		assert.equal((await app.request("/api/nope")).status, 404);
	});
});
