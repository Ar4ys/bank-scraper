import { zPlainDate, zTransactionAmount } from "@bank-scraper/shared";
import { z } from "zod";

import { type DefineEnum } from "./utils.ts";
import { zMdu } from "./zod.ts";

const type =
	<const TType extends string>(typeName: TType) =>
	<TSchema extends z.ZodObject>(schema: TSchema) =>
		z
			.object({
				...(schema.shape as TSchema["shape"]),
				$type: z.literal(typeName).default(typeName),
			})
			.describe(typeName);

export type IpkoTxType = DefineEnum<typeof IpkoTxType>;
export const IpkoTxType = Object.freeze({
	CardTransaction: "cardTransaction",
	CardTransferSend: "cardTransferSend",
	MobileTransaction: "mobileTransaction",
	MobileAtmTransaction: "mobileAtmTransaction",
	TransferSend: "transferSend",
	TransferReceive: "transferReceive",
	ForeignTransferSend: "foreignTransferSend",
	ForeignTransferReceive: "foreignTransferReceive",
	TransitTicketPurchase: "transitTicketPurchase",
	PhoneTopUp: "phoneTopUp",
	Fees: "fees",
});

export type OperationType = DefineEnum<typeof OperationType>;
export const OperationType = Object.freeze({
	CardTransaction: "CARD_TRANSACTION",
	MobileTransaction: "MOBILE_TRANSACTION",
	Transfer: "TRANSFER_NORMAL",
	ForeignTransfer: "REALIZED_DPW",
	Other: "OTHER",
});

export type OperationSide = DefineEnum<typeof OperationSide>;
export const OperationSide = Object.freeze({
	Debit: "DEBIT",
	Credit: "CREDIT",
});

export const baseTxSchema = z.object({
	operation_id: z.string(),
	title: z.string(), // TODO: Do we need aggregated title? I think it's better not to rely on it
	operation_type: z.enum(OperationType),
	operation_kind: z.object({
		get code() {
			return z.literal(operationSubTypes);
		},
		side: z.enum(OperationSide),
	}),
	money: z.object({ amount: zTransactionAmount, currency: z.string() }),
	is_hold: z.boolean(), // TODO: Parse only when true. When false - save as is and ignore
});

export const sharedTxSchema = z.object({
	...baseTxSchema.shape,
	details: z.object({
		exec_date: zPlainDate,
		order_date: zPlainDate,
	}),
	is_hold: z.literal(false),
});

export type CardOperationSubType = DefineEnum<typeof CardOperationSubType>;
export const CardOperationSubType = Object.freeze({
	/** I pay */
	Payment: "CARD_PAYMENT",
	/** They return money */
	Return: "CARD_PAYMENT_RETURN",
	/** I send money using card (Mono GPay, PayPal Friends&Family) */
	Transfer: "PAYCARD_TRANSFER",
});

export const cardTransaction = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.CardTransaction),
		operation_kind: z.object({
			code: z.literal([CardOperationSubType.Payment, CardOperationSubType.Return]),
			side: z.enum(OperationSide),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			address: z.string(),
			city: z.string(),
			country: z.string(),
			country_code: z.string(),

			original_amount: z.object({
				amount: zTransactionAmount,
				currency: z.string(),
			}),

			merchant_name: z.string().optional(),
			category: z.string().optional(),
			subcategories: z.string().optional(),
		}),
		// other_side is useless - it's either the merchant name, or "Karta Płatnicza" if no merchant
	})
	.apply(type(IpkoTxType.CardTransaction));

export const cardTransferSend = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.CardTransaction),
		operation_kind: z.object({
			code: z.literal(CardOperationSubType.Transfer),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			city: z.string(),
			country: z.string(),
			country_code: z.string(),

			original_amount: z.object({
				amount: zTransactionAmount,
				currency: z.string(),
			}),

			receiver_address: z.string(),
		}),
		// other_side is useless - it's just "Karta Płatnicza"
	})
	.apply(type(IpkoTxType.CardTransferSend));

export type MobileOperationSubType = DefineEnum<typeof MobileOperationSubType>;
export const MobileOperationSubType = Object.freeze({
	BlikContactlessPayment: "BLIK_CONTACTLESS_PAYMENT",
	BlikContactlessReturn: "BLIK_CONTACTLESS_PAYMENT_RETURN",
	AtmPayment: "MOBILE_PAYMENT_ATM_TX_CODE",
	PosPayment: "MOBILE_PAYMENT_POS_TX_CODE",
	PosNoCardPayment: "MOBILE_PAYMENT_POS_NO_CARD_TX_CODE",
	PosReturn: "MOBILE_PAYMENT_POS_RETURN",
});

