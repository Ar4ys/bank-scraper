import { z } from "zod";

import { zPlainDate, zTransactionAmount } from "./codecs.ts";

/** The fields of an internal transaction that are derived from a bank transaction */
export const transactionFieldsSchema = z.object({
	date: zPlainDate,
	amount: zTransactionAmount,
	currency: z.string(),
	merchant: z.string().nullable(),
	description: z.string(),
	/** Details of a transfer, one `Label: value` per line */
	notes: z.string().nullable(),
	isPending: z.boolean(),
});

export type TransactionFields = z.output<typeof transactionFieldsSchema>;
/** JSON form of {@link TransactionFields}: the date and the amount are strings */
export type TransactionFieldsJson = z.input<typeof transactionFieldsSchema>;
export type TransactionField = keyof TransactionFields;
