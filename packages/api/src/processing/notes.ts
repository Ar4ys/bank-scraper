import {
	IpkoTxType,
	OperationSide,
	TransferOperationSubType,
	type IpkoTransaction,
} from "../ipkoSchemas.ts";
import { type TransferTransaction } from "./counterparty.ts";
import { matchText } from "./merchantMap.ts";

/**
 * A Polish account number as 2 + 6×4 digits, an IBAN in groups of 4, anything else as the bank
 * gives it
 */
export function formatAccount(account: string) {
	const compact = account.replace(/\s+/g, "");

	if (/^\d{26}$/.test(compact)) {
		return [compact.slice(0, 2), ...(compact.slice(2).match(/.{4}/g) ?? [])].join(" ");
	}
	if (/^[A-Z]{2}\d{2}[A-Z0-9]+$/i.test(compact)) {
		return compact.match(/.{1,4}/g)?.join(" ") ?? compact;
	}
	return account.trim();
}

/**
 * What `nameAndAddress` holds after `name`. The bank doesn't send the address on its own, only
 * after the name in one field. A field that doesn't start with the name is returned whole, so that
 * nothing it holds is lost.
 */
export function addressAfterName(nameAndAddress: string, name: string) {
	const field = nameAndAddress.trim();
	const rest = matchText(field).startsWith(matchText(name))
		? field.replace(/\s+/g, " ").slice(matchText(name).length)
		: field;

	return rest.replace(/^[\s,]+|[\s,]+$/g, "");
}

const blikCodes: ReadonlySet<string> = new Set([
	TransferOperationSubType.BlikInternal,
	TransferOperationSubType.BlikExternal,
]);

/**
 * The title of a BLIK transfer without the phone numbers the bank appends to it (`PIZZA OD:
 * 48123456789 DO: 489*****321`), and the other side's number: DO for a sent transfer, OD for a
 * received one, masked or not. `undefined` for other transactions, for a title without the numbers
 * (as from other banks' clients) and for one that is nothing but them.
 */
export function blikTitle(tx: IpkoTransaction): { title: string; phone: string } | undefined {
	if (tx.$type !== IpkoTxType.TransferSend && tx.$type !== IpkoTxType.TransferReceive) {
		return undefined;
	}
	if (!blikCodes.has(tx.operation_kind.code)) return undefined;

	const match = /^(.*?)\s*OD:\s*(\S+)\s+DO:\s*(\S+)\s*$/s.exec(tx.details.title);
	const [, title = "", from = "", to = ""] = match ?? [];
	if (!match || !title.trim()) return undefined;

	return {
		title: title.trim(),
		phone: tx.operation_kind.side === OperationSide.Debit ? to : from,
	};
}

/** `Label: value` lines describing a transfer, without those whose value is empty */
export function transferNotes(tx: TransferTransaction): string | undefined {
	const blik = blikTitle(tx);
	const lines: Array<[string, string | undefined]> =
		tx.$type === IpkoTxType.CardTransferSend
			? [["To", tx.details.receiver_address]]
			: [
					[tx.operation_kind.side === OperationSide.Debit ? "To" : "From", tx.other_side],
					[
						"Address",
						addressAfterName(
							"recipient_name_and_address" in tx.details
								? tx.details.recipient_name_and_address
								: tx.details.sender_name_and_address,
							tx.other_side,
						),
					],
					["Account", formatAccount(tx.details.other_account)],
					["Phone", blik?.phone],
				];

	const text = lines
		.flatMap(([label, value]) => (value?.trim() ? [`${label}: ${value.trim()}`] : []))
		.join("\n");
	return text || undefined;
}
