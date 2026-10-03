import { z } from "zod";

import { zTransactionAmount } from "./codecs.ts";

export const ingestBodySchema = z.object({
	/** The bank's identifier of the account the transactions belong to */
	sourceAccount: z.string().nonempty(),
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
			/** The bank's identifier of the account */
			sourceAccount: z.string().nonempty(),
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
