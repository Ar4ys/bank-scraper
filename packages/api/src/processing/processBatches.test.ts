import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "../db/testDb.ts";
import { rawCardTransaction } from "./fixtures.ts";

const { cleanup } = await createTestDb();
const { db, tables } = await import("../db/db.ts");
const { ingestRawTransactions } = await import("../ingest.ts");
const { listBankTransactionKeys, processBankTransactions } = await import("./process.ts");
after(cleanup);

const payment = (bankId: string, address: string) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details: { address } }),
});

// More bank transactions than one batch reads, over two accounts
const count = 1200;
for (const accountNumber of ["PL01", "PL02"]) {
	for (let start = 0; start < count / 2; start += 200) {
		await ingestRawTransactions({
			accountNumber,
			transactions: Array.from({ length: 200 }, (_, i) =>
				payment(String(start + i), `SHOP ${start + i}`),
			),
		});
	}
}

// A second raw version of one bank transaction, whose fields change
await ingestRawTransactions({ accountNumber: "PL02", transactions: [payment("7", "SHOP SEVEN")] });

const descriptions = () =>
	new Map(
		db
			.select()
			.from(tables.transactions)
			.all()
			.map((transaction) => [
				`${transaction.accountId}/${transaction.bankId}`,
				transaction.description,
			]),
	);

describe("processing in batches", () => {
	it("derives every transaction of every account from its latest raw row", () => {
		const derived = descriptions();
		const [first, second] = db.select().from(tables.accounts).orderBy(tables.accounts.id).all();

		assert.equal(derived.size, count);
		assert.equal(derived.get(`${first?.id}/7`), "SHOP 7, Wroclaw, POLSKA");
		assert.equal(derived.get(`${second?.id}/7`), "SHOP SEVEN, Wroclaw, POLSKA");
	});

	it("finds nothing to change when everything is processed again", () => {
		const report = processBankTransactions(listBankTransactionKeys(), { dryRun: true });

		assert.deepEqual(
			[report.changes.length, report.errors.length, report.unchanged],
			[0, 0, count],
		);
	});

	it("processes a key that is given twice once", () => {
		const [key] = listBankTransactionKeys();
		assert.ok(key);

		const report = processBankTransactions([key, key], { dryRun: true });

		assert.deepEqual([report.changes.length, report.unchanged], [0, 1]);
	});
});
