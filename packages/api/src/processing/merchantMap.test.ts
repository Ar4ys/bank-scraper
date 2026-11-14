import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapFieldSource, type Rule } from "@bank-scraper/shared";

import { MerchantMapField, type MerchantMapEntry } from "../db/schema.ts";
import { ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { deriveTransaction } from "./derive.ts";
import { ipkoExample, rawCardTransaction, rawTransferSend } from "./fixtures.ts";
import { findMapEntry, matchText } from "./merchantMap.ts";

let nextId = 0;

/** An entry; later calls make younger entries, as ids do in the database */
const entry = (
	text: string,
	merchant: string,
	field: MerchantMapField = MerchantMapField.Address,
	overridesBankMerchant = false,
): MerchantMapEntry => ({
	id: `entry-${String(nextId++).padStart(3, "0")}`,
	field,
	text,
	matchKey: matchText(text),
	merchant,
	overridesBankMerchant,
	createdAt: Temporal.Now.instant(),
	updatedAt: Temporal.Now.instant(),
});

const parse = (rawData: unknown) => ipkoTransactionSchema.parse(rawData);

/** A card payment without a merchant name from the bank, at the given address */
const cardPaymentAt = (address: string, city = "Wroclaw") =>
	rawCardTransaction({ details: { address, city } });

describe("matchText", () => {
	it("ignores case and collapses whitespace", () => {
		assert.equal(matchText("  UBER   *Eats\t1 "), "uber *eats 1");
	});
});

describe("findMapEntry", () => {
	it("finds an entry whose text the address contains, ignoring case and whitespace", () => {
		const uber = entry("UBER *EATS", "Uber Eats");

		assert.equal(findMapEntry(parse(cardPaymentAt("Uber    *eats  1234")), [uber], false), uber);
		assert.equal(findMapEntry(parse(cardPaymentAt("UBER *TRIP")), [uber], false), undefined);
	});

	it("prefers the longest matching text", () => {
		const mart = entry("MART", "Mart");
		const supermart = entry("SUPERMART", "Supermart");

		assert.equal(
			findMapEntry(parse(cardPaymentAt("SUPERMART 24")), [mart, supermart], false),
			supermart,
		);
	});

	it("prefers the older of two matching texts of the same length", () => {
		const older = entry("ABCD", "Older");
		const younger = entry("WXYZ", "Younger");

		assert.equal(findMapEntry(parse(cardPaymentAt("WXYZ ABCD")), [older, younger], false), older);
	});

	it("looks only at the entry's field", () => {
		const hosting = entry("hosting.example", "Hosting", MerchantMapField.City);

		assert.equal(
			findMapEntry(parse(cardPaymentAt("SOME ADDRESS", "hosting.example")), [hosting], false),
			hosting,
		);
		assert.equal(
			findMapEntry(parse(cardPaymentAt("hosting.example")), [hosting], false),
			undefined,
		);
	});

	it("skips a city entry for a mobile payment that has no city", () => {
		const orange = entry("orange", "Orange", MerchantMapField.City);

		assert.equal(
			findMapEntry(parse(ipkoExample("MOBILE_TRANSACTION/default")), [orange], false),
			undefined,
		);
	});

	it("matches mobile payments like card payments", () => {
		const orange = entry("orange.flex", "Orange");

		assert.equal(
			findMapEntry(parse(ipkoExample("MOBILE_TRANSACTION/default")), [orange], false),
			orange,
		);
	});

	it("skips entries that don't override the bank's merchant when the bank names one", () => {
		const boltFood = entry("bolt.eu/o", "Bolt Food");
		const payment = parse(cardPaymentAt("BOLT.EU/O/2604081424"));

		assert.equal(findMapEntry(payment, [boltFood], true), undefined);
		assert.equal(findMapEntry(payment, [boltFood], false), boltFood);
	});

	it("applies an entry that overrides the bank's merchant either way", () => {
		const boltFood = entry("bolt.eu/o", "Bolt Food", MerchantMapField.Address, true);
		const payment = parse(cardPaymentAt("BOLT.EU/O/2604081424"));

		assert.equal(findMapEntry(payment, [boltFood], true), boltFood);
		assert.equal(findMapEntry(payment, [boltFood], false), boltFood);
	});

	it("lets only overriding entries compete when the bank names a merchant", () => {
		const longer = entry("bolt.eu/o/26", "Bolt 2026");
		const overriding = entry("bolt.eu/o", "Bolt Food", MerchantMapField.Address, true);
		const payment = parse(cardPaymentAt("BOLT.EU/O/2604081424"));

		assert.equal(findMapEntry(payment, [longer, overriding], true), overriding);
		assert.equal(findMapEntry(payment, [longer, overriding], false), longer);
	});

	it("leaves other transactions alone", () => {
		assert.equal(findMapEntry(parse(rawTransferSend()), [entry("", "Anything")], false), undefined);
	});
});

describe("deriveTransaction with a merchant map", () => {
	const lidl = entry("LIDL", "Lidl");

	function derive(rawData: unknown, rules: Rule[] = []) {
		const result = deriveTransaction(rawData, rules, [lidl]);
		assert.equal(result.status, "processed", JSON.stringify(result));
		return result;
	}

	it("names the merchant of a payment the bank names none for", () => {
		const { fields, fieldSources } = derive(rawCardTransaction());

		assert.equal(fields.merchant, "Lidl");
		assert.equal(fieldSources.merchant, mapFieldSource(lidl.id));
	});

	it("keeps a merchant name from the bank", () => {
		const { fields, fieldSources } = derive(ipkoExample("MOBILE_TRANSACTION/+merchant+location"));

		assert.equal(fields.merchant, "Lidl");
		assert.equal(fieldSources.merchant, "default");
	});

	it("replaces a merchant name from the bank with an entry that overrides it", () => {
		const boltFood = entry("bolt.eu/o", "Bolt Food", MerchantMapField.Address, true);
		const result = deriveTransaction(
			rawCardTransaction({ details: { address: "BOLT.EU/O/2604081424", merchant_name: "Bolt" } }),
			[],
			[boltFood],
		);
		assert.equal(result.status, "processed", JSON.stringify(result));

		assert.equal(result.fields.merchant, "Bolt Food");
		assert.equal(result.fieldSources.merchant, mapFieldSource(boltFood.id));
	});

	it("lets a rule override the map", () => {
		const rule: Rule = {
			id: "rule",
			name: "Lidl rule",
			priority: 0,
			enabled: true,
			txTypes: null,
			conditions: [],
			set: { merchant: "Lidl from a rule" },
		};
		const { fields, fieldSources } = derive(rawCardTransaction(), [rule]);

		assert.equal(fields.merchant, "Lidl from a rule");
		assert.equal(fieldSources.merchant, "rule");
	});
});
