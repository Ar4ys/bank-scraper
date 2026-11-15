import { type MerchantMapEntry } from "../db/schema.ts";
import { IpkoTxType, type IpkoTransaction } from "../ipkoSchemas.ts";
import { counterpartyOf } from "./counterparty.ts";

/**
 * The form in which entry texts and payment fields are compared: case and runs of whitespace do not
 * count
 */
export const matchText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** The entries, oldest first: that order decides between matching texts of the same length */
export type MerchantMap = readonly MerchantMapEntry[];

/**
 * The entry that names the merchant of a transaction:
 *
 * - For a card or mobile payment, of the address and city entries whose text its field contains, the
 *   longest, and of equally long ones the oldest. When the bank names a merchant for the payment,
 *   only entries that override it count.
 * - For a transfer, the counterparty entry whose text is its counterparty, see `counterpartyOf`.
 *
 * `undefined` for other transactions and when nothing matches.
 */
export function findMapEntry(
	tx: IpkoTransaction,
	map: MerchantMap,
	bankNamesMerchant: boolean,
): MerchantMapEntry | undefined {
	const counterparty = counterpartyOf(tx);
	if (counterparty !== undefined) {
		const key = matchText(counterparty);
		return map.find((entry) => entry.field === "counterparty" && entry.matchKey === key);
	}

	if (tx.$type !== IpkoTxType.CardTransaction && tx.$type !== IpkoTxType.MobileTransaction) {
		return undefined;
	}

	const texts: Record<MerchantMapEntry["field"], string | undefined> = {
		address: matchText(tx.details.address),
		city: tx.details.city === undefined ? undefined : matchText(tx.details.city),
		counterparty: undefined,
	};
	let winner: MerchantMapEntry | undefined;

	for (const entry of map) {
		if (bankNamesMerchant && !entry.overridesBankMerchant) continue;

		const text = texts[entry.field];
		if (text === undefined || !text.includes(entry.matchKey)) continue;

		if (!winner || entry.matchKey.length > winner.matchKey.length) winner = entry;
	}

	return winner;
}
