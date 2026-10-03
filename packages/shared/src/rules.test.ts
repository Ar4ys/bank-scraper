import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchRule, type RuleCondition } from "./rules.ts";

const bankTransaction = {
	$type: "cardTransaction",
	title: "Card payment",
	details: { title: "BOLT.EU/P/20261003" },
};

const match = (conditions: RuleCondition[], txTypes: string[] | null = null) =>
	matchRule({ txTypes, conditions }, bankTransaction);

describe("matchRule", () => {
	it("matches everything when there are no conditions", () => {
		assert.deepEqual(match([]), []);
	});

	it("matches contains and equals ignoring case", () => {
		assert.ok(match([{ path: "details.title", operator: "contains", pattern: "bolt.eu" }]));
		assert.ok(match([{ path: "title", operator: "equals", pattern: "card PAYMENT" }]));
		assert.equal(match([{ path: "title", operator: "equals", pattern: "card" }]), undefined);
	});

	it("returns the capture groups of the first regex condition", () => {
		assert.deepEqual(
			match([
				{ path: "details.title", operator: "regex", pattern: "^BOLT\\.EU/P/(\\d+)$" },
				{ path: "title", operator: "regex", pattern: "^(Card)" },
			]),
			["BOLT.EU/P/20261003", "20261003"],
		);
	});

	it("uses a regex as written, case included", () => {
		assert.equal(
			match([{ path: "details.title", operator: "regex", pattern: "^bolt" }]),
			undefined,
		);
	});

	it("requires every condition to match", () => {
		assert.equal(
			match([
				{ path: "details.title", operator: "contains", pattern: "bolt" },
				{ path: "title", operator: "contains", pattern: "transfer" },
			]),
			undefined,
		);
	});

	it("does not match when the path points at nothing", () => {
		assert.equal(
			match([{ path: "details.merchant_name", operator: "contains", pattern: "" }]),
			undefined,
		);
	});

	it("is limited to the given transaction types", () => {
		assert.ok(match([], ["cardTransaction", "fees"]));
		assert.equal(match([], ["fees"]), undefined);
	});
});
