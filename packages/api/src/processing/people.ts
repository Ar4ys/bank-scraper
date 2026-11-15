import { zTransactionAmount } from "@bank-scraper/shared";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, tables } from "../db/db.ts";
import { OperationSide, ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { counterpartyOf } from "./counterparty.ts";
import { matchText } from "./merchantMap.ts";
import {
	MIN_PLACE_PAYMENTS,
	ignoredState,
	type PlacePayment,
	type RecurringPlace,
} from "./places.ts";

/** Put in front of a counterparty's key, so that it can't be taken for a place key when ignored */
export const counterpartyKeyPrefix = "counterparty:";

export type RecurringCounterparty = {
	key: string;
	payments: number;
	sent: number;
	received: number;
	firstDate: string;
	lastDate: string;
	/** Distinct spellings of the name, the most frequent first */
	names: Array<{ name: string; payments: number }>;
	/** The text of a counterparty map entry: the most frequent spelling */
	proposedText: string;
	/** `proposedText` in title case */
	proposedMerchant: string;
	/** Every transfer of the counterparty, the newest first */
	transactions: PlacePayment[];
	ignored: RecurringPlace["ignored"];
};

/**
 * The first letter of every word in upper case, the rest in lower case: `JAN KOWALSKI` → `Jan
 * Kowalski`, `PAYPAL *USER_NAME` → `Paypal *User_name`
 */
export const titleCase = (text: string) =>
	text
		.toLowerCase()
		.replace(/\S+/g, (word) => word.replace(/\p{L}/u, (letter) => letter.toUpperCase()));

/**
 * Transfers and card transfers without a merchant, neither from the map nor from a rule, grouped by
 * their counterparty (see `counterpartyOf`) as `matchText` compares it, sent and received together.
 * Counterparties with fewer than `MIN_PLACE_PAYMENTS` transfers are left out, ignored ones are not:
 * they come with their `ignored` state. The ones with the most transfers come first.
 */
export function listRecurringCounterparties(): RecurringCounterparty[] {
	const { transactions, rawTransactions, ignoredPlaces } = tables;
	const ignores = new Map(
		db
			.select()
			.from(ignoredPlaces)
			.all()
			.map((row) => [row.key, row]),
	);

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

	const groups = new Map<
		string,
		{ payments: PlacePayment[]; names: Map<string, number>; sent: number }
	>();

	for (const row of rows) {
		const parsed = ipkoTransactionSchema.safeParse(row.data);
		if (!parsed.success) continue;

		const counterparty = counterpartyOf(parsed.data);
		if (counterparty === undefined) continue;

		const key = counterpartyKeyPrefix + matchText(counterparty);
		const group = groups.get(key) ?? { payments: [], names: new Map<string, number>(), sent: 0 };
		group.payments.push({
			transactionId: row.id,
			accountId: row.accountId,
			date: row.date.toString(),
			amount: z.encode(zTransactionAmount, row.amount),
			currency: row.currency,
			description: row.description,
		});
		group.names.set(counterparty, (group.names.get(counterparty) ?? 0) + 1);
		if (parsed.data.operation_kind.side === OperationSide.Debit) group.sent++;
		groups.set(key, group);
	}

	return [...groups]
		.filter(([, group]) => group.payments.length >= MIN_PLACE_PAYMENTS)
		.map(([key, group]): RecurringCounterparty => {
			const payments = group.payments.toSorted(
				(a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId),
			);
			const names = [...group.names]
				.map(([name, count]) => ({ name, payments: count }))
				.toSorted((a, b) => b.payments - a.payments || a.name.localeCompare(b.name));
			const proposedText = names[0]?.name ?? "";

			return {
				key,
				payments: payments.length,
				sent: group.sent,
				received: payments.length - group.sent,
				firstDate: payments.at(-1)?.date ?? "",
				lastDate: payments[0]?.date ?? "",
				names,
				proposedText,
				proposedMerchant: titleCase(proposedText),
				transactions: payments,
				ignored: ignoredState(ignores.get(key), payments[0]?.date ?? ""),
			};
		})
		.toSorted((a, b) => b.payments - a.payments || a.key.localeCompare(b.key));
}
