import { IpkoTxType, type IpkoTransaction } from "../ipkoSchemas.ts";

/** Transfers of every kind: the transactions that have a counterparty */
export type TransferTransaction = Extract<
	IpkoTransaction,
	{
		$type:
			| typeof IpkoTxType.TransferSend
			| typeof IpkoTxType.TransferReceive
			| typeof IpkoTxType.ForeignTransferSend
			| typeof IpkoTxType.ForeignTransferReceive
			| typeof IpkoTxType.CardTransferSend;
	}
>;

export function isTransfer(tx: IpkoTransaction): tx is TransferTransaction {
	switch (tx.$type) {
		case IpkoTxType.TransferSend:
		case IpkoTxType.TransferReceive:
		case IpkoTxType.ForeignTransferSend:
		case IpkoTxType.ForeignTransferReceive:
		case IpkoTxType.CardTransferSend:
			return true;

		default:
			return false;
	}
}

/**
 * The name of the other side of a transfer, as the bank gives it: the recipient or the sender, and
 * for a card transfer (e.g. PayPal) its receiver, prefix included. `undefined` for other
 * transactions and when the bank gives no name.
 */
export function counterpartyOf(tx: IpkoTransaction): string | undefined {
	if (!isTransfer(tx)) return undefined;

	const name =
		tx.$type === IpkoTxType.CardTransferSend ? tx.details.receiver_address : tx.other_side;
	return name.trim() || undefined;
}
