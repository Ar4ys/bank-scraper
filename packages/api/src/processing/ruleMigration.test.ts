import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { type Rule } from "@bank-scraper/shared";

import { createTestDb } from "../db/testDb.ts";

const { cleanup } = await createTestDb();
const { parseLiteralAlternatives, planRuleMigration } = await import("./ruleMigration.ts");
const { matchText } = await import("./merchantMap.ts");
after(cleanup);

const rule = (overrides: Partial<Rule> & Pick<Rule, "id">): Rule => ({
	name: overrides.id,
	priority: 0,
	enabled: true,
	txTypes: ["cardTransaction", "mobileTransaction"],
	conditions: [{ path: "details.address", operator: "contains", pattern: "ACME" }],
	set: { merchant: "Acme" },
	...overrides,
});

const plan = (rules: Rule[], directory = new Map(), existing = []) =>
	planRuleMigration(rules, directory, existing);

const entries = (rules: Rule[]) =>
	plan(rules).entries.map((entry) => [entry.field, entry.text, entry.merchant]);

describe("parseLiteralAlternatives", () => {
	it("reads the texts of literal alternatives in groups", () => {
		assert.deepEqual(
			parseLiteralAlternatives(String.raw`((?:CORNER CAFE)|(?:ACME SP\. Z O\. 03)|(?:F0S3))`),
			["CORNER CAFE", "ACME SP. Z O. 03", "F0S3"],
		);
		assert.deepEqual(parseLiteralAlternatives("(shop.example)|(acme warszawa)"), [
			"shop.example",
			"acme warszawa",
		]);
		assert.deepEqual(parseLiteralAlternatives("ACME"), ["ACME"]);
	});

	it("rejects anything that is more than literal text", () => {
		for (const pattern of [
			String.raw`UBER\D+\*EATS`,
			String.raw`(UBER\D+\*(TRIP|ONE))|(UBER B\.V\.)`,
			"ACME.*",
			"^ACME",
			"[AB]CME",
			"ACME(?=X)",
			"(ACME)|()",
		]) {
			assert.equal(parseLiteralAlternatives(pattern), undefined, pattern);
		}
	});

	it("rejects text joined to a group of alternatives", () => {
		assert.equal(parseLiteralAlternatives(String.raw`(UBER \*(TRIP|ONE))|(UBR\*)`), undefined);
	});
});

