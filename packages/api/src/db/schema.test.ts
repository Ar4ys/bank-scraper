import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { TransactionAmount } from "@bank-scraper/shared";
import { eq } from "drizzle-orm";

import { accounts, rawTransactions, transactions } from "./schema.ts";
import { createTestDb } from "./testDb.ts";

const { db, cleanup } = await createTestDb();
after(cleanup);

const [account] = await db
	.insert(accounts)
	.values({ sourceAccount: "1", name: "Main" })
	.returning();
assert.ok(account);
const accountId = account.id;

function storedText(table: string, column: string, id: string) {
	const row = db.$client.prepare(`select ${column} as value from ${table} where id = ?`).get(id);
	return row?.value;
}

describe("instant column", () => {
	it("stores an Instant in SQLite datetime format and reads it back", async () => {
		const createdAt = Temporal.Instant.from("2026-08-17T16:39:36.741Z");

		const [inserted] = await db
			.insert(rawTransactions)
			.values({ accountId, bankId: "explicit", data: {}, hash: "hash", createdAt })
			.returning();
		assert.ok(inserted);

		assert.equal(
			storedText("raw_transactions", "created_at", inserted.id),
			"2026-08-17 16:39:36.741",
		);

		const read = await db.query.rawTransactions.findFirst({ where: { id: inserted.id } });
		assert.ok(read?.createdAt.equals(createdAt));
	});

	it("defaults to the current time with millisecond precision", async () => {
		const earliest = Temporal.Now.instant().subtract({ seconds: 1 });

		const [inserted] = await db
			.insert(rawTransactions)
			.values({ accountId, bankId: "default", data: {}, hash: "hash" })
			.returning();
		assert.ok(inserted);

		assert.match(
			String(storedText("raw_transactions", "created_at", inserted.id)),
			/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
		);

		const latest = Temporal.Now.instant().add({ seconds: 1 });
		assert.equal(Temporal.Instant.compare(earliest, inserted.createdAt), -1);
		assert.equal(Temporal.Instant.compare(inserted.createdAt, latest), -1);
	});
});

describe("transactions table", () => {
	it("round-trips plainDate and amount", async () => {
		const date = Temporal.PlainDate.from("2026-08-17");
		const amount = TransactionAmount(-1234n);

		const [inserted] = await db
			.insert(transactions)
			.values({
				accountId,
				bankId: "1",
				date,
				amount,
				currency: "PLN",
				description: "description",
				isPending: false,
			})
			.returning();
		assert.ok(inserted);

		assert.equal(storedText("transactions", "date", inserted.id), "2026-08-17");

		const [read] = await db.select().from(transactions).where(eq(transactions.id, inserted.id));
		assert.ok(read?.date.equals(date));
		assert.equal(read.amount, amount);
	});
});
