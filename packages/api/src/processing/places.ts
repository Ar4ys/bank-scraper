import { eq, isNull } from "drizzle-orm";

import { db, tables } from "../db/db.ts";
import { IpkoTxType, ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { placeKey, proposeEntryText } from "./placeKey.ts";

/** Places with fewer payments are left out: a one-off needs no merchant */
export const MIN_PLACE_PAYMENTS = 3;

/** Addresses listed per place */
const MAX_PLACE_ADDRESSES = 10;

export type RecurringPlace = {
	key: string;
	payments: number;
	firstDate: string;
	lastDate: string;
	/** Distinct addresses, the most frequent first */
	addresses: Array<{ address: string; payments: number }>;
	/** A merchant map entry text that all its addresses contain */
	proposedText: string;
};

/**
 * Card and mobile payments without a merchant, neither from the bank nor from the map or a rule,
 * grouped by `placeKey` of their address. Places with fewer than `MIN_PLACE_PAYMENTS` payments are
 * left out. The places with the most payments come first.
 */
export function listRecurringPlaces(): RecurringPlace[] {
	const { transactions, rawTransactions } = tables;

	const rows = db
		.select({ date: transactions.date, data: rawTransactions.data })
		.from(transactions)
		.innerJoin(rawTransactions, eq(rawTransactions.id, transactions.rawTransactionId))
		.where(isNull(transactions.merchantId))
		.all();

	const places = new Map<string, { dates: string[]; addresses: Map<string, number> }>();

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

		const place = places.get(key) ?? { dates: [], addresses: new Map<string, number>() };
		place.dates.push(row.date.toString());
		place.addresses.set(tx.details.address, (place.addresses.get(tx.details.address) ?? 0) + 1);
		places.set(key, place);
	}

	return [...places]
		.filter(([, place]) => place.dates.length >= MIN_PLACE_PAYMENTS)
		.map(([key, place]): RecurringPlace => {
			const dates = place.dates.toSorted();
			const addresses = [...place.addresses]
				.map(([address, payments]) => ({ address, payments }))
				.toSorted((a, b) => b.payments - a.payments || a.address.localeCompare(b.address));

			return {
				key,
				payments: dates.length,
				firstDate: dates[0] ?? "",
				lastDate: dates.at(-1) ?? "",
				addresses: addresses.slice(0, MAX_PLACE_ADDRESSES),
				proposedText: proposeEntryText(addresses.map(({ address }) => address)),
			};
		})
		.toSorted((a, b) => b.payments - a.payments || a.key.localeCompare(b.key));
}
