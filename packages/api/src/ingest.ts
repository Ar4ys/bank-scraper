import { type accountBalancesBodySchema, type IngestBody } from "@bank-scraper/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type z } from "zod";

import { db, tables } from "./db/db.ts";
import { processBankTransactions } from "./processing/process.ts";
import { jsonSha256 } from "./utils.ts";

async function findOrCreateAccount(sourceAccount: string) {
	await db
		.insert(tables.accounts)
		.values({ sourceAccount, name: sourceAccount })
		.onConflictDoNothing();

	const account = await db.query.accounts.findFirst({ where: { sourceAccount } });
	if (!account) throw new Error(`Account "${sourceAccount}" is missing right after its insert`);

	return account;
}

/**
 * Stores scraped transactions, processes the new ones and returns their rows as stored. A
 * transaction that is already stored with the same data is skipped; one whose data changed is
 * stored as a new row next to the old one, which keeps a log of how the bank's data changes over
 * time.
 */
export async function ingestRawTransactions({ sourceAccount, transactions }: IngestBody) {
	const account = await findOrCreateAccount(sourceAccount);

	if (!transactions.length) return [];

	const inserted = await db
		.insert(tables.rawTransactions)
		.values(
			transactions.map((transaction) => ({
				accountId: account.id,
				bankId: transaction.bankId,
				data: transaction.data,
				hash: jsonSha256(transaction.data),
			})),
		)
		.onConflictDoNothing()
		.returning();

	try {
		processBankTransactions(inserted);
	} catch (error) {
		// The raw rows are what must not get lost: they stay unprocessed and can be reprocessed later
		console.error("Processing of ingested transactions failed:", error);
	}

	return inserted;
}

type AccountBalances = z.output<typeof accountBalancesBodySchema>;

/**
 * Stores the scraped balances, creating accounts that are new. The bank's name of an account is
 * taken over only while the account still has its default name, so a rename in the admin app
 * stays.
 */
export async function ingestAccountBalances({ accounts }: AccountBalances) {
	const balanceAt = Temporal.Now.instant();

	for (const scraped of accounts) {
		const account = await findOrCreateAccount(scraped.sourceAccount);

		await db
			.update(tables.accounts)
			.set({
				balanceAmount: scraped.balance,
				ledgerAmount: scraped.ledger,
				balanceCurrency: scraped.currency,
				balanceAt,
			})
			.where(eq(tables.accounts.id, account.id));

		await db
			.update(tables.accounts)
			.set({ currency: scraped.currency })
			.where(and(eq(tables.accounts.id, account.id), isNull(tables.accounts.currency)));

		// The default name is the bank's identifier, see findOrCreateAccount
		await db
			.update(tables.accounts)
			.set({ name: scraped.name })
			.where(
				and(eq(tables.accounts.id, account.id), eq(tables.accounts.name, account.sourceAccount)),
			);
	}

	return { updated: accounts.length };
}

/**
 * The newest `order_date` among the stored transactions of an account, or `null` while none is
 * stored. It is the date iPKO's history filter applies to. Holds are left out.
 */
export async function getLastOrderDate(sourceAccount: string): Promise<string | null> {
	const { accounts, rawTransactions } = tables;
	const field = (path: string) => sql`json_extract(cast(${rawTransactions.data} as text), ${path})`;

	const [row] = await db
		.select({ orderDate: sql<string | null>`max(${field("$.details.order_date")})` })
		.from(rawTransactions)
		.innerJoin(accounts, eq(accounts.id, rawTransactions.accountId))
		.where(
			and(
				eq(accounts.sourceAccount, sourceAccount),
				sql`coalesce(${field("$.is_hold")}, false) = false`,
			),
		);

	return row?.orderDate ?? null;
}
