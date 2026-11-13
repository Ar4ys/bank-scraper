import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { createTestDb } from "../db/testDb.ts";
import { rawCardTransaction } from "./fixtures.ts";

const { cleanup } = await createTestDb();
const { db, tables } = await import("../db/db.ts");
const { ingestRawTransactions } = await import("../ingest.ts");
const { listBankTransactionKeys, processBankTransactions } = await import("./process.ts");
after(cleanup);

/** The SQL of every statement that ran since the last `beforeEach` */
let executed: string[] = [];
beforeEach(() => {
	executed = [];
});

// Counts what runs, not what is prepared, so a reused statement is counted every time it runs
const runMethods = new Set<PropertyKey>(["all", "get", "run", "iterate"]);
const prepare = db.$client.prepare.bind(db.$client);
db.$client.prepare = (sql: string) =>
	new Proxy(prepare(sql), {
		get(target, property) {
			const value: unknown = Reflect.get(target, property);
			if (typeof value !== "function") return value;

			// Native methods refuse the proxy as `this`
			return (...args: unknown[]): unknown => {
				if (runMethods.has(property)) executed.push(sql);
				return Reflect.apply(value, target, args);
			};
		},
	});

const reads = () => executed.filter((sql) => /^\s*select/i.test(sql)).length;
const writes = () => executed.filter((sql) => /^\s*(insert|update|delete)/i.test(sql)).length;

const payment = (bankId: string, address: string) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details: { address } }),
});

// Three batches of reads (they read 500 bank transactions at a time), over two accounts
const accounts = ["PL01", "PL02"];
const perAccount = 600;
for (const accountNumber of accounts) {
	for (let start = 0; start < perAccount; start += 200) {
		await ingestRawTransactions({
			accountNumber,
			transactions: Array.from({ length: 200 }, (_, i) =>
				payment(String(start + i), `SHOP ${start + i}`),
			),
		});
	}
}

const keys = listBankTransactionKeys();
const batches = Math.ceil(keys.length / 500);

describe("queries of a reprocess", () => {
	it("reads in batches, not per transaction", () => {
		processBankTransactions(keys);

		// Per batch: raw rows and transactions per account, versions once; plus the rules, the
		// merchant map and the merchant directory once per run
		const expected = batches * (accounts.length * 2 + 1) + 3;
		assert.ok(
			reads() <= expected,
			`${reads()} reads for ${keys.length} transactions, expected at most ${expected}`,
		);
	});

	it("writes nothing when nothing changes", () => {
		processBankTransactions(keys);

		assert.equal(writes(), 0, executed.filter((sql) => !/^\s*select/i.test(sql)).join("\n"));
	});

	it("writes only for the transactions that change", () => {
		db.insert(tables.merchantMapEntries)
			.values({ field: "address", text: "SHOP 599", matchKey: "shop 599", merchant: "Shop" })
			.run();
		executed = [];

		const report = processBankTransactions(keys);

		// Per changed transaction: its fields, its new version, what it was processed with, and the
		// account's currency while that is unknown. Once: the new merchant and its name.
		const expected = report.changes.length * 4 + 2;
		assert.equal(report.changes.length, accounts.length);
		assert.ok(
			writes() <= expected,
			`${writes()} writes for ${report.changes.length} changed transactions, expected at most ${expected}`,
		);
	});
});