describe("planRuleMigration", () => {
	it("converts contains, equals and city rules", () => {
		assert.deepEqual(
			entries([
				rule({ id: "contains" }),
				rule({
					id: "equals",
					conditions: [{ path: "details.address", operator: "equals", pattern: " CORNER CAFE " }],
					set: { merchant: "Corner Cafe" },
				}),
				rule({
					id: "city",
					txTypes: ["cardTransaction"],
					conditions: [{ path: "details.city", operator: "contains", pattern: "hosting.example" }],
					set: { merchant: "Hosting" },
				}),
			]),
			[
				["address", "ACME", "Acme"],
				["address", "CORNER CAFE", "Corner Cafe"],
				["city", "hosting.example", "Hosting"],
			],
		);
	});

	it("converts a regex of literal texts into one entry per text", () => {
		assert.deepEqual(
			entries([
				rule({
					id: "fixed",
					conditions: [
						{ path: "details.address", operator: "regex", pattern: "(ACME)|(acme.example)" },
					],
				}),
				rule({
					id: "match",
					conditions: [
						{ path: "details.address", operator: "regex", pattern: "((?:CORNER CAFE)|(?:MART))" },
					],
					set: { merchant: "{match.1}" },
				}),
			]),
			[
				["address", "ACME", "Acme"],
				["address", "acme.example", "Acme"],
				["address", "CORNER CAFE", "CORNER CAFE"],
				["address", "MART", "MART"],
			],
		);
	});

	it("keeps rules that are more than a text and a merchant, saying why", () => {
		const result = plan([
			rule({ id: "disabled", enabled: false }),
			rule({ id: "all types", txTypes: null }),
			rule({ id: "top-up", txTypes: ["phoneTopUp"], conditions: [] }),
			rule({
				id: "two conditions",
				conditions: [
					{ path: "details.address", operator: "contains", pattern: "A" },
					{ path: "details.city", operator: "contains", pattern: "B" },
				],
			}),
			rule({
				id: "title",
				conditions: [{ path: "details.title", operator: "contains", pattern: "A" }],
			}),
			rule({ id: "sets nothing", set: {} }),
			rule({ id: "sets more", set: { merchant: "Acme", description: "x" } }),
			rule({ id: "template", set: { merchant: "{details.address}" } }),
			rule({
				id: "wildcard",
				conditions: [
					{ path: "details.address", operator: "regex", pattern: String.raw`UBER\D+\*EATS` },
				],
			}),
			rule({
				id: "match of a part",
				conditions: [{ path: "details.address", operator: "regex", pattern: "(A)|(B)" }],
				set: { merchant: "{match.1}" },
			}),
		]);

		assert.deepEqual(result.entries, []);
		assert.deepEqual(result.convertedRuleIds, []);
		assert.deepEqual(
			result.keptRules.map((kept) => [kept.id, kept.reason]),
			[
				["disabled", "disabled"],
				["all types", "not limited to card and mobile payments"],
				["top-up", "not limited to card and mobile payments"],
				["two conditions", "not exactly one condition"],
				["title", "a condition on details.title"],
				["sets nothing", "does not set the merchant only"],
				["sets more", "does not set the merchant only"],
				["template", "the merchant uses placeholders"],
				["wildcard", "the regex is more than a list of texts"],
				["match of a part", "{match.1} is not the whole match"],
			],
		);
	});

	it("makes one entry of texts that match alike and name the same merchant", () => {
		const directory = new Map([
			["acme", { id: "m1", name: "Acme", deletedAt: null }],
			["acme polska", { id: "m1", name: "Acme", deletedAt: null }],
		]);
		const result = plan(
			[
				rule({ id: "a" }),
				rule({
					id: "b",
					conditions: [{ path: "details.address", operator: "contains", pattern: "acme" }],
					set: { merchant: "Acme Polska" },
				}),
			],
			directory,
		);

		assert.deepEqual(
			result.entries.map((entry) => [entry.text, entry.merchant, entry.fromRuleIds]),
			[["ACME", "Acme", ["a", "b"]]],
		);
		assert.deepEqual(result.conflicts, []);
	});

	it("reports texts that match alike but name different merchants", () => {
		const result = plan([
			rule({
				id: "spaces",
				conditions: [
					{ path: "details.address", operator: "regex", pattern: "((?:JOHN  DOE)|(?:JOHN DOE))" },
				],
				set: { merchant: "{match.1}" },
			}),
		]);

		assert.deepEqual(result.entries, []);
		assert.deepEqual(
			result.conflicts.map((conflict) => [conflict.text, conflict.merchants]),
			[["JOHN  DOE", ["JOHN  DOE", "JOHN DOE"]]],
		);
	});

	it("does not add an entry the map already has, and reports one with another merchant", () => {
		const existing = (text: string, merchant: string) => ({
			id: text,
			field: "address" as const,
			text,
			matchKey: matchText(text),
			merchant,
			createdAt: Temporal.Now.instant(),
			updatedAt: Temporal.Now.instant(),
		});

		const same = planRuleMigration([rule({ id: "a" })], new Map(), [existing("acme", "Acme")]);
		assert.deepEqual([same.entries, same.conflicts, same.convertedRuleIds], [[], [], ["a"]]);

		const other = planRuleMigration([rule({ id: "a" })], new Map(), [existing("acme", "Other")]);
		assert.equal(other.conflicts.length, 1);
	});
});
