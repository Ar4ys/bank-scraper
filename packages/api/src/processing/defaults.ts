import {
	zTransactionAmount,
	type TransactionAmount,
	type TransactionFields,
} from "@bank-scraper/shared";
import { z } from "zod";

import { IpkoTxType, type IpkoTransaction } from "../ipkoSchemas.ts";
import { assertNever } from "../utils.ts";

type Money = { amount: TransactionAmount; currency: string };

const joinParts = (parts: Array<string | undefined>) =>
	parts.filter((part) => part !== undefined && part.trim() !== "").join(", ");

const formatMoney = (money: Money) =>
	`${z.encode(zTransactionAmount, money.amount)} ${money.currency}`;

/** ` (orig 12.00 EUR)`, or nothing when the transaction was made in the account's currency */
const originalAmountSuffix = (tx: { money: Money }, original: Money, rate?: string) => {
	if (original.currency === tx.money.currency) return "";

	return ` (orig ${formatMoney(original)}${rate ? `, rate ${rate}` : ""})`;
};

function deriveMerchantAndDescription(tx: IpkoTransaction): {
	merchant: string | undefined;
	description: string;
} {
	switch (tx.$type) {
		case IpkoTxType.CardTransaction:
			return {
				merchant: tx.details.merchant_name,
				description:
					joinParts([tx.details.title, tx.details.city, tx.details.country]) +
					originalAmountSuffix(tx, tx.details.original_amount),
			};

		case IpkoTxType.CardTransferSend:
			return {
				merchant: undefined,
				description:
					joinParts([tx.details.title, tx.details.receiver_address]) +
					originalAmountSuffix(tx, tx.details.original_amount),
			};

		case IpkoTxType.MobileTransaction:
			return {
				merchant: tx.details.merchant_name,
				description: joinParts([tx.details.title, tx.details.address, tx.details.city]),
			};

		case IpkoTxType.MobileAtmTransaction:
			return {
				merchant: undefined,
				description: joinParts(["ATM", tx.details.address, tx.details.city, tx.details.country]),
			};

		case IpkoTxType.TransferSend:
		case IpkoTxType.TransferReceive:
		case IpkoTxType.TransitTicketPurchase:
		case IpkoTxType.PhoneTopUp:
			return { merchant: tx.other_side, description: tx.details.title };

		case IpkoTxType.ForeignTransferSend:
		case IpkoTxType.ForeignTransferReceive:
			return {
				merchant: tx.other_side,
				description:
					tx.details.title +
					originalAmountSuffix(tx, tx.details.original_amount, tx.details.exchange_rate),
			};

		case IpkoTxType.Fees:
			return { merchant: tx.other_side ?? undefined, description: tx.details.title };

		default:
			assertNever(tx, "Unhandled $type of ipko transaction");
	}
}

/** The fields of a transaction as the code derives them, before any rule is applied */
export function deriveDefaults(tx: IpkoTransaction): TransactionFields {
	const { merchant, description } = deriveMerchantAndDescription(tx);

	return {
		date: tx.details.order_date,
		amount: tx.money.amount,
		currency: tx.money.currency,
		merchant: merchant?.trim() || null,
		description,
		isPending: false,
	};
}
