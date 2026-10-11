import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { type Rule } from "@bank-scraper/shared";
import { eq } from "drizzle-orm";

import * as tables from "../db/schema.ts";
import { createTestDb } from "../db/testDb.ts";
import { rawCardTransaction, rawHold } from "./fixtures.ts";

const { db, cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("../ingest.ts");
const { linkTransactionsToMerchants, listBankTransactionKeys, processBankTransactions } =
	await import("./process.ts");
after(cleanup);

const sourceAccount = "PL00";

const ingest = (data: ReturnType<typeof rawCardTransaction>) =>
	ingestRawTransactions({
		sourceAccount,
		transactions: [
			{ bankId: typeof data.operation_id === "string" ? data.operation_id : "", data },
		],
	});

const lidlPayment = () => rawCardTransaction({ details: { merchant_name: "Lidl" } });

const lidlRule: Rule = {
	id: "lidl",
	name: "Lidl",
	priority: 0,
	enabled: true,
	txTypes: null,
	conditions: [{ path: "details.address", operator: "contains", pattern: "lidl" }],
	set: { merchant: "Lidl" },
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
		await db.delete(tables.merchantNames);
		await db.delete(tables.merchants);
		await db.delete(tables.rawTransactions);
		await db.delete(tables.ruleRevisions);
		await db.delete(tables.accounts);
	});

	it("creates a transaction with its first version on ingest", async () => {
		const [raw] = await ingest(rawCardTransaction());
		assert.ok(raw);

		const [transaction] = await db.select().from(tables.transactions);
		assert.ok(transaction);
		assert.equal(transaction.bankId, "19");
		assert.equal(transaction.amount, -5733n);
		assert.equal(transaction.date.toString(), "2022-02-11");
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
		const [changed] = await ingest(rawCardTransaction({ details: { merchant_name: "Lidl" } }));
		assert.ok(changed);

		const [transaction, ...others] = await db.select().from(tables.transactions);
		assert.equal(others.length, 0);
		assert.equal(transaction?.merchant, "Lidl");

		const history = await versions();
		assert.deepEqual(
			history.map((version) => [version.cause, version.data.merchant]),
			[
				["raw", null],
				["raw", "Lidl"],
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
		const report = await applyRules([lidlRule]);

		assert.equal(report.changes.length, 1);

		const [revision] = await db.select().from(tables.ruleRevisions);
		const history = await versions();
		assert.deepEqual(
			history.map((version) => [version.cause, version.data.merchant, version.ruleRevisionId]),
			[
				["raw", null, null],
				["rules", "Lidl", revision?.id],
			],
		);
		assert.equal(history[1]?.fieldSources.merchant, "lidl");
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
				["reprocess", "LIDL 3011, Wroclaw, POLSKA"],
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
				...lidlRule,
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
			["19"],
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
			ruleRevision: { id: "preview", rules: [lidlRule] },
		});

		assert.equal(report.changes.length, 1);
		assert.deepEqual(
			[
				report.changes[0]?.cause,
				report.changes[0]?.before?.merchant,
				report.changes[0]?.after.merchant,
			],
			["rules", null, "Lidl"],
		);
		assert.equal((await versions()).length, 1);
		assert.equal((await db.select().from(tables.transactions))[0]?.merchant, null);
		assert.equal((await db.select().from(tables.merchants)).length, 0);
	});

	it("reports nothing when processing again changes nothing", async () => {
		await ingest(rawCardTransaction());

		const report = processBankTransactions(listBankTransactionKeys());

		assert.deepEqual([report.changes.length, report.unchanged], [0, 1]);
	});

	const reprocessForMerchants = () =>
		processBankTransactions(listBankTransactionKeys(), { cause: "merchants" });

	it("creates the merchant a new merchant text stands for", async () => {
		await ingest(lidlPayment());

		const [merchant, ...others] = await db.select().from(tables.merchants);
		assert.ok(merchant);
		assert.equal(others.length, 0);
		assert.equal(merchant.name, "Lidl");

		assert.deepEqual(
			(await db.select().from(tables.merchantNames)).map((name) => [
				name.key,
				name.name,
				name.merchantId,
			]),
			[["lidl", "Lidl", merchant.id]],
		);
		assert.equal((await db.select().from(tables.transactions))[0]?.merchantId, merchant.id);
	});

	it("gives a text that differs only in case the name of the merchant that is known", async () => {
		await ingest(lidlPayment());
		await ingest(rawCardTransaction({ operation_id: "20", details: { merchant_name: "LIDL" } }));

		assert.equal((await db.select().from(tables.merchants)).length, 1);
		assert.deepEqual(
			(await db.select().from(tables.transactions)).map((transaction) => transaction.merchant),
			["Lidl", "Lidl"],
		);
	});

	it("gives transactions the new name of their merchant and blames the merchants for it", async () => {
		await ingest(lidlPayment());
		await db.update(tables.merchants).set({ name: "Lidl Polska" });

		const report = reprocessForMerchants();

		assert.equal(report.changes.length, 1);
		assert.deepEqual(
			(await versions()).map((version) => [version.cause, version.data.merchant]),
			[
				["raw", "Lidl"],
				["merchants", "Lidl Polska"],
			],
		);
		assert.equal((await db.select().from(tables.transactions))[0]?.merchant, "Lidl Polska");
	});

	it("derives no merchant for the names of a deleted merchant", async () => {
		await ingest(lidlPayment());
		await db.update(tables.merchants).set({ deletedAt: Temporal.Now.instant() });

		reprocessForMerchants();

		const [transaction] = await db.select().from(tables.transactions);
		assert.deepEqual([transaction?.merchant, transaction?.merchantId], [null, null]);
		assert.equal((await db.select().from(tables.merchants)).length, 1);
	});

	it("blames the code, not the merchants, when more than the merchant changed", async () => {
		await ingest(lidlPayment());
		await makeLatestVersionStale();
		await db.update(tables.merchants).set({ name: "Lidl Polska" });

		reprocessForMerchants();

		assert.deepEqual(
			(await versions()).map((version) => version.cause),
			["raw", "reprocess"],
		);
	});

	it("links transactions that have a merchant text but no merchant, without a new version", async () => {
		await ingest(lidlPayment());
		// Stands in for a transaction from before merchants were stored
		await db.update(tables.transactions).set({ merchantId: null });
		await db.delete(tables.merchantNames);
		await db.delete(tables.merchants);

		linkTransactionsToMerchants();

		const [merchant] = await db.select().from(tables.merchants);
		assert.equal(merchant?.name, "Lidl");
		assert.equal((await db.select().from(tables.transactions))[0]?.merchantId, merchant?.id);
		assert.equal((await versions()).length, 1);
	});
});
