import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { type Rule } from "@bank-scraper/shared";
import { eq } from "drizzle-orm";

import * as tables from "../db/schema.ts";
import { createTestDb } from "../db/testDb.ts";
import { rawCardTransaction, rawHold } from "./fixtures.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("../ingest.ts");
const { listBankTransactionKeys, processBankTransactions } = await import("./process.ts");
after(cleanup);

const sourceAccount = "PL00";

const ingest = (data: ReturnType<typeof rawCardTransaction>) =>
	ingestRawTransactions({
		sourceAccount,
		transactions: [
			{ bankId: typeof data.operation_id === "string" ? data.operation_id : "", data },
		],
	});

const boltRule: Rule = {
	id: "bolt",
	name: "Bolt",
	priority: 0,
	enabled: true,
	txTypes: null,
	conditions: [{ path: "details.title", operator: "contains", pattern: "bolt.eu" }],
	set: { merchant: "Bolt" },
};

async function applyRules(rules: Rule[]) {
	await db.insert(tables.ruleRevisions).values({ rules });
	return processBankTransactions(listBankTransactionKeys());
}

const versions = () =>
	db.select().from(tables.transactionVersions).orderBy(tables.transactionVersions.id);
const rawRows = () => db.select().from(tables.rawTransactions).orderBy(tables.rawTransactions.id);