export const mobileTransaction = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.MobileTransaction),
		operation_kind: z.object({
			code: z.literal([
				MobileOperationSubType.BlikContactlessPayment,
				MobileOperationSubType.BlikContactlessReturn,
				MobileOperationSubType.PosPayment,
				MobileOperationSubType.PosNoCardPayment,
				MobileOperationSubType.PosReturn,
			]),
			side: z.enum(OperationSide),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string().optional(),

			address: z.string(),
			city: z.string().optional(),
			country: z.string().optional(),
			country_code: z.string().optional(),

			merchant_name: z.string().optional(),
			category: z.string().optional(),
			subcategories: z.string().optional(),
		}),
		// other_side is useless - it's either the merchant name, or "Płatność mobilna" if no merchant
	})
	.apply(type(IpkoTxType.MobileTransaction));

export const mobileAtmTransaction = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.MobileTransaction),
		operation_kind: z.object({
			code: z.literal(MobileOperationSubType.AtmPayment),
			side: z.literal(OperationSide.Debit), // I think there should be CREDIT for ATM.
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string().optional(),

			address: z.string(),
			city: z.string(),
			country: z.string(),
			country_code: z.string(),
		}),
		// other_side is useless - it's just "Płatność mobilna"
	})
	.apply(type(IpkoTxType.MobileAtmTransaction));

export type TransferOperationSubType = DefineEnum<typeof TransferOperationSubType>;
export const TransferOperationSubType = Object.freeze({
	SendReceive: "TRANSFER",
	Receive: "TRANSFER_IN",
	ExpressSend: "TRANSFER_EXPRESS_ELIXIR",
	/** Looks like it's only related to repeating/scheduled transaction */
	StandingOrder: "STANDING_ORDER",
	/**
	 * For some reason, PKO Bank Polski has different type for blik transfers with the PKO clients and
	 * clients of other banks
	 */
	BlikInternal: "MOBILE_PAYMENT_C2C",
	BlikExternal: "MOBILE_PAYMENT_C2C_EXTERNAL",
	TransportTicketPurchase: "TRANSPORT_TICKET_PAYMENT",
});

export const transferSend = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.Transfer),
		operation_kind: z.object({
			code: z.literal([
				TransferOperationSubType.SendReceive,
				TransferOperationSubType.ExpressSend,
				TransferOperationSubType.StandingOrder,
				TransferOperationSubType.BlikInternal,
				TransferOperationSubType.BlikExternal,
			]),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			other_account: z.string(),
			recipient_name_and_address: z.string(), // TODO: I have no idea, how it looks when address is also present
		}),
		other_side: z.string(), // NOT useless - it's recipient_name_and_address but without address!
	})
	.apply(type(IpkoTxType.TransferSend));

export const transferReceive = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.Transfer),
		operation_kind: z.object({
			code: z.literal([
				TransferOperationSubType.SendReceive,
				TransferOperationSubType.Receive,
				TransferOperationSubType.BlikInternal,
				TransferOperationSubType.BlikExternal,
			]),
			side: z.literal(OperationSide.Credit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			other_account: z.string(),
			sender_name_and_address: z.string(),
		}),
		other_side: z.string(), // NOT useless - it's sender_name_and_address but without address!
	})
	.apply(type(IpkoTxType.TransferReceive));

export type ForeignTransferOperationSubType = DefineEnum<typeof ForeignTransferOperationSubType>;
export const ForeignTransferOperationSubType = Object.freeze({
	Send: "FOREIGN_TRANSFER",
	Receive: "FOREIGN_TRANSFER_IN",
});

export const foreignTransferSend = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.ForeignTransfer),
		operation_kind: z.object({
			code: z.literal(ForeignTransferOperationSubType.Send),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			other_account: z.string(),
			recipient_name_and_address: z.string(), // TODO: I have no idea, how it looks when address is also present

			original_amount: z.object({
				amount: zTransactionAmount,
				currency: z.string(),
			}),
			exchange_rate: z.string().optional(),
		}),
		other_side: z.string(), // NOT useless - it's recipient_name_and_address but without address!
	})
	.apply(type(IpkoTxType.ForeignTransferSend));

export const foreignTransferReceive = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.ForeignTransfer),
		operation_kind: z.object({
			code: z.literal(ForeignTransferOperationSubType.Receive),
			side: z.literal(OperationSide.Credit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			other_account: z.string(),
			sender_name_and_address: z.string(),

			original_amount: z.object({
				amount: zTransactionAmount,
				currency: z.string(),
			}),
			exchange_rate: z.string().optional(),
		}),
		other_side: z.string(), // NOT useless - it's sender_name_and_address but without address!
	})
	.apply(type(IpkoTxType.ForeignTransferReceive));

export const transitTicketPurchase = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.Transfer),
		operation_kind: z.object({
			code: z.literal(TransferOperationSubType.TransportTicketPurchase),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			recipient_name_and_address: z.string(), // TODO: I have no idea, how it looks when address is also present
		}),
		other_side: z.string(), // NOT useless - it's recipient_name_and_address but without address!
	})
	.apply(type(IpkoTxType.TransitTicketPurchase));

