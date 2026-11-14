import {
	defaultFieldSource,
	mapEntryIdOfSource,
	mapFieldSource,
	transactionFieldsSchema,
	zTransactionAmount,
	type Rule,
} from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { and, count, countDistinct, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { adminBrandfetchApi } from "./adminBrandfetch.ts";
import { adminMerchantMapApi } from "./adminMerchantMap.ts";
import { adminMerchantsApi } from "./adminMerchants.ts";
import { adminRulesApi } from "./adminRules.ts";
import { adminSureApi } from "./adminSure.ts";
import { db, tables } from "./db/db.ts";
import {
	BalanceSource,
	RawTransactionStatus,
	type Account,
	type RawTransaction,
	type Transaction,
} from "./db/schema.ts";
import { parseForRules } from "./processing/derive.ts";
import {
	listBankTransactionKeys,
	mapEntryLabel,
	processBankTransactions,
} from "./processing/process.ts";
import { readUserscript, userscriptInstallPath, userscriptVersion } from "./userscript.ts";
import { escapeLikePattern } from "./utils.ts";

const { accounts, rawTransactions, ruleRevisions, transactions, transactionVersions } = tables;

const pageQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(100),
	offset: z.coerce.number().int().min(0).default(0),
});

const optionalAccountId = z.coerce.number().int().optional();

/** Dates and amounts cross the wire in their JSON form, see `transactionFieldsSchema` */
const transactionJson = (transaction: Transaction) => ({
	id: transaction.id,
	accountId: transaction.accountId,
	bankId: transaction.bankId,
	...z.encode(transactionFieldsSchema, transaction),
	createdAt: transaction.createdAt.toString(),
	updatedAt: transaction.updatedAt.toString(),
});

const accountJson = (account: Account) => ({
	id: account.id,
	number: account.number,
	name: account.name,
	currency: account.currency,
	balance:
		account.balanceAmount === null ? null : z.encode(zTransactionAmount, account.balanceAmount),
	ledger: account.ledgerAmount === null ? null : z.encode(zTransactionAmount, account.ledgerAmount),
	balanceCurrency: account.balanceCurrency,
	balanceAt: account.balanceAt?.toString() ?? null,
	balanceSource: account.balanceSource,
	syncedThrough: account.syncedThrough?.toString() ?? null,
});

const countOf = (counts: { accountId: number; count: number }[], accountId: number) =>
	counts.find((row) => row.accountId === accountId)?.count ?? 0;

const rawTransactionJson = (raw: RawTransaction) => ({
	id: raw.id,
	accountId: raw.accountId,
	bankId: raw.bankId,
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	data: raw.data as Record<string, unknown>,
	status: raw.status,
	error: raw.error && { stage: raw.error.stage, message: raw.error.message },
	createdAt: raw.createdAt.toString(),
});

/** The latest raw row of every bank transaction, with the number of raw versions it has */
const latestRawTransactions = () => {
	const versions = db
		.select({
			latestId: sql<string>`max(${rawTransactions.id})`.as("latest_id"),
			versionCount: count().as("version_count"),
		})
		.from(rawTransactions)
		.groupBy(rawTransactions.accountId, rawTransactions.bankId)
		.as("versions");

	return { versions, join: eq(versions.latestId, rawTransactions.id) };
};

/**
 * JSON API of the admin app. It has no auth of its own and has to sit behind a reverse proxy.
 * Successful responses state their 200, which is how the typed client tells them from errors.
 */
