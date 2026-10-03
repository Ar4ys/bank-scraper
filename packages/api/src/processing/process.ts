import { isDeepStrictEqual } from "node:util";

import {
	transactionFieldsSchema,
	type Rule,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { config } from "../config.ts";
import { db, tables } from "../db/db.ts";
import {
	RawTransactionStatus,
	sqlDateTimeNow,
	TransactionVersionCause,
	type FieldSources,
	type ProcessingError,
} from "../db/schema.ts";
import { deriveTransaction } from "./derive.ts";

/** Identifies one bank transaction; its raw rows are the versions of it */
export type BankTransactionKey = { accountId: number; bankId: string };

export type RuleRevisionRef = {
	/** `null` while no rules were ever applied */
	id: string | null;
	rules: readonly Rule[];
};

export type TransactionChange = BankTransactionKey & {
	rawTransactionId: string;
	/** `null` when the change creates the transaction */
	transactionId: string | null;
	cause: TransactionVersionCause;
	before: TransactionFieldsJson | null;
	after: TransactionFieldsJson;
	fieldSources: FieldSources;
};

export type ProcessingReport = {
	changes: TransactionChange[];
	errors: Array<BankTransactionKey & { rawTransactionId: string; error: ProcessingError }>;
	unchanged: number;
	holds: number;
};

export type ProcessOptions = {
	/** Report what would change without writing anything */
	dryRun?: boolean;
	/** Rules to derive with instead of the latest applied revision */
	ruleRevision?: RuleRevisionRef;
};

export function getLatestRuleRevision(): RuleRevisionRef {
	const revision = db
		.select()
		.from(tables.ruleRevisions)
		.orderBy(desc(tables.ruleRevisions.id))
		.limit(1)
		.get();

	return revision ? { id: revision.id, rules: revision.rules } : { id: null, rules: [] };
}

function processOne(
	key: BankTransactionKey,
	ruleRevision: RuleRevisionRef,
	dryRun: boolean,
	report: ProcessingReport,
) {
	const { rawTransactions, transactions, transactionVersions, accounts } = tables;

	// Only the latest version of the bank's data counts, older rows are history
	const raw = db
		.select()
		.from(rawTransactions)
		.where(
			and(eq(rawTransactions.accountId, key.accountId), eq(rawTransactions.bankId, key.bankId)),
		)
		.orderBy(desc(rawTransactions.id))
		.limit(1)
		.get();

	if (!raw) return;

	const setRawStatus = (status: RawTransactionStatus, error: ProcessingError | null = null) => {
		if (dryRun) return;
		db.update(rawTransactions).set({ status, error }).where(eq(rawTransactions.id, raw.id)).run();
	};

	const derived = deriveTransaction(raw.data, ruleRevision.rules);

	if (derived.status === RawTransactionStatus.Hold) {
		report.holds++;
		setRawStatus(RawTransactionStatus.Hold);
		return;
	}

	if (derived.status === RawTransactionStatus.Error) {
		report.errors.push({ ...key, rawTransactionId: raw.id, error: derived.error });
		setRawStatus(RawTransactionStatus.Error, derived.error);
		return;
	}

	const transaction = db
		.select()
		.from(transactions)
		.where(and(eq(transactions.accountId, key.accountId), eq(transactions.bankId, key.bankId)))
		.get();

	const latestVersion =
		transaction &&
		db
			.select()
			.from(transactionVersions)
			.where(eq(transactionVersions.transactionId, transaction.id))
			.orderBy(desc(transactionVersions.id))
			.limit(1)
			.get();

	if (latestVersion && isDeepStrictEqual(latestVersion.data, derived.fields)) {
		report.unchanged++;
		setRawStatus(RawTransactionStatus.Processed);
		return;
	}

	let cause: TransactionVersionCause = TransactionVersionCause.Raw;
	if (latestVersion?.rawTransactionId === raw.id) {
		cause =
			latestVersion.ruleRevisionId === ruleRevision.id
				? TransactionVersionCause.Reprocess
				: TransactionVersionCause.Rules;
	}

	report.changes.push({
		...key,
		rawTransactionId: raw.id,
		transactionId: transaction?.id ?? null,
		cause,
		before: latestVersion?.data ?? null,
		after: derived.fields,
		fieldSources: derived.fieldSources,
	});

	if (dryRun) return;

	const fields = z.decode(transactionFieldsSchema, derived.fields);

	const transactionId = transaction
		? transaction.id
		: db
				.insert(transactions)
				.values({ ...key, ...fields })
				.returning({ id: transactions.id })
				.get().id;

	if (transaction) {
		db.update(transactions)
			.set({ ...fields, updatedAt: sqlDateTimeNow })
			.where(eq(transactions.id, transaction.id))
			.run();
	}

	db.insert(transactionVersions)
		.values({
			transactionId,
			rawTransactionId: raw.id,
			cause,
			ruleRevisionId: ruleRevision.id,
			appCommit: config.APP_GIT_COMMIT,
			data: derived.fields,
			fieldSources: derived.fieldSources,
		})
		.run();

	db.update(accounts)
		.set({ currency: fields.currency })
		.where(and(eq(accounts.id, key.accountId), isNull(accounts.currency)))
		.run();

	setRawStatus(RawTransactionStatus.Processed);
}

/**
 * Derives transactions from the latest raw row of each given bank transaction and records a new
 * version for every transaction whose fields changed. A raw row that cannot be processed gets the
 * error stored on it and leaves its transaction as it was.
 */
export function processBankTransactions(
	keys: readonly BankTransactionKey[],
	{ dryRun = false, ruleRevision = getLatestRuleRevision() }: ProcessOptions = {},
): ProcessingReport {
	const report: ProcessingReport = { changes: [], errors: [], unchanged: 0, holds: 0 };

	db.transaction(() => {
		for (const key of keys) processOne(key, ruleRevision, dryRun, report);
	});

	return report;
}

/** Keys of every bank transaction, or only of those whose latest raw row has the given status */
export function listBankTransactionKeys(status?: RawTransactionStatus): BankTransactionKey[] {
	const { rawTransactions } = tables;

	const latest = db
		.select({
			accountId: rawTransactions.accountId,
			bankId: rawTransactions.bankId,
			latestId: sql<string>`max(${rawTransactions.id})`.as("latest_id"),
		})
		.from(rawTransactions)
		.groupBy(rawTransactions.accountId, rawTransactions.bankId)
		.as("latest");

	return db
		.select({ accountId: rawTransactions.accountId, bankId: rawTransactions.bankId })
		.from(rawTransactions)
		.innerJoin(latest, eq(latest.latestId, rawTransactions.id))
		.where(status ? eq(rawTransactions.status, status) : undefined)
		.orderBy(rawTransactions.id)
		.all();
}
