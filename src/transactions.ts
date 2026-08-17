import { z } from "zod";

import { db, tables } from "./db/db.ts";
import { type InsertRawTransaction, type RawTransaction } from "./db/schema.ts";
import { jsonSha256 } from "./utils.ts";

export const rawTransactionsInputSchema = z
	.object({
		bankId: z.string().nonempty(),
		data: z.json(),
	})
	.array();

type RawTransactionsInput = z.infer<typeof rawTransactionsInputSchema>;

export async function insertRawTransactionsBatch(
	rawTransactionsInput: RawTransactionsInput,
) {
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

const transactionSchema = z.object({
	operation_id: z.string(),
	date: z.string(),
	money: z.object({ amount: z.string(), currency: z.string() }),
	title: z.string(),
	operation_kind: z.object({ code: z.string(), side: z.string() }),
	operation_type: z.string(),
	details: z.object({
		exec_date: z.string(),
		hold_registration_date: z.string().optional(),
		operation_kind: z.object({ code: z.string(), side: z.string() }),
		money: z.object({ amount: z.string(), currency: z.string() }),
		title: z.string(),
		address: z.string().optional(),
		city: z.string().optional(),
		country: z.string().optional(),
		country_code: z.string().optional(),
		merchant_name: z.string().optional(),
		category: z.string().optional(),
		order_date: z.string().optional(),
		subcategories: z.string().optional(),
		phone_number: z
			.object({ country_code: z.string(), number: z.string() })
			.optional(),
		transaction_id: z.string().optional(),
		other_account: z.string().optional(),
		recipient_name_and_address: z.string().optional(),
		card_number: z.string().optional(),
		oper_date_time: z.string().optional(),
		settlement_date: z.string().optional(),
		original_amount: z
			.object({ amount: z.string(), currency: z.string() })
			.optional(),
		sender_name_and_address: z.string().optional(),
	}),
	avatar_url: z.string().nullable(),
	google_place_id: z.string().nullable(),
	coordinates: z.object({
		latitude: z.string().nullable(),
		longitude: z.string().nullable(),
	}),
	other_side: z.string().nullable(),
	is_hold: z.boolean(),
	is_other_side_recipient: z.boolean().nullable(),
});

export async function proccessRawTranasction(rawTransaction: RawTransaction) {}
