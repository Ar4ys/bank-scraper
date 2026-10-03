import { randomUUIDv7 } from "node:crypto";

import { type TransactionAmount } from "@bank-scraper/shared";
import { sql } from "drizzle-orm";
import * as s from "drizzle-orm/sqlite-core";

import { type DefineEnum } from "../utils.ts";

// SQLite uses a weird datetime format - like an ISO string but without timezone:
// SQLite 2026-08-17 16:39:36.741 === ISO 2026-08-17T16:39:36.741Z
export const instant = s.customType<{ data: Temporal.Instant; driverData: string }>({
	dataType: () => "text",
	toDriver: (value) =>
		value
			.toString({ smallestUnit: "milliseconds", fractionalSecondDigits: 3 })
			.replace("T", " ")
			.replace("Z", ""),
	fromDriver: (value) => Temporal.Instant.from(value.replace(" ", "T") + "Z"),
});

export const sqlDateTimeNow = sql`(datetime('now', 'subsec'))`;

export const plainDate = s.customType<{ data: Temporal.PlainDate; driverData: string }>({
	dataType: () => "text",
	toDriver: (value) => value.toString(),
	fromDriver: (value) => Temporal.PlainDate.from(value),
});

export type RawTransactionStatus = DefineEnum<typeof RawTransactionStatus>;
export const RawTransactionStatus = Object.freeze({
	Unprocessed: "unprocessed",
	Processed: "processed",
	Error: "error",
});

export type RawTransaction = typeof rawTransactions.$inferSelect;
export type InsertRawTransaction = typeof rawTransactions.$inferInsert;
export const rawTransactions = s.snakeCase.table(
	"raw_transactions",
	{
		id: s.text().primaryKey().$defaultFn(randomUUIDv7),
		bankId: s.text().notNull(),
		data: s.blob({ mode: "json" }).notNull(),
		hash: s.text().notNull(),
		processed: s
			.text()
			.$type<RawTransactionStatus>()
			.notNull()
			.default(RawTransactionStatus.Unprocessed),
		error: s.blob({ mode: "json" }),
		createdAt: instant().notNull().default(sqlDateTimeNow),
	},
	(table) => [s.index("raw_transactions_bank_id_index").on(table.bankId)],
);

// {
//   "transactions": [
//     {
//       "id": "string",
//       "accountId": 0,
//       "amount": 0,
//       "currency": "string",
//       "date": "2019-08-24",
//       "merchant": "string",
//       "description": "string",
//       "isPending": true
//     }
//   ],
//   "total": 0
// }

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export const transactions = s.snakeCase.table("transactions", {
	id: s.text().primaryKey().$defaultFn(randomUUIDv7),
	bankId: s.text().notNull(),
	date: plainDate().notNull(),
	amount: s.numeric({ mode: "bigint" }).notNull().$type<TransactionAmount>(),
	currency: s.text().notNull(),
	merchant: s.text(),
	description: s.text().notNull(),
	isPending: s.integer({ mode: "boolean" }).notNull(),
	createdAt: instant().notNull().default(sqlDateTimeNow),
});
