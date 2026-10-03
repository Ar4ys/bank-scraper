import { Err, Ok, Result } from "neverthrow";
import { z } from "zod";

import { db, tables } from "./db/db.ts";
import {
	type InsertRawTransaction,
	type InsertTransaction,
	type RawTransaction,
} from "./db/schema.ts";
import { ipkoTransactionSchema, IpkoTxType } from "./ipkoSchemas.ts";
import { assertNever, jsonSha256 } from "./utils.ts";

export const rawTransactionsInputSchema = z
	.object({
		bankId: z.string().nonempty(),
		data: z.json(),
	})
	.array();

type RawTransactionsInput = z.infer<typeof rawTransactionsInputSchema>;

export async function insertRawTransactionsBatch(rawTransactionsInput: RawTransactionsInput) {
	const query = rawTransactionsInput.map((t) => ({
		bankId: t.bankId,
		hash: jsonSha256(t.data),
	}));

	const existingTransactions = await db.query.rawTransactions.findMany({
		where: {
			OR: query,
		},
		columns: {
			id: true,
			bankId: true,
		},
	});

	const existingBankIds = existingTransactions.map((t) => t.bankId);
	const newTransactions = rawTransactionsInput
		.filter((t) => !existingBankIds.includes(t.bankId))
		.map((t): InsertRawTransaction => ({
			bankId: t.bankId,
			data: t.data,
			hash: jsonSha256(t.data),
		}));

	if (!newTransactions.length) return [];

	const insertedTransactions = await db
		.insert(tables.rawTransactions)
		.values(newTransactions)
		.returning();

	return insertedTransactions;
}

export async function processRawTransaction(rawTransaction: RawTransaction) {
	const { data, error } = ipkoTransactionSchema.safeParse(rawTransaction.data);

	if (error) {
		return new Err(error);
	}

	switch (data.$type) {
		case IpkoTxType.CardTransaction:
		case IpkoTxType.CardTransferSend:
		case IpkoTxType.Fees:
		case IpkoTxType.ForeignTransferReceive:
		case IpkoTxType.ForeignTransferSend:
		case IpkoTxType.MobileAtmTransaction:
		case IpkoTxType.MobileTransaction:
		case IpkoTxType.PhoneTopUp:
		case IpkoTxType.TransferReceive:
		case IpkoTxType.TransferSend:
		case IpkoTxType.TransitTicketPurchase: {
			const a: InsertTransaction = {
				bankId: data.operation_id,
				date: data.details.order_date,
				amount: data.money.amount,
				currency: data.money.currency,
				merchant: "",
				description: data.title,
				isPending: data.is_hold,
			};
			break;
		}

		default:
			assertNever(data, "Unhandled $type of ipko transaction");
	}
}
