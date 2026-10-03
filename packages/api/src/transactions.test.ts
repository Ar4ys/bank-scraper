import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { rawTransactions } from "./db/schema.ts";
import { createTestDb } from "./db/testDb.ts";

const { db, cleanup } = await createTestDb();
const { insertRawTransactionsBatch } = await import("./transactions.ts");
after(cleanup);

describe("insertRawTransactionsBatch", () => {
	beforeEach(async () => {
		await db.delete(rawTransactions);
	});

	it("inserts new transactions as unprocessed", async () => {
		const inserted = await insertRawTransactionsBatch([
			{ bankId: "1", data: { title: "first" } },
			{ bankId: "2", data: { title: "second" } },
		]);

		assert.deepEqual(
			inserted.map((t) => [t.bankId, t.data, t.processed]),
			[
				["1", { title: "first" }, "unprocessed"],
				["2", { title: "second" }, "unprocessed"],
			],
		);
	});

	it("skips a transaction that is already stored with the same data", async () => {
		await insertRawTransactionsBatch([{ bankId: "1", data: { title: "first", amount: "1.00" } }]);

		const inserted = await insertRawTransactionsBatch([
			// Different key order must still count as the same data
			{ bankId: "1", data: { amount: "1.00", title: "first" } },
			{ bankId: "2", data: { title: "second" } },
		]);

		assert.deepEqual(
			inserted.map((t) => t.bankId),
			["2"],
		);
		assert.equal((await db.select().from(rawTransactions)).length, 2);
	});

	it("keeps a new row when the data of a known transaction changes", async () => {
		await insertRawTransactionsBatch([{ bankId: "1", data: { title: "first" } }]);

		const inserted = await insertRawTransactionsBatch([
			{ bankId: "1", data: { title: "first", category: "new field" } },
		]);

		assert.equal(inserted.length, 1);

		const stored = await db.query.rawTransactions.findMany({ where: { bankId: "1" } });
		assert.deepEqual(
			stored.map((t) => t.data),
			[{ title: "first" }, { title: "first", category: "new field" }],
		);
	});

	it("returns an empty array when there is nothing new", async () => {
		const batch = [{ bankId: "1", data: { title: "first" } }];
		await insertRawTransactionsBatch(batch);

		assert.deepEqual(await insertRawTransactionsBatch(batch), []);
	});
});
