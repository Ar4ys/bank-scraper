import { defaultFieldSource, mapEntryIdOfSource, mapFieldSource } from "@bank-scraper/shared";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/db.ts";
import { type MerchantMapEntry } from "../db/schema.ts";
import { IpkoTxType, ipkoTransactionSchema, type IpkoTransaction } from "../ipkoSchemas.ts";
import { counterpartyOf } from "./counterparty.ts";
import { matchText } from "./merchantMap.ts";
import { getLatestRuleRevision, mapEntryLabel } from "./process.ts";

/** What sets the merchant of payments an entry's text matches, when it isn't the entry */
export type OtherMerchantSource =
	| { kind: "bank" }
	| { kind: "entry"; label: string }
	| { kind: "rule"; label: string }
	/** Processed before the entry existed or changed, and not again since */
	| { kind: "stale" };

export type EntryCoverage = {
	/**
	 * Card and mobile payments whose field contains the entry's text, or for a counterparty entry the
	 * transfers whose counterparty it is
	 */
	matching: number;
	/** Of those, the ones whose merchant the entry sets */
	set: number;
	/** The rest, by what sets their merchant, the largest group first */
	others: Array<OtherMerchantSource & { payments: number }>;
};

/** Whether the entry's text matches the transaction, whichever entry wins it */
function entryMatches(entry: MerchantMapEntry, tx: IpkoTransaction) {
	if (entry.field === "counterparty") {
		const counterparty = counterpartyOf(tx);
		return counterparty !== undefined && matchText(counterparty) === entry.matchKey;
	}

	if (tx.$type !== IpkoTxType.CardTransaction && tx.$type !== IpkoTxType.MobileTransaction) {
		return false;
	}
	const field = entry.field === "address" ? tx.details.address : tx.details.city;
	return field !== undefined && matchText(field).includes(entry.matchKey);
}

/** Whether the bank names a merchant for the transaction */
const bankNamesMerchant = (tx: IpkoTransaction) =>
	(tx.$type === IpkoTxType.CardTransaction || tx.$type === IpkoTxType.MobileTransaction) &&
	Boolean(tx.details.merchant_name?.trim());

/**
 * Which transactions a merchant map entry's text matches, and what sets the merchant of those it
 * doesn't name. Reads and parses every processed transaction on each call.
 */
export function explainMapEntry(entry: MerchantMapEntry): EntryCoverage {
	const { transactions, rawTransactions, merchantMapEntries } = tables;
	const rows = db
		.select({ fieldSources: transactions.fieldSources, data: rawTransactions.data })
		.from(transactions)
		.innerJoin(rawTransactions, eq(rawTransactions.id, transactions.rawTransactionId))
		.all();

	const entries = new Map(
		db
			.select()
			.from(merchantMapEntries)
			.all()
			.map((row) => [row.id, row]),
	);
	const rules = new Map(getLatestRuleRevision().rules.map((rule) => [rule.id, rule.name]));
	const ownSource = mapFieldSource(entry.id);

	const coverage: EntryCoverage = { matching: 0, set: 0, others: [] };
	const others = new Map<string, OtherMerchantSource & { payments: number }>();
	const count = (key: string, source: OtherMerchantSource) => {
		const group = others.get(key) ?? { ...source, payments: 0 };
		group.payments++;
		others.set(key, group);
	};

	for (const row of rows) {
		const parsed = ipkoTransactionSchema.safeParse(row.data);
		if (!parsed.success) continue;

		const tx = parsed.data;
		if (!entryMatches(entry, tx)) continue;

		coverage.matching++;
		const source = row.fieldSources?.merchant;
		if (source === ownSource) {
			coverage.set++;
			continue;
		}

		const otherEntryId = source === undefined ? undefined : mapEntryIdOfSource(source);
		if (source !== undefined && otherEntryId !== undefined) {
			const other = entries.get(otherEntryId);
			count(source, { kind: "entry", label: other ? mapEntryLabel(other) : "a deleted entry" });
		} else if (source !== undefined && source !== defaultFieldSource) {
			count(source, { kind: "rule", label: rules.get(source) ?? "a rule no longer applied" });
		} else if (bankNamesMerchant(tx)) {
			count("bank", { kind: "bank" });
		} else {
			count("stale", { kind: "stale" });
		}
	}

	coverage.others = [...others.values()].toSorted((a, b) => b.payments - a.payments);
	return coverage;
}
