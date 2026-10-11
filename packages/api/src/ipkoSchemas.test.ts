import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	ipkoFieldsByType,
	ipkoTransactionSchema,
	ipkoTransactionToJson,
	IpkoTxType,
} from "./ipkoSchemas.ts";
import {
	ipkoExamples,
	rawCardTransaction,
	rawForeignTransferReceive,
} from "./processing/fixtures.ts";

describe("ipkoTransactionToJson", () => {
	it("returns the fields the schema knows, as the bank sent them, plus the type", () => {
		const raw = rawForeignTransferReceive();
		const json = ipkoTransactionToJson(ipkoTransactionSchema.parse(raw));

		// The bank also sends e.g. `details.references`, which our schema does not list
		const unknownToSchema = [
			"charges_side",
			"customer_references",
			"references",
			"operation_kind",
			"money",
		];
		const details = Object.fromEntries(
			Object.entries(raw.details ?? {}).filter(([key]) => !unknownToSchema.includes(key)),
		);
		assert.equal(
			Object.keys(raw.details ?? {}).length,
			Object.keys(details).length + unknownToSchema.length,
		);

		assert.deepEqual(json, { ...raw, details, $type: "foreignTransferReceive" });
	});

	it("leaves out optional fields the bank did not send", () => {
		const json = ipkoTransactionToJson(ipkoTransactionSchema.parse(rawCardTransaction()));

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		assert.equal("merchant_name" in (json.details as object), false);
	});
});

describe("ipkoFieldsByType", () => {
	it("lists the fields of every transaction type", () => {
		assert.deepEqual(
			Object.keys(ipkoFieldsByType).toSorted(),
			Object.values(IpkoTxType).toSorted(),
		);
	});

	it("describes fields by path, type and whether they are optional", () => {
		const fields = Object.fromEntries(
			(ipkoFieldsByType.cardTransaction ?? []).map((field) => [field.path, field]),
		);

		assert.deepEqual(fields["details.title"], {
			path: "details.title",
			type: "text",
			optional: false,
		});
		assert.deepEqual(fields["details.merchant_name"]?.optional, true);
		assert.deepEqual(fields["details.order_date"]?.type, "date");
		assert.deepEqual(fields["details.original_amount.amount"]?.type, "amount");
		assert.deepEqual(fields["is_hold"]?.type, "boolean");
		assert.deepEqual(fields["$type"], { path: "$type", type: "text", optional: false });
	});
});

describe("ipkoTransactionSchema", () => {
	const types: Record<string, string> = {
		"CARD_TRANSACTION/+merchant-subcategory": "cardTransaction",
		"CARD_TRANSACTION/+merchant": "cardTransaction",
		"CARD_TRANSACTION/card_transfer": "cardTransferSend",
		"CARD_TRANSACTION/default": "cardTransaction",
		"MOBILE_TRANSACTION/+location": "mobileTransaction",
		"MOBILE_TRANSACTION/+merchant+location": "mobileTransaction",
		"MOBILE_TRANSACTION/+merchant-subcategories": "mobileTransaction",
		"MOBILE_TRANSACTION/+merchant": "mobileTransaction",
		"MOBILE_TRANSACTION/+title+tx_id+location": "mobileTransaction",
		"MOBILE_TRANSACTION/atm-title": "mobileAtmTransaction",
		"MOBILE_TRANSACTION/atm": "mobileAtmTransaction",
		"MOBILE_TRANSACTION/blik_contactless_foreign": "mobileTransaction",
		"MOBILE_TRANSACTION/default": "mobileTransaction",
		"OTHER/-recepient_name_and_address": "fees",
		"OTHER/default": "phoneTopUp",
		"OTHER/ipko_transit_ticket": "transitTicketPurchase",
		"REALIZED_DPW/foreign_transfer_in": "foreignTransferReceive",
		"REALIZED_DPW/foreign_transfer_out_eur": "foreignTransferSend",
		"REALIZED_DPW/foreign_transfer_out_pln": "foreignTransferSend",
		"TRANSFER_NORMAL/blik_transfer": "transferSend",
		"TRANSFER_NORMAL/blik_transfer_receive": "transferReceive",
		"TRANSFER_NORMAL/iban_transfer": "transferSend",
		"TRANSFER_NORMAL/iban_transfer_receive+lil_different": "transferReceive",
		"TRANSFER_NORMAL/iban_transfer_receive": "transferReceive",
		"TRANSFER_NORMAL/iban_transfer_repeat+recepient_id": "transferSend",
		"TRANSFER_NORMAL/iban_transfer_repeat": "transferSend",
	};

	it("parses every example as the type it is", () => {
		const parsed = Object.fromEntries(
			Object.entries(ipkoExamples)
				.filter(([name]) => !name.startsWith("HOLD/"))
				.map(([name, raw]) => [name, ipkoTransactionSchema.parse(raw).$type]),
		);

		assert.deepEqual(parsed, types);
	});

	it("rejects a hold, which only the base schema accepts", () => {
		assert.equal(ipkoTransactionSchema.safeParse(ipkoExamples["HOLD/card_payment"]).success, false);
	});
});
