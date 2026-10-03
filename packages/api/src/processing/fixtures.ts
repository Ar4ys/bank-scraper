/** Hand-built bank transactions that satisfy the iPKO schemas, as the raw JSON the bank sends */

type JsonValue = string | number | boolean | null | JsonValue[] | Json;
type Json = { [key: string]: JsonValue };

const isObject = (value: JsonValue | undefined): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const merge = (base: Json, overrides: Json): Json => {
	const result = { ...base };

	for (const [key, value] of Object.entries(overrides)) {
		const current = result[key];
		result[key] = isObject(value) && isObject(current) ? merge(current, value) : value;
	}

	return result;
};

export const rawCardTransaction = (overrides: Json = {}) =>
	merge(
		{
			operation_id: "card-1",
			title: "Card payment",
			operation_type: "CARD_TRANSACTION",
			operation_kind: { code: "CARD_PAYMENT", side: "DEBIT" },
			money: { amount: "-12.34", currency: "PLN" },
			is_hold: false,
			details: {
				exec_date: "2026-08-19",
				order_date: "2026-08-17",
				title: "BOLT.EU/P/20261003",
				address: "",
				city: "Tallinn",
				country: "Estonia",
				country_code: "EE",
				original_amount: { amount: "-12.34", currency: "PLN" },
			},
		},
		overrides,
	);

export const rawTransferSend = (overrides: Json = {}) =>
	merge(
		{
			operation_id: "transfer-1",
			title: "Transfer",
			operation_type: "TRANSFER_NORMAL",
			operation_kind: { code: "STANDING_ORDER", side: "DEBIT" },
			money: { amount: "-1500.00", currency: "PLN" },
			is_hold: false,
			details: {
				exec_date: "2026-08-01",
				order_date: "2026-08-01",
				title: "Rent August",
				other_account: "11 2222 3333 4444 5555 6666 7777",
				recipient_name_and_address: "Jan Kowalski ul. Prosta 1 Warszawa",
			},
			other_side: "Jan Kowalski",
		},
		overrides,
	);

export const rawForeignTransferReceive = (overrides: Json = {}) =>
	merge(
		{
			operation_id: "foreign-1",
			title: "Foreign transfer",
			operation_type: "REALIZED_DPW",
			operation_kind: { code: "FOREIGN_TRANSFER_IN", side: "CREDIT" },
			money: { amount: "430.00", currency: "PLN" },
			is_hold: false,
			details: {
				exec_date: "2026-08-05",
				order_date: "2026-08-04",
				title: "Invoice 7",
				other_account: "DE00 1111 2222",
				sender_name_and_address: "ACME GmbH Berlin",
				original_amount: { amount: "100.00", currency: "EUR" },
				exchange_rate: "4.3000",
			},
			other_side: "ACME GmbH",
		},
		overrides,
	);

export const rawHold = (overrides: Json = {}) =>
	merge(
		{
			operation_id: "hold-1",
			title: "Hold",
			operation_type: "CARD_TRANSACTION",
			operation_kind: { code: "HOLD_1048", side: "DEBIT" },
			money: { amount: "-5.00", currency: "PLN" },
			is_hold: true,
		},
		overrides,
	);