describe("processing", () => {
	beforeEach(async () => {
		await db.delete(tables.transactionVersions);
		await db.delete(tables.transactions);
		await db.delete(tables.rawTransactions);
		await db.delete(tables.ruleRevisions);
		await db.delete(tables.accounts);
	});

	it("creates a transaction with its first version on ingest", async () => {
		const [raw] = await ingest(rawCardTransaction());
		assert.ok(raw);

		const [transaction] = await db.select().from(tables.transactions);
		assert.ok(transaction);
		assert.equal(transaction.bankId, "card-1");
		assert.equal(transaction.amount, -1234n);
		assert.equal(transaction.date.toString(), "2025-06-06");
		assert.equal(transaction.merchant, null);

		const [version, ...rest] = await versions();
		assert.ok(version);
		assert.equal(rest.length, 0);
		assert.deepEqual(
			[version.transactionId, version.rawTransactionId, version.cause, version.ruleRevisionId],
			[transaction.id, raw.id, "raw", null],
		);

		assert.deepEqual(
			(await rawRows()).map((row) => row.status),
			["processed"],
		);

		const [account] = await db.select().from(tables.accounts);
		assert.equal(account?.currency, "PLN");
	});

	it("adds a version caused by the raw transaction when its data changes the fields", async () => {
		await ingest(rawCardTransaction());
		const [changed] = await ingest(rawCardTransaction({ details: { merchant_name: "Bolt" } }));
		assert.ok(changed);

		const [transaction, ...others] = await db.select().from(tables.transactions);
		assert.equal(others.length, 0);
		assert.equal(transaction?.merchant, "Bolt");

		const history = await versions();
		assert.deepEqual(
			history.map((version) => [version.cause, version.data.merchant]),
			[
				["raw", null],
				["raw", "Bolt"],
			],
		);
		assert.equal(history[1]?.rawTransactionId, changed.id);
	});

	it("keeps the raw change but adds no version when the fields stay the same", async () => {
		await ingest(rawCardTransaction());
		await ingest(rawCardTransaction({ some_new_bank_field: true }));

		assert.equal((await rawRows()).length, 2);
		assert.equal((await versions()).length, 1);
		assert.deepEqual(
			(await rawRows()).map((row) => row.status),
			["processed", "processed"],
		);
	});

	it("records a rule change as the cause when rules change the fields", async () => {
		await ingest(rawCardTransaction());
		const report = await applyRules([boltRule]);

		assert.equal(report.changes.length, 1);

		const [revision] = await db.select().from(tables.ruleRevisions);
		const history = await versions();
		assert.deepEqual(
			history.map((version) => [version.cause, version.data.merchant, version.ruleRevisionId]),
			[
				["raw", null, null],
				["rules", "Bolt", revision?.id],
			],
		);
		assert.equal(history[1]?.fieldSources.merchant, "bolt");
	});

	it("records a reprocess as the cause when neither raw data nor rules changed", async () => {
		await ingest(rawCardTransaction());
		const [version] = await versions();
		assert.ok(version);

		// Stands in for a version derived by older code
		await db
			.update(tables.transactionVersions)
			.set({ data: { ...version.data, description: "old format" } })
			.where(eq(tables.transactionVersions.id, version.id));

		processBankTransactions(listBankTransactionKeys());

		assert.deepEqual(
			(await versions()).map((v) => [v.cause, v.data.description]),
			[
				["raw", "old format"],
				["reprocess", "BOLT.EU/P/20261003, Tallinn, Estonia"],
			],
		);
	});

	// Stands in for a version derived by older code
	async function makeLatestVersionStale() {
		const version = (await versions()).at(-1);
		assert.ok(version);

		await db
			.update(tables.transactionVersions)
			.set({ data: { ...version.data, description: "old format" } })
			.where(eq(tables.transactionVersions.id, version.id));
	}

	it("blames the code, not the raw data, for a change after raw data that changed no field", async () => {
		await ingest(rawCardTransaction());
		await ingest(rawCardTransaction({ some_new_bank_field: true }));
		await makeLatestVersionStale();

		processBankTransactions(listBankTransactionKeys());

		assert.deepEqual(
			(await versions()).map((v) => v.cause),
			["raw", "reprocess"],
		);
	});

	it("blames the code, not the rules, for a change after rules that changed no field", async () => {
		await ingest(rawCardTransaction());
		await applyRules([
			{
				...boltRule,
				conditions: [{ path: "details.title", operator: "contains", pattern: "nothing" }],
			},
		]);
		await makeLatestVersionStale();

		processBankTransactions(listBankTransactionKeys());

		assert.deepEqual(
			(await versions()).map((v) => v.cause),
			["raw", "reprocess"],
		);
	});

	it("stores the error and keeps the transaction when a new raw version cannot be parsed", async () => {
		await ingest(rawCardTransaction());
		await ingest(rawCardTransaction({ operation_type: "SOMETHING_NEW" }));

		const rows = await rawRows();
		assert.deepEqual(
			rows.map((row) => row.status),
			["processed", "error"],
		);
		assert.equal(rows[1]?.error?.stage, "schema");

		assert.equal((await db.select().from(tables.transactions)).length, 1);
		assert.equal((await versions()).length, 1);
		assert.deepEqual(
			listBankTransactionKeys("error").map((key) => key.bankId),
			["card-1"],
		);
	});

	it("keeps a hold as a raw row without a transaction", async () => {
		await ingest(rawHold());

		assert.deepEqual(
			(await rawRows()).map((row) => row.status),
			["hold"],
		);
		assert.equal((await db.select().from(tables.transactions)).length, 0);
	});

	it("reports changes without writing anything on a dry run", async () => {
		await ingest(rawCardTransaction());

		const report = processBankTransactions(listBankTransactionKeys(), {
			dryRun: true,
			ruleRevision: { id: "preview", rules: [boltRule] },
		});

		assert.equal(report.changes.length, 1);
		assert.deepEqual(
			[
				report.changes[0]?.cause,
				report.changes[0]?.before?.merchant,
				report.changes[0]?.after.merchant,
			],
			["rules", null, "Bolt"],
		);
		assert.equal((await versions()).length, 1);
		assert.equal((await db.select().from(tables.transactions))[0]?.merchant, null);
	});

	it("reports nothing when processing again changes nothing", async () => {
		await ingest(rawCardTransaction());

		const report = processBankTransactions(listBankTransactionKeys());

		assert.deepEqual([report.changes.length, report.unchanged], [0, 1]);
	});
});
