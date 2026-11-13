import { zTransactionAmount } from "@bank-scraper/shared";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, tables } from "../db/db.ts";
import { IpkoTxType, ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { placeKey, proposeEntryText } from "./placeKey.ts";

/** Places with fewer payments are left out: a one-off needs no merchant */
export const MIN_PLACE_PAYMENTS = 3;

/** Addresses listed per place */
const MAX_PLACE_ADDRESSES = 10;

export type PlacePayment = {
	transactionId: string;
	accountId: number;
	date: string;
	amount: string;
	currency: string;
	description: string;
};

export type RecurringPlace = {
	key: string;
	payments: number;
	firstDate: string;
	lastDate: string;
	/** Distinct addresses, the most frequent first */
	addresses: Array<{ address: string; payments: number }>;
	/** A merchant map entry text that all its addresses contain */
	proposedText: string;
	/** Every payment of the place, the newest first */
	transactions: PlacePayment[];
};

/**
 * Card and mobile payments without a merchant, neither from the bank nor from the map or a rule,
 * grouped by `placeKey` of their address. Places with fewer than `MIN_PLACE_PAYMENTS` payments are
 * left out. The places with the most payments come first.
 */
export function listRecurringPlaces(): RecurringPlace[] {
	const { transactions, rawTransactions } = tables;

	const rows = db
		.select({
			id: transactions.id,
			accountId: transactions.accountId,
			date: transactions.date,
			amount: transactions.amount,
			currency: transactions.currency,
			description: transactions.description,
			data: rawTransactions.data,
		})
		.from(transactions)
		.innerJoin(rawTransactions, eq(rawTransactions.id, transactions.rawTransactionId))
		.where(isNull(transactions.merchantId))
		.all();

	const places = new Map<string, { payments: PlacePayment[]; addresses: Map<string, number> }>();

	for (const row of rows) {
		const parsed = ipkoTransactionSchema.safeParse(row.data);
		if (!parsed.success) continue;

		const tx = parsed.data;
		if (tx.$type !== IpkoTxType.CardTransaction && tx.$type !== IpkoTxType.MobileTransaction) {
			continue;
		}
		if (tx.details.merchant_name?.trim()) continue;

		const key = placeKey(tx.details.address);
		if (key === "") continue;

		const place = places.get(key) ?? { payments: [], addresses: new Map<string, number>() };
		place.payments.push({
			transactionId: row.id,
			accountId: row.accountId,
			date: row.date.toString(),
			amount: z.encode(zTransactionAmount, row.amount),
			currency: row.currency,
			description: row.description,
		});
		place.addresses.set(tx.details.address, (place.addresses.get(tx.details.address) ?? 0) + 1);
		places.set(key, place);
	}

	return [...places]
		.filter(([, place]) => place.payments.length >= MIN_PLACE_PAYMENTS)
		.map(([key, place]): RecurringPlace => {
			const payments = place.payments.toSorted(
				(a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId),
			);
			const addresses = [...place.addresses]
				.map(([address, count]) => ({ address, payments: count }))
				.toSorted((a, b) => b.payments - a.payments || a.address.localeCompare(b.address));

			return {
				key,
				payments: payments.length,
				firstDate: payments.at(-1)?.date ?? "",
				lastDate: payments[0]?.date ?? "",
				addresses: addresses.slice(0, MAX_PLACE_ADDRESSES),
				proposedText: proposeEntryText(addresses.map(({ address }) => address)),
				transactions: payments,
			};
		})
		.toSorted((a, b) => b.payments - a.payments || a.key.localeCompare(b.key));
}
