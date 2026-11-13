import { type MerchantMapEntry } from "../db/schema.ts";
import { IpkoTxType, type IpkoTransaction } from "../ipkoSchemas.ts";

/**
 * The form in which entry texts and payment fields are compared: case and runs of whitespace do not
 * count
 */
export const matchText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** The entries, oldest first: that order decides between matching texts of the same length */
export type MerchantMap = readonly MerchantMapEntry[];

/**
 * The entry that names the merchant of a card or mobile payment: of the entries whose text its
 * field contains, the longest, and of equally long ones the oldest. `undefined` for other
 * transactions and when nothing matches.
 */
export function findMapEntry(tx: IpkoTransaction, map: MerchantMap): MerchantMapEntry | undefined {
	if (tx.$type !== IpkoTxType.CardTransaction && tx.$type !== IpkoTxType.MobileTransaction) {
		return undefined;
	}

	let winner: MerchantMapEntry | undefined;

	for (const entry of map) {
		const value = tx.details[entry.field];
		if (value === undefined || !matchText(value).includes(entry.matchKey)) continue;

		if (!winner || entry.matchKey.length > winner.matchKey.length) winner = entry;
	}

	return winner;
}
