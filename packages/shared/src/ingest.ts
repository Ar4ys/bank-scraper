import { z } from "zod";

import { zPlainDate, zTransactionAmount } from "./codecs.ts";

/**
 * An account number. Whitespace is removed, so that the same number formatted differently stays one
 * account.
 */
export const accountNumberSchema = z
	.string()
	.transform((value) => value.replaceAll(/\s/g, ""))
	.pipe(z.string().nonempty());

export const ingestBodySchema = z.object({
	/** Number of the account the transactions belong to */
	accountNumber: accountNumberSchema,
	transactions: z.array(
		z.object({
			/** The bank's identifier of the transaction */
			bankId: z.string().nonempty(),
			data: z.json(),
		}),
	),
});
export type IngestBody = z.infer<typeof ingestBodySchema>;

export const accountBalancesBodySchema = z.object({
	accounts: z.array(
		z.object({
			accountNumber: accountNumberSchema,
			/** What the bank calls the account: its nickname if it has one, else the product name */
			name: z.string().nonempty(),
			currency: z.string().nonempty(),
			/** The bank's `balance`: the money on the account, holds not deducted */
			balance: zTransactionAmount,
			/** The bank's `ledger`: `balance` with holds deducted */
			ledger: zTransactionAmount,
		}),
	),
});
/** JSON form: the amounts are text like `1200.15` */
export type AccountBalancesBody = z.input<typeof accountBalancesBodySchema>;

/** A sync of the userscript that loaded every page of the history from `from` to `through` */
export const finishedSyncBodySchema = z
	.object({
		/** The "from" date of iPKO's history filter */
		from: zPlainDate,
		/** The "to" date of iPKO's history filter */
		through: zPlainDate,
	})
	.refine(({ from, through }) => Temporal.PlainDate.compare(from, through) <= 0, {
		message: "from must not be after through",
		path: ["from"],
	});
/** JSON form: the dates are `YYYY-MM-DD` */
export type FinishedSyncBody = z.input<typeof finishedSyncBodySchema>;
