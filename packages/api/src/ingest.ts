import { type IngestBody } from "@bank-scraper/shared";

import { db, tables } from "./db/db.ts";
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
 * Stores scraped transactions and returns the rows that were new. A transaction that is already
 * stored with the same data is skipped; one whose data changed is stored as a new row next to the
 * old one, which keeps a log of how the bank's data changes over time.
 */
export async function ingestRawTransactions({ sourceAccount, transactions }: IngestBody) {
	const account = await findOrCreateAccount(sourceAccount);

	if (!transactions.length) return [];

	return db
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
}
