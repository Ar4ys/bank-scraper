import { IpkoTxType, OperationSide } from "../ipkoSchemas.ts";
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

/** `Label: value` lines describing a transfer, without those whose value is empty */
export function transferNotes(tx: TransferTransaction): string | undefined {
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
					["Title", tx.details.title],
				];

	const text = lines
		.flatMap(([label, value]) => (value?.trim() ? [`${label}: ${value.trim()}`] : []))
		.join("\n");
	return text || undefined;
}
