import { isDeepStrictEqual } from "node:util";

import {
	mapEntryIdOfSource,
	mapFieldSource,
	transactionFieldsSchema,
	type Rule,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
import { type MerchantMap } from "./merchantMap.ts";
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
	/** `$type` of the bank transaction */
	txType: string;
	before: TransactionFieldsJson | null;
	after: TransactionFieldsJson;
	/** Rule ids, map sources or `defaultFieldSource`, that set the fields of `before` */
	fieldSourcesBefore: FieldSources | null;
	fieldSources: FieldSources;
};

export type ProcessingReport = {
	changes: TransactionChange[];
	errors: Array<
		BankTransactionKey & {
			rawTransactionId: string;
			error: ProcessingError;
			/** `null` when the bank's data cannot be parsed */
			txType: string | null;
			/** The fields without rules, `null` when the bank's data cannot be parsed */
			fields: TransactionFieldsJson | null;
		}
	>;
	unchanged: number;
	holds: number;
	/**
	 * Names of the rules and merchant map entries in the field sources of the changes, by source. A
	 * rule that is not in the rules processed with has the name it had in the revision that set the
	 * field; a map entry that no longer exists has none.
	 */
	sourceNames: Record<string, string>;
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
	cause?: typeof TransactionVersionCause.Merchants | typeof TransactionVersionCause.MerchantMap;
};

type ProcessContext = {
	ruleRevision: RuleRevisionRef;
	merchantMap: MerchantMap;
	merchantDirectory: MerchantDirectory;
	dryRun: boolean;
	cause: ProcessOptions["cause"];
	report: ProcessingReport;
	/** Revisions the `before` of the reported changes were derived with, for the names of their rules */
	revisionIdsBefore: Set<string>;
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
	{
		ruleRevision,
		merchantMap,
		merchantDirectory,
		dryRun,
		cause: causeOfCaller,
		report,
		revisionIdsBefore,
	}: ProcessContext,
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

	const derived = deriveTransaction(raw.data, ruleRevision.rules, merchantMap);

	if (derived.status === RawTransactionStatus.Hold) {
		report.holds++;
		setRawStatus(RawTransactionStatus.Hold);
		return;
	}

	if (derived.status === RawTransactionStatus.Error) {
		report.errors.push({
			...key,
			rawTransactionId: raw.id,
			error: derived.error,
			txType: derived.context?.txType ?? null,
			fields: derived.context?.fields ?? null,
		});
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
			.set({
				rawTransactionId: raw.id,
				ruleRevisionId: ruleRevision.id,
				merchantId: merchant.id,
				fieldSources: derived.fieldSources,
			})
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
		txType: derived.txType,
		before: latestVersion?.data ?? null,
		after: derivedFields,
		fieldSourcesBefore: latestVersion?.fieldSources ?? null,
		fieldSources: derived.fieldSources,
	});
	if (latestVersion?.ruleRevisionId) revisionIdsBefore.add(latestVersion.ruleRevisionId);

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
	const report: ProcessingReport = {
		changes: [],
		errors: [],
		unchanged: 0,
		holds: 0,
		sourceNames: {},
	};

	inTransaction(() => {
		const context = {
			ruleRevision,
			merchantMap: loadMerchantMap(),
			merchantDirectory: loadMerchantDirectory(),
			dryRun,
			cause,
			report,
			revisionIdsBefore: new Set<string>(),
		};

		for (const key of keys) processOne(key, context);

		report.sourceNames = {
			...getRuleNames(ruleRevision.rules, [...context.revisionIdsBefore]),
			...getMapSourceNames(report.changes),
		};
	});

	return report;
}

/** Rule names by id: those of `rules`, then those of older revisions for rules not among them */
function getRuleNames(rules: readonly Rule[], revisionIds: string[]): Record<string, string> {
	const { ruleRevisions } = tables;

	const revisions = revisionIds.length
		? db
				.select({ rules: ruleRevisions.rules })
				.from(ruleRevisions)
				.where(inArray(ruleRevisions.id, revisionIds))
				.orderBy(ruleRevisions.id)
				.all()
		: [];

	return Object.fromEntries(
		[...revisions.flatMap((revision) => revision.rules), ...rules].map((rule) => [
			rule.id,
			rule.name,
		]),
	);
}

/** Every merchant map entry, oldest first, see `MerchantMap` */
export const loadMerchantMap = (): MerchantMap =>
	db.select().from(tables.merchantMapEntries).orderBy(tables.merchantMapEntries.id).all();

/** `Map: "<text>" → <merchant>` of a map entry */
export const mapEntryLabel = (entry: { text: string; merchant: string }) =>
	`Map: "${entry.text}" → ${entry.merchant}`;

/** Labels of the map entries that set a field of the changes, by source; deleted entries have none */
function getMapSourceNames(changes: readonly TransactionChange[]): Record<string, string> {
	const entryIds = new Set(
		changes
			.flatMap((change) => [
				...Object.values(change.fieldSources),
				...Object.values(change.fieldSourcesBefore ?? {}),
			])
			.flatMap((source) => mapEntryIdOfSource(source) ?? []),
	);
	if (!entryIds.size) return {};

	const { merchantMapEntries } = tables;
	return Object.fromEntries(
		db
			.select()
			.from(merchantMapEntries)
			.where(inArray(merchantMapEntries.id, [...entryIds]))
			.all()
			.map((entry) => [mapFieldSource(entry.id), mapEntryLabel(entry)]),
	);
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
