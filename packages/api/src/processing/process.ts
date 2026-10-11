import { isDeepStrictEqual } from "node:util";

import {
	transactionFieldsSchema,
	type Rule,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { config } from "../config.ts";
import { db, inTransaction, tables } from "../db/db.ts";
import {
	RawTransactionStatus,
	sqlDateTimeNow,
	TransactionVersionCause,
	type FieldSources,
	type ProcessingError,
} from "../db/schema.ts";
import { deriveTransaction } from "./derive.ts";
import { loadMerchantDirectory, resolveMerchant, type MerchantDirectory } from "./merchants.ts";

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
	/**
	 * What the caller changed before processing. A transaction of which only the merchant changes is
	 * recorded with this cause; any other change gets the cause it would get without it.
	 */
	cause?: typeof TransactionVersionCause.Merchants;
};

type ProcessContext = {
	ruleRevision: RuleRevisionRef;
	merchantDirectory: MerchantDirectory;
	dryRun: boolean;
	cause: ProcessOptions["cause"];
	report: ProcessingReport;
};

const withoutMerchant = (fields: TransactionFieldsJson) => ({ ...fields, merchant: null });

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
	{ ruleRevision, merchantDirectory, dryRun, cause: causeOfCaller, report }: ProcessContext,
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

	const merchant = resolveMerchant(derived.fields.merchant, merchantDirectory, dryRun);
	const derivedFields: TransactionFieldsJson = { ...derived.fields, merchant: merchant.name };

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

	/** Remembers what the transaction was processed with, so that the next change gets the right cause */
	const markProcessed = (transactionId: string) => {
		db.update(transactions)
			.set({ rawTransactionId: raw.id, ruleRevisionId: ruleRevision.id, merchantId: merchant.id })
			.where(eq(transactions.id, transactionId))
			.run();
		setRawStatus(RawTransactionStatus.Processed);
	};

	if (transaction && latestVersion && isDeepStrictEqual(latestVersion.data, derivedFields)) {
		report.unchanged++;
		if (!dryRun) markProcessed(transaction.id);
		return;
	}

	// The first of raw data, rules and code that differs from the last processing is the cause
	let cause: TransactionVersionCause = TransactionVersionCause.Raw;
	if (transaction && (transaction.rawTransactionId ?? latestVersion?.rawTransactionId) === raw.id) {
		const lastRevisionId = transaction.rawTransactionId
			? transaction.ruleRevisionId
			: (latestVersion?.ruleRevisionId ?? null);

		cause =
			lastRevisionId === ruleRevision.id
				? TransactionVersionCause.Reprocess
				: TransactionVersionCause.Rules;
	}

	if (
		causeOfCaller &&
		latestVersion &&
		isDeepStrictEqual(withoutMerchant(latestVersion.data), withoutMerchant(derivedFields))
	) {
		cause = causeOfCaller;
	}

	report.changes.push({
		...key,
		rawTransactionId: raw.id,
		transactionId: transaction?.id ?? null,
		cause,
		before: latestVersion?.data ?? null,
		after: derivedFields,
		fieldSources: derived.fieldSources,
	});

	if (dryRun) return;

	const fields = z.decode(transactionFieldsSchema, derivedFields);

	const transactionId = transaction
		? transaction.id
		: db
				.insert(transactions)
				.values({ ...key, ...fields, merchantId: merchant.id })
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
			data: derivedFields,
			fieldSources: derived.fieldSources,
		})
		.run();

	db.update(accounts)
		.set({ currency: fields.currency })
		.where(and(eq(accounts.id, key.accountId), isNull(accounts.currency)))
		.run();

	markProcessed(transactionId);
}

/**
 * Derives transactions from the latest raw row of each given bank transaction and records a new
 * version for every transaction whose fields changed. The merchant text that defaults and rules
 * derive is replaced by the name of the merchant it stands for, see `resolveMerchant`. A raw row
 * that cannot be processed gets the error stored on it and leaves its transaction as it was.
 */
export function processBankTransactions(
	keys: readonly BankTransactionKey[],
	{ dryRun = false, ruleRevision = getLatestRuleRevision(), cause }: ProcessOptions = {},
): ProcessingReport {
	const report: ProcessingReport = { changes: [], errors: [], unchanged: 0, holds: 0 };

	inTransaction(() => {
		const context = {
			ruleRevision,
			merchantDirectory: loadMerchantDirectory(),
			dryRun,
			cause,
			report,
		};

		for (const key of keys) processOne(key, context);
	});

	return report;
}

/**
 * Processes the transactions that have a merchant text but no merchant yet, which is how
 * transactions from before merchants were stored get theirs.
 */
export function linkTransactionsToMerchants() {
	const { transactions } = tables;

	const keys = db
		.select({ accountId: transactions.accountId, bankId: transactions.bankId })
		.from(transactions)
		.where(and(isNotNull(transactions.merchant), isNull(transactions.merchantId)))
		.all();

	if (keys.length) processBankTransactions(keys);
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
