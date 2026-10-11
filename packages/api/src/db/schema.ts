import { randomUUIDv7 } from "node:crypto";

import {
	TransactionAmount,
	type Rule,
	type TransactionField,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { sql } from "drizzle-orm";
import * as s from "drizzle-orm/sqlite-core";
import { type z } from "zod";

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

/**
 * Money in minor units. Stored as INTEGER, because STRICT tables reject NUMERIC; the values are far
 * below 2^53, so reading them back as a JS number first loses nothing.
 */
export const minorUnits = s.customType<{ data: TransactionAmount; driverData: number | bigint }>({
	dataType: () => "integer",
	toDriver: (value) => value,
	fromDriver: (value) => TransactionAmount(BigInt(value)),
});

export type BalanceSource = DefineEnum<typeof BalanceSource>;
export const BalanceSource = Object.freeze({
	Ledger: "ledger",
	Balance: "balance",
});

export type Account = typeof accounts.$inferSelect;
export const accounts = s.snakeCase.table("accounts", {
	// Lunch Flow account ids are numbers, so this one is not a UUID like the others
	id: s.integer().primaryKey(),
	/** The bank's identifier of the account */
	sourceAccount: s.text().notNull().unique(),
	name: s.text().notNull(),
	/** Unknown until the first transaction of the account is processed */
	currency: s.text(),
	/** The bank's `balance`: the money on the account, holds not deducted */
	balanceAmount: minorUnits(),
	/** The bank's `ledger`: `balance` with holds deducted */
	ledgerAmount: minorUnits(),
	balanceCurrency: s.text(),
	/** When the two amounts were scraped */
	balanceAt: instant(),
	/** Which of the two amounts the Lunch Flow API reports as the balance */
	balanceSource: s.text().$type<BalanceSource>().notNull().default(BalanceSource.Ledger),
	createdAt: instant().notNull().default(sqlDateTimeNow),
});

export type RawTransactionStatus = DefineEnum<typeof RawTransactionStatus>;
export const RawTransactionStatus = Object.freeze({
	Unprocessed: "unprocessed",
	Processed: "processed",
	/** A hold (`is_hold: true`): kept, but never turned into a transaction */
	Hold: "hold",
	Error: "error",
});

/** Why a raw transaction could not be turned into a transaction */
export type ProcessingError = {
	/** Which part rejected it: the bank schema, or a value produced by a rule */
	stage: "schema" | "rules";
	message: string;
	issues: z.core.$ZodIssue[];
};

export type RawTransaction = typeof rawTransactions.$inferSelect;
export type InsertRawTransaction = typeof rawTransactions.$inferInsert;
/**
 * Bank transactions exactly as scraped. A transaction whose data changed gets a new row next to the
 * old one, so the rows of one `bankId` are its versions, ordered by `id`.
 */
export const rawTransactions = s.snakeCase.table(
	"raw_transactions",
	{
		id: s.text().primaryKey().$defaultFn(randomUUIDv7),
		accountId: s
			.integer()
			.notNull()
			.references(() => accounts.id),
		bankId: s.text().notNull(),
		data: s.blob({ mode: "json" }).notNull(),
		hash: s.text().notNull(),
		status: s
			.text()
			.$type<RawTransactionStatus>()
			.notNull()
			.default(RawTransactionStatus.Unprocessed),
		error: s.blob({ mode: "json" }).$type<ProcessingError>(),
		createdAt: instant().notNull().default(sqlDateTimeNow),
	},
	(table) => [
		s
			.uniqueIndex("raw_transactions_account_id_bank_id_hash_unique")
			.on(table.accountId, table.bankId, table.hash),
	],
);

export type Merchant = typeof merchants.$inferSelect;
export const merchants = s.snakeCase.table("merchants", {
	id: s.text().primaryKey().$defaultFn(randomUUIDv7),
	/** The name transactions of the merchant get */
	name: s.text().notNull(),
	/** Set while the merchant is deleted: its transactions are derived without a merchant */
	deletedAt: instant(),
	createdAt: instant().notNull().default(sqlDateTimeNow),
	updatedAt: instant().notNull().default(sqlDateTimeNow),
});

export type MerchantName = typeof merchantNames.$inferSelect;
/**
 * Every name that stands for a merchant: the one it is shown with, and the ones merged into it. The
 * merchant text that defaults and rules derive is looked up here.
 */
export const merchantNames = s.snakeCase.table(
	"merchant_names",
	{
		/** The name as it is matched, see `merchantKey` */
		key: s.text().primaryKey(),
		/** The name as it was first seen */
		name: s.text().notNull(),
		merchantId: s
			.text()
			.notNull()
			.references(() => merchants.id),
		createdAt: instant().notNull().default(sqlDateTimeNow),
	},
	(table) => [s.index("merchant_names_merchant_id_index").on(table.merchantId)],
);

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export const transactions = s.snakeCase.table(
	"transactions",
	{
		id: s.text().primaryKey().$defaultFn(randomUUIDv7),
		accountId: s
			.integer()
			.notNull()
			.references(() => accounts.id),
		bankId: s.text().notNull(),
		date: plainDate().notNull(),
		amount: minorUnits().notNull(),
		currency: s.text().notNull(),
		merchant: s.text(),
		/** The merchant whose name `merchant` is */
		merchantId: s.text().references(() => merchants.id),
		description: s.text().notNull(),
		isPending: s.integer({ mode: "boolean" }).notNull(),
		/**
		 * What the transaction was last processed with, whether or not that changed its fields. The
		 * latest version cannot tell: it stays the same for as long as the fields do.
		 */
		rawTransactionId: s.text().references(() => rawTransactions.id),
		ruleRevisionId: s.text().references(() => ruleRevisions.id),
		createdAt: instant().notNull().default(sqlDateTimeNow),
		updatedAt: instant().notNull().default(sqlDateTimeNow),
	},
	(table) => [
		s.uniqueIndex("transactions_account_id_bank_id_unique").on(table.accountId, table.bankId),
		s.index("transactions_account_id_date_index").on(table.accountId, table.date),
		s.index("transactions_merchant_id_index").on(table.merchantId),
	],
);

export type TransactionVersionCause = DefineEnum<typeof TransactionVersionCause>;
export const TransactionVersionCause = Object.freeze({
	/** A new version of the raw transaction arrived */
	Raw: "raw",
	/** A new rule revision was applied */
	Rules: "rules",
	/** Same raw transaction and rules, so the code that derives transactions changed */
	Reprocess: "reprocess",
	/** A merchant was renamed, merged, detached, deleted or restored */
	Merchants: "merchants",
});

/** Which rule set a field, or `"default"` when the code did */
export type FieldSources = Record<TransactionField, string>;

export type TransactionVersion = typeof transactionVersions.$inferSelect;
/** History of a transaction: one row every time its fields changed */
export const transactionVersions = s.snakeCase.table(
	"transaction_versions",
	{
		id: s.text().primaryKey().$defaultFn(randomUUIDv7),
		transactionId: s
			.text()
			.notNull()
			.references(() => transactions.id),
		/** The raw transaction the fields were derived from */
		rawTransactionId: s
			.text()
			.notNull()
			.references(() => rawTransactions.id),
		cause: s.text().$type<TransactionVersionCause>().notNull(),
		/** The rule revision in effect, `null` while no rules were ever applied */
		ruleRevisionId: s.text().references(() => ruleRevisions.id),
		/** Git commit of the build that derived the fields */
		appCommit: s.text().notNull(),
		data: s.blob({ mode: "json" }).$type<TransactionFieldsJson>().notNull(),
		fieldSources: s.blob({ mode: "json" }).$type<FieldSources>().notNull(),
		createdAt: instant().notNull().default(sqlDateTimeNow),
	},
	(table) => [s.index("transaction_versions_transaction_id_index").on(table.transactionId)],
);

/** The rules as they are being edited. Processing uses the latest of `ruleRevisions` instead. */
export const rules = s.snakeCase.table("rules", {
	id: s.text().primaryKey().$defaultFn(randomUUIDv7),
	name: s.text().notNull(),
	priority: s.integer().notNull(),
	enabled: s.integer({ mode: "boolean" }).notNull(),
	txTypes: s.blob({ mode: "json" }).$type<Rule["txTypes"]>(),
	conditions: s.blob({ mode: "json" }).$type<Rule["conditions"]>().notNull(),
	set: s.blob({ mode: "json" }).$type<Rule["set"]>().notNull(),
	createdAt: instant().notNull().default(sqlDateTimeNow),
	updatedAt: instant().notNull().default(sqlDateTimeNow),
});

export type RuleRevision = typeof ruleRevisions.$inferSelect;
/** Snapshots of the whole rule list, one per "apply" */
export const ruleRevisions = s.snakeCase.table("rule_revisions", {
	id: s.text().primaryKey().$defaultFn(randomUUIDv7),
	rules: s.blob({ mode: "json" }).$type<Rule[]>().notNull(),
	createdAt: instant().notNull().default(sqlDateTimeNow),
});
