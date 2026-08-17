import { randomUUIDv7 } from "node:crypto";

import { sql } from "drizzle-orm";
import * as s from "drizzle-orm/sqlite-core";

// SQLite uses a weird datetime format - like an ISO string but without timezone:
// SQLite 2026-08-17 16:39:36.741 === ISO 2026-08-17T16:39:36.741Z
export const timestamp = s.customType<{ data: Date; driverData: string }>({
	dataType: () => "text",
	toDriver: (value) => value.toISOString().replace("T", " ").replace("Z", ""),
	fromDriver: (value) => new Date(value.replace(" ", "T") + "Z"),
});

export function defaultNow() {
	return timestamp()
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`);
}

export type RawTransaction = typeof rawTransactions.$inferSelect;
export type InsertRawTransaction = typeof rawTransactions.$inferInsert;
export const rawTransactions = s.snakeCase.table(
	"raw_transactions",
	{
		id: s.text().primaryKey().$defaultFn(randomUUIDv7),
		bankId: s.text().notNull(),
		data: s.blob({ mode: "json" }).notNull(),
		hash: s.text().notNull(),
		processed: s.integer({ mode: "boolean" }).notNull().default(false),
		createdAt: defaultNow(),
	},
	(table) => [s.index("raw_transactions_bank_id_index").on(table.bankId)],
);
