import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	ipkoFieldsByType,
	ipkoTransactionSchema,
	ipkoTransactionToJson,
	IpkoTxType,
} from "./ipkoSchemas.ts";
import { rawCardTransaction, rawForeignTransferReceive } from "./processing/fixtures.ts";

describe("ipkoTransactionToJson", () => {
	it("returns the fields the schema knows, as the bank sent them, plus the type", () => {
		const raw = rawForeignTransferReceive();
		const json = ipkoTransactionToJson(ipkoTransactionSchema.parse({ ...raw, unknown_field: 1 }));

		assert.deepEqual(json, { ...raw, $type: "foreignTransferReceive" });
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
