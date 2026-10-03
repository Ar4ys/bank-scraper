import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Rule } from "@bank-scraper/shared";

import { deriveTransaction } from "./derive.ts";
import {
	rawCardTransaction,
	rawForeignTransferReceive,
	rawHold,
	rawTransferSend,
} from "./fixtures.ts";

const rule = (overrides: Partial<Rule>): Rule => ({
	id: "rule",
	name: "rule",
	priority: 0,
	enabled: true,
	txTypes: null,
	conditions: [],
	set: {},
	...overrides,
});

function derive(rawData: unknown, rules: Rule[] = []) {
	const result = deriveTransaction(rawData, rules);
	assert.equal(result.status, "processed", JSON.stringify(result));
	return result;
}

describe("deriveTransaction defaults", () => {
	it("derives a card payment without a merchant", () => {
		assert.deepEqual(derive(rawCardTransaction()).fields, {
			date: "2025-06-06",
			amount: "-12.34",
			currency: "PLN",
			merchant: null,
			description: "BOLT.EU/P/20261003, Tallinn, Estonia",
			isPending: false,
		});
	});

	it("uses the bank's merchant name and notes a foreign original amount", () => {
		const { fields } = derive(
			rawCardTransaction({
				details: { merchant_name: "Bolt", original_amount: { amount: "-2.90", currency: "EUR" } },
			}),
		);

		assert.equal(fields.merchant, "Bolt");
		assert.equal(fields.description, "BOLT.EU/P/20261003, Tallinn, Estonia (orig -2.90 EUR)");
	});

	it("derives a transfer from the other side and its title", () => {
		const { fields } = derive(rawTransferSend());

		assert.equal(fields.merchant, "Jan Kowalski");
		assert.equal(fields.description, "Rent August");
		assert.equal(fields.amount, "-1500.00");
	});

	it("notes the original amount and rate of a foreign transfer", () => {
		const { fields } = derive(rawForeignTransferReceive());

		assert.equal(fields.merchant, "ACME GmbH");
		assert.equal(fields.description, "Invoice 7 (orig 100.00 EUR, rate 4.3000)");
	});

	it("marks every field as coming from the defaults", () => {
		assert.deepEqual(
			new Set(Object.values(derive(rawCardTransaction()).fieldSources)),
			new Set(["default"]),
		);
	});
});

describe("deriveTransaction holds and errors", () => {
	it("reports a hold without deriving anything", () => {
		assert.deepEqual(deriveTransaction(rawHold(), []), { status: "hold" });
	});

	it("reports data the schemas do not know as a schema error", () => {
		const result = deriveTransaction(rawCardTransaction({ operation_type: "SOMETHING_NEW" }), []);

		assert.equal(result.status, "error");
		assert.equal(result.status === "error" && result.error.stage, "schema");
	});
});

describe("deriveTransaction rules", () => {
	const boltRule = rule({
		id: "bolt",
		conditions: [{ path: "details.title", operator: "regex", pattern: "^BOLT\\.EU/P/(\\d+)" }],
		set: { merchant: "Bolt", description: "Bolt ride {match.1} in {details.city}" },
	});

	it("overrides the fields a matching rule sets and records which rule did", () => {
		const { fields, fieldSources } = derive(rawCardTransaction(), [boltRule]);

		assert.equal(fields.merchant, "Bolt");
		assert.equal(fields.description, "Bolt ride 20261003 in Tallinn");
		assert.equal(fields.amount, "-12.34");
		assert.deepEqual(
			[fieldSources.merchant, fieldSources.description, fieldSources.amount],
			["bolt", "bolt", "default"],
		);
	});

	it("leaves transactions the rule does not match alone", () => {
		assert.equal(derive(rawTransferSend(), [boltRule]).fields.merchant, "Jan Kowalski");
	});

	it("takes each field from the first rule by priority that sets it", () => {
		const { fields, fieldSources } = derive(rawCardTransaction(), [
			rule({ id: "late", priority: 2, set: { merchant: "Late", description: "Late" } }),
			rule({ id: "early", priority: 1, set: { merchant: "Early" } }),
		]);

		assert.deepEqual([fields.merchant, fields.description], ["Early", "Late"]);
		assert.deepEqual([fieldSources.merchant, fieldSources.description], ["early", "late"]);
	});

	it("ignores disabled rules and rules for other transaction types", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({ enabled: false, set: { merchant: "Disabled" } }),
			rule({ txTypes: ["fees"], set: { merchant: "Fees only" } }),
		]);

		assert.equal(fields.merchant, null);
	});

	it("can take the date from another field of the bank transaction", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({ set: { date: "{details.exec_date}" } }),
		]);

		assert.equal(fields.date, "2025-06-08");
	});

	it("shows rules the parsed transaction: known fields, its type, dates and amounts as text", () => {
		const { fields } = derive(rawCardTransaction({ field_the_schema_does_not_know: "raw only" }), [
			rule({
				set: {
					description:
						"{$type}|{money.amount}|{details.order_date}|{is_hold}|{field_the_schema_does_not_know}|",
				},
			}),
		]);

		assert.equal(fields.description, "cardTransaction|-12.34|2025-06-06|false||");
	});

	it("renders a placeholder for an absent field as empty text", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({
				set: { merchant: "{details.merchant_name}", description: "At {details.merchant_name}" },
			}),
		]);

		assert.deepEqual([fields.merchant, fields.description], [null, "At"]);
	});

	it("reports a value the field cannot hold as a rules error", () => {
		const result = deriveTransaction(rawCardTransaction(), [
			rule({ set: { date: "{details.title}" } }),
		]);

		assert.equal(result.status, "error");
		assert.equal(result.status === "error" && result.error.stage, "rules");
	});
});
