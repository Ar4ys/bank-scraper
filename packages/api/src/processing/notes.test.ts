import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { isTransfer } from "./counterparty.ts";
import { ipkoExample, rawTransferSend } from "./fixtures.ts";
import { addressAfterName, formatAccount, transferNotes } from "./notes.ts";

const notesOf = (raw: unknown) => {
	const tx = ipkoTransactionSchema.parse(raw);
	assert.ok(isTransfer(tx));
	return transferNotes(tx);
};

describe("formatAccount", () => {
	it("groups a Polish number as 2 + 6×4 digits", () => {
		assert.equal(formatAccount("12345678901234567890123456"), "12 3456 7890 1234 5678 9012 3456");
		assert.equal(
			formatAccount("12 3456 7890 1234 5678 9012 3456"),
			"12 3456 7890 1234 5678 9012 3456",
		);
	});

	it("groups an IBAN by 4", () => {
		assert.equal(formatAccount("DE12345678901234567890"), "DE12 3456 7890 1234 5678 90");
	});

	it("leaves anything else as the bank gives it", () => {
		assert.equal(formatAccount(" 1234 "), "1234");
	});
});

describe("addressAfterName", () => {
	it("is what follows the name, without spaces and commas around it", () => {
		assert.equal(addressAfterName("JAN KOWALSKI, UL. DLUGA 7 ", "JAN KOWALSKI"), "UL. DLUGA 7");
	});

	it("ignores case and runs of spaces in the name", () => {
		assert.equal(addressAfterName("Jan  Kowalski UL. DLUGA 7", "JAN KOWALSKI"), "UL. DLUGA 7");
	});

	it("is empty when the field is only the name", () => {
		assert.equal(addressAfterName("JAN KOWALSKI", "JAN KOWALSKI"), "");
	});

	it("is the whole field when it doesn't start with the name", () => {
		assert.equal(
			addressAfterName("UL. DLUGA 7 JAN KOWALSKI", "JAN KOWALSKI"),
			"UL. DLUGA 7 JAN KOWALSKI",
		);
	});
});

describe("transferNotes", () => {
	it("describes a sent transfer", () => {
		assert.equal(
			notesOf(
				rawTransferSend({
					details: { recipient_name_and_address: "JAN KOWALSKI UL. DLUGA 7 00-001 WARSZAWA" },
					other_side: "JAN KOWALSKI",
				}),
			),
			[
				"To: JAN KOWALSKI",
				"Address: UL. DLUGA 7 00-001 WARSZAWA",
				"Account: 12 3456 7890 1234 5678 9012 3456",
				"Title: CUSTOM TRANSFER NAME",
			].join("\n"),
		);
	});

	it("says From for a received transfer", () => {
		assert.match(
			notesOf(ipkoExample("TRANSFER_NORMAL/blik_transfer_receive")) ?? "",
			/^From: SOMEONE WHO SENT MONEY\n/,
		);
	});

	it("leaves out lines without a value", () => {
		assert.equal(
			notesOf(rawTransferSend({ details: { title: " ", other_account: "" } })),
			"To: SOMEONE WHO RECEIVED MONEY",
		);
	});

	it("names only the receiver of a card transfer", () => {
		assert.equal(notesOf(ipkoExample("CARD_TRANSACTION/card_transfer")), "To: PAYPAL *USER_NAME");
	});
});