export const adminApi = new Hono()
	.route("/rules", adminRulesApi)
	.route("/merchants", adminMerchantsApi)
	.route("/merchant-map", adminMerchantMapApi)
	.route("/sure", adminSureApi)
	.route("/brandfetch", adminBrandfetchApi)

	/** GET /api/admin/dashboard */
	.get("/dashboard", async (c) => {
		const { versions, join } = latestRawTransactions();

		const statuses = await db
			.select({ status: rawTransactions.status, total: count() })
			.from(rawTransactions)
			.innerJoin(versions, join)
			.groupBy(rawTransactions.status);

		const [totals] = await db
			.select({
				transactions: count(),
				withoutMerchant: sql<number>`count(*) filter (where ${isNull(transactions.merchant)})`,
			})
			.from(transactions);

		return c.json(
			{
				// Counted per bank transaction, by the status of its latest raw version
				rawByStatus: Object.fromEntries(
					Object.values(RawTransactionStatus).map((status) => [
						status,
						statuses.find((row) => row.status === status)?.total ?? 0,
					]),
				),
				transactions: totals?.transactions ?? 0,
				transactionsWithoutMerchant: totals?.withoutMerchant ?? 0,
			},
			200,
		);
	})

	/** GET /api/admin/userscript */
	.get("/userscript", async (c) => {
		const script = await readUserscript();

		return c.json(
			{
				installPath: userscriptInstallPath(),
				/** `null` while the userscript is not built */
				version: script === undefined ? null : userscriptVersion(script),
			},
			200,
		);
	})

	/** GET /api/admin/accounts */
	.get("/accounts", async (c) => {
		const [rows, transactionCounts, rawTransactionCounts] = await Promise.all([
			db.select().from(accounts).orderBy(accounts.id),
			db
				.select({ accountId: transactions.accountId, count: count() })
				.from(transactions)
				.groupBy(transactions.accountId),
			// Bank transactions, like the raw transactions list: the versions of one count once
			db
				.select({
					accountId: rawTransactions.accountId,
					count: countDistinct(rawTransactions.bankId),
				})
				.from(rawTransactions)
				.groupBy(rawTransactions.accountId),
		]);

		return c.json(
			rows.map((account) => ({
				...accountJson(account),
				transactionCount: countOf(transactionCounts, account.id),
				rawTransactionCount: countOf(rawTransactionCounts, account.id),
			})),
			200,
		);
	})

	/** PATCH /api/admin/accounts/:id */
	.patch(
		"/accounts/:id",
		zValidator("param", z.object({ id: z.coerce.number().int() })),
		zValidator(
			"json",
			z.object({
				name: z.string().trim().nonempty().optional(),
				/** Which scraped amount the Lunch Flow API reports as the balance */
				balanceSource: z.enum(BalanceSource).optional(),
			}),
		),
		async (c) => {
			const { id } = c.req.valid("param");
			const changes = c.req.valid("json");

			if (changes.name !== undefined || changes.balanceSource !== undefined) {
				await db.update(accounts).set(changes).where(eq(accounts.id, id));
			}

			const [account] = await db.select().from(accounts).where(eq(accounts.id, id));

			return account
				? c.json(accountJson(account), 200)
				: c.json({ message: "Account not found" }, 404);
		},
	)

	/** GET /api/admin/raw-transactions */
	.get(
		"/raw-transactions",
		zValidator(
			"query",
			pageQuerySchema.extend({
				accountId: optionalAccountId,
				status: z.enum(RawTransactionStatus).optional(),
			}),
		),
		async (c) => {
			const { limit, offset, accountId, status } = c.req.valid("query");
			const { versions, join } = latestRawTransactions();

			const where = and(
				accountId === undefined ? undefined : eq(rawTransactions.accountId, accountId),
				status && eq(rawTransactions.status, status),
			);

			const rows = await db
				.select({ raw: rawTransactions, versionCount: versions.versionCount })
				.from(rawTransactions)
				.innerJoin(versions, join)
				.where(where)
				.orderBy(desc(rawTransactions.id))
				.limit(limit)
				.offset(offset);

			const [total] = await db
				.select({ total: count() })
				.from(rawTransactions)
				.innerJoin(versions, join)
				.where(where);

			return c.json(
				{
					items: rows.map(({ raw, versionCount }) => ({
						...rawTransactionJson(raw),
						versionCount,
					})),
					total: total?.total ?? 0,
				},
				200,
			);
		},
	)

	/** GET /api/admin/raw-transactions/:accountId/:bankId */
	.get(
		"/raw-transactions/:accountId/:bankId",
		zValidator("param", z.object({ accountId: z.coerce.number().int(), bankId: z.string() })),
		async (c) => {
			const { accountId, bankId } = c.req.valid("param");

			const versions = await db
				.select()
				.from(rawTransactions)
				.where(and(eq(rawTransactions.accountId, accountId), eq(rawTransactions.bankId, bankId)))
				.orderBy(rawTransactions.id);

			if (!versions.length) return c.json({ message: "Raw transaction not found" }, 404);

			const [transaction] = await db
				.select({ id: transactions.id })
				.from(transactions)
				.where(and(eq(transactions.accountId, accountId), eq(transactions.bankId, bankId)));

			return c.json(
				{
					/** Oldest first */
					versions: versions.map(rawTransactionJson),
					transactionId: transaction?.id ?? null,
					/** The latest version as rules see it, `null` if it is a hold or cannot be parsed */
					parsed: parseForRules(versions.at(-1)?.data) ?? null,
				},
				200,
			);
		},
	)

	/** GET /api/admin/transactions */
	.get(
		"/transactions",
		zValidator(
			"query",
			pageQuerySchema.extend({
				accountId: optionalAccountId,
				/** `true` lists only transactions that have no merchant */
				withoutMerchant: z.stringbool().optional(),
				merchantId: z.string().optional(),
				/** Lists only transactions whose merchant this merchant map entry sets now */
				merchantMapEntryId: z.string().optional(),
				/** Text to find in merchant, description or the bank's id */
				search: z.string().optional(),
			}),
		),
		async (c) => {
			const { limit, offset, accountId, withoutMerchant, merchantId, merchantMapEntryId, search } =
				c.req.valid("query");
			const pattern = search && `%${escapeLikePattern(search)}%`;

			const where = and(
				accountId === undefined ? undefined : eq(transactions.accountId, accountId),
				withoutMerchant ? isNull(transactions.merchant) : undefined,
				merchantId ? eq(transactions.merchantId, merchantId) : undefined,
				merchantMapEntryId
					? sql`json_extract(${transactions.fieldSources}, '$.merchant') = ${mapFieldSource(merchantMapEntryId)}`
					: undefined,
				pattern
					? or(
							like(transactions.merchant, pattern),
							like(transactions.description, pattern),
							like(transactions.bankId, pattern),
						)
					: undefined,
			);

			const rows = await db
				.select()
				.from(transactions)
				.where(where)
				.orderBy(desc(transactions.date), desc(transactions.id))
				.limit(limit)
				.offset(offset);

			const [total] = await db.select({ total: count() }).from(transactions).where(where);

			return c.json({ items: rows.map(transactionJson), total: total?.total ?? 0 }, 200);
		},
	)

	/** GET /api/admin/transactions/:id */
	.get("/transactions/:id", async (c) => {
		const [transaction] = await db
			.select()
			.from(transactions)
			.where(eq(transactions.id, c.req.param("id")));

		if (!transaction) return c.json({ message: "Transaction not found" }, 404);

		const versions = await db
			.select({ version: transactionVersions, revisionRules: ruleRevisions.rules })
			.from(transactionVersions)
			.leftJoin(ruleRevisions, eq(ruleRevisions.id, transactionVersions.ruleRevisionId))
			.where(eq(transactionVersions.transactionId, transaction.id))
			.orderBy(transactionVersions.id);

		const currentSources: Record<string, string> = transaction.fieldSources ?? {};
		const mapEntryIds = [
			...Object.values(currentSources),
			...versions.flatMap(({ version }) => Object.values(version.fieldSources)),
		].flatMap((source) => mapEntryIdOfSource(source) ?? []);
		const currentRevision = transaction.ruleRevisionId
			? db
					.select()
					.from(ruleRevisions)
					.where(eq(ruleRevisions.id, transaction.ruleRevisionId))
					.get()
			: undefined;
		const mapEntries = mapEntryIds.length
			? await db
					.select()
					.from(tables.merchantMapEntries)
					.where(inArray(tables.merchantMapEntries.id, mapEntryIds))
			: [];

		/** The name of a rule or a map entry that set a field, `null` for a rule the revision lacks */
		const sourceName = (source: string, revisionRules: Rule[] | null) => {
			const mapEntryId = mapEntryIdOfSource(source);
			if (mapEntryId === undefined) {
				return revisionRules?.find((rule) => rule.id === source)?.name ?? null;
			}

			const entry = mapEntries.find((candidate) => candidate.id === mapEntryId);
			return entry ? mapEntryLabel(entry) : "Map entry (deleted)";
		};

		return c.json(
			{
				transaction: transactionJson(transaction),
				/**
				 * What sets each field now: `default` for the code's value from the bank's data, a rule
				 * with its name in the revision the transaction was processed with, or a map entry. Empty
				 * for a transaction not processed since sources were recorded.
				 */
				currentSources: Object.entries(currentSources).map(([field, source]) => ({
					field,
					source,
					name:
						source === defaultFieldSource
							? null
							: sourceName(source, currentRevision?.rules ?? null),
				})),
				/** Oldest first */
				versions: versions.map(({ version, revisionRules }) => ({
					id: version.id,
					rawTransactionId: version.rawTransactionId,
					cause: version.cause,
					ruleRevisionId: version.ruleRevisionId,
					appCommit: version.appCommit,
					data: version.data,
					/**
					 * Fields a rule or a merchant map entry set, with the name the rule had in that revision,
					 * or the entry's text and merchant
					 */
					fieldRules: Object.entries(version.fieldSources)
						.filter(([, source]) => source !== defaultFieldSource)
						.map(([field, ruleId]) => ({
							field,
							ruleId,
							ruleName: sourceName(ruleId, revisionRules),
						})),
					createdAt: version.createdAt.toString(),
				})),
			},
			200,
		);
	})

	/** POST /api/admin/reprocess */
	.post(
		"/reprocess",
		zValidator(
			"json",
			z.object({
				scope: z.union([
					z.literal("all"),
					/** Bank transactions whose latest raw version failed */
					z.literal("failed"),
					z.object({ accountId: z.number().int(), bankId: z.string() }),
				]),
				/** Report what would change without writing anything */
				dryRun: z.boolean(),
			}),
		),
		(c) => {
			const { scope, dryRun } = c.req.valid("json");

			const keys =
				scope === "all"
					? listBankTransactionKeys()
					: scope === "failed"
						? listBankTransactionKeys(RawTransactionStatus.Error)
						: [scope];

			const report = processBankTransactions(keys, { dryRun });

			return c.json(
				{
					...report,
					errors: report.errors.map(({ error, ...rest }) => ({
						...rest,
						error: { stage: error.stage, message: error.message },
					})),
				},
				200,
			);
		},
	);

export type AdminApi = typeof adminApi;