export const phoneTopUp = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		operation_type: z.literal(OperationType.Transfer),
		operation_kind: z.object({
			code: z.literal(TransferOperationSubType.SendReceive),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			recipient_name_and_address: z.string(),
		}),
		recharge_operator_id: z.string(), // Operator (like Heyah)
		other_side: z.string(), // NOT useless - it's recipient_name_and_address but without address!
	})
	.apply(type(IpkoTxType.PhoneTopUp));

export type OtherOperationSubType = DefineEnum<typeof OtherOperationSubType>;
export const OtherOperationSubType = Object.freeze({
	Fee: "FEE",
	CardFee: "CARD_FEE",
	Interest: "INTEREST",
});

export const fees = z
	.object({
		...sharedTxSchema.omit({ operation_kind: true, operation_type: true }).shape,

		/**
		 * "Transfer" here because of an old format for card fees, but I still have a couple of such
		 * transactions, so I have to support it. All new "fees" transactions have "type: Other".
		 */
		operation_type: z.literal([OperationType.Other, OperationType.Transfer]),
		operation_kind: z.object({
			code: z.enum(OtherOperationSubType),
			side: z.literal(OperationSide.Debit),
		}),

		details: z.object({
			...sharedTxSchema.shape.details.shape,

			title: z.string(),
			/** Present, if this is fees for express foreign transaction. See transaction with id: 188 */
			recipient_name_and_address: z.string().optional(),
		}),
		other_side: z.string().nullable(), // NOT useless - it's recipient_name_and_address but without address!
	})
	.apply(type(IpkoTxType.Fees));

export type OperationSubType = (typeof operationSubTypes)[number];
export const operationSubTypes = [
	...Object.values(CardOperationSubType),
	...Object.values(MobileOperationSubType),
	...Object.values(TransferOperationSubType),
	...Object.values(ForeignTransferOperationSubType),
	...Object.values(OtherOperationSubType),
	"HOLD_1048" as const,
];

const ipkoSchemas = [
	cardTransaction,
	cardTransferSend,
	mobileTransaction,
	mobileAtmTransaction,
	transferSend,
	transferReceive,
	foreignTransferSend,
	foreignTransferReceive,
	transitTicketPurchase,
	phoneTopUp,
	fees,
] as const;

export type IpkoTransaction = z.infer<typeof ipkoTransactionSchema>;
export const ipkoTransactionSchema = zMdu(
	{ operation_type: true, operation_kind: { code: true, side: true } },
	ipkoSchemas,
);

// `type()` describes every schema with the `$type` it assigns
const ipkoSchemaByType = new Map<string, z.ZodObject>(
	ipkoSchemas.map((schema) => [schema.description ?? "", schema]),
);

/**
 * JSON form of a parsed transaction: the fields our schemas know, with dates and amounts as the
 * text the bank sent. Fields of the bank's JSON that the schemas do not list are not part of it.
 */
export function ipkoTransactionToJson(tx: IpkoTransaction): Record<string, unknown> {
	const schema = ipkoSchemaByType.get(tx.$type);
	if (!schema) throw new Error(`No ipko schema for $type "${tx.$type}"`);

	return z.encode(schema, tx);
}

export type IpkoField = {
	/** Dot path into the JSON form of a parsed transaction, e.g. `details.title` */
	path: string;
	type: "text" | "date" | "amount" | "boolean";
	/** The bank does not always send it */
	optional: boolean;
};

function collectFields(schema: z.ZodType, path: string, optional: boolean, fields: IpkoField[]) {
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		collectFields(schema.unwrap() as z.ZodType, path, true, fields);
	} else if (schema instanceof z.ZodDefault) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		collectFields(schema.unwrap() as z.ZodType, path, optional, fields);
	} else if (schema instanceof z.ZodObject) {
		for (const [key, child] of Object.entries(schema.shape)) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			collectFields(child as z.ZodType, path ? `${path}.${key}` : key, optional, fields);
		}
	} else {
		const isBoolean =
			schema instanceof z.ZodBoolean ||
			(schema instanceof z.ZodLiteral &&
				[...schema.values].every((value) => typeof value === "boolean"));

		let fieldType: IpkoField["type"] = "text";
		if (schema === zPlainDate) fieldType = "date";
		else if (schema === zTransactionAmount) fieldType = "amount";
		else if (isBoolean) fieldType = "boolean";

		fields.push({ path, type: fieldType, optional });
	}
}

/** The fields rules can read, by transaction type, taken from the schemas above */
export const ipkoFieldsByType: Record<string, IpkoField[]> = Object.fromEntries(
	ipkoSchemas.map((schema) => {
		const fields: IpkoField[] = [];
		collectFields(schema, "", false, fields);
		return [schema.description ?? "", fields];
	}),
);
