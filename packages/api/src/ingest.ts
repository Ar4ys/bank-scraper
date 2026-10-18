import {
	type accountBalancesBodySchema,
	type finishedSyncBodySchema,
	type IngestBody,
} from "@bank-scraper/shared";
import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { type z } from "zod";

import { db, tables } from "./db/db.ts";
import { processBankTransactions } from "./processing/process.ts";
import { jsonSha256 } from "./utils.ts";

async function findOrCreateAccount(number: string) {
	await db.insert(tables.accounts).values({ number, name: number }).onConflictDoNothing();

	const account = await db.query.accounts.findFirst({ where: { number } });
	if (!account) throw new Error(`Account "${number}" is missing right after its insert`);

	return account;
}

/**
 * Stores scraped transactions, processes the new ones and returns their rows as stored. A
 * transaction that is already stored with the same data is skipped; one whose data changed is
 * stored as a new row next to the old one, which keeps a log of how the bank's data changes over
 * time.
 */
export async function ingestRawTransactions({ accountNumber, transactions }: IngestBody) {
	const account = await findOrCreateAccount(accountNumber);

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
		const account = await findOrCreateAccount(scraped.accountNumber);

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

		// The default name is the account number, see findOrCreateAccount
		await db
			.update(tables.accounts)
			.set({ name: scraped.name })
			.where(and(eq(tables.accounts.id, account.id), eq(tables.accounts.name, account.number)));
	}

	return { updated: accounts.length };
}

/** Up to which date the syncs of an account loaded its history, `null` while none finished */
export async function getSyncedThrough(accountNumber: string) {
	const account = await db.query.accounts.findFirst({ where: { number: accountNumber } });
	return account?.syncedThrough ?? null;
}

/**
 * Records a finished sync and returns the account's `syncedThrough` afterwards. It moves to the
 * sync's `through` only while nothing is recorded yet or the sync started on or before the recorded
 * date: a sync that started later left a gap before it, which the next sync has to cover.
 */
export async function recordFinishedSync(
	accountNumber: string,
	{ from, through }: z.output<typeof finishedSyncBodySchema>,
) {
	const account = await findOrCreateAccount(accountNumber);
	const { accounts } = tables;

	await db
		.update(accounts)
		.set({ syncedThrough: through })
		.where(
			and(
				eq(accounts.id, account.id),
				or(
					isNull(accounts.syncedThrough),
					and(gte(accounts.syncedThrough, from), lt(accounts.syncedThrough, through)),
				),
			),
		);

	return await getSyncedThrough(accountNumber);
}
