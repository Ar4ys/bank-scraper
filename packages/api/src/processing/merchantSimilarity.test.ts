import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	findSuggestions,
	MAX_SUGGESTIONS,
	normalizeMerchantName,
	similarity,
	trigrams,
} from "./merchantSimilarity.ts";

const score = (a: string, b: string) =>
	similarity(trigrams(normalizeMerchantName(a)), trigrams(normalizeMerchantName(b)));

describe("normalizeMerchantName", () => {
	it("drops case, diacritics and punctuation, also the stroke of ł", () => {
		assert.equal(normalizeMerchantName("Żabka-Łódź!"), "zabka lodz");
	});

	it("drops words with digits", () => {
		assert.equal(normalizeMerchantName("ZABKA Z1234 K.1"), "zabka k");
		assert.equal(normalizeMerchantName("CCC 07"), "ccc");
	});

	it("drops legal forms", () => {
		assert.equal(normalizeMerchantName("Mart Polska Sp. z o.o."), "mart polska");
		assert.equal(normalizeMerchantName("MART SPÓŁKA AKCYJNA"), "mart");
		assert.equal(normalizeMerchantName("Mart S.A."), "mart");
		assert.equal(normalizeMerchantName("Mart GmbH"), "mart");
		assert.equal(normalizeMerchantName("Mart B.V."), "mart");
	});

	it("keeps a legal form inside a word", () => {
		assert.equal(normalizeMerchantName("Salsa"), "salsa");
	});

	it("keeps the words with digits of a name that has nothing else", () => {
		assert.equal(normalizeMerchantName("EC1"), "ec1");
	});
});

describe("similarity", () => {
	it("is 1 for names that normalize the same", () => {
		assert.equal(score("ZABKA Z1234", "Żabka"), 1);
	});

	it("is high for alike names and low for different ones", () => {
		assert.ok(score("Corner Cafe", "CORNER CAFE KRAKOW") > 0.6);
		assert.ok(score("Corner Cafe", "Supermart") < 0.2);
	});
});

describe("findSuggestions", () => {
	const names = new Map([
		["zabka", ["Żabka"]],
		["zabka-store", ["ZABKA Z5678"]],
		["mart", ["Mart", "MART POLSKA SP Z O O"]],
		["mart-polska", ["Mart Polska"]],
		["cafe", ["Corner Cafe"]],
	]);

	it("suggests merchants with alike names both ways, comparing every name", () => {
		const suggestions = findSuggestions(names, () => false);

		assert.deepEqual(suggestions.get("zabka"), [{ merchantId: "zabka-store", score: 1 }]);
		assert.deepEqual(suggestions.get("zabka-store"), [{ merchantId: "zabka", score: 1 }]);
		// "MART POLSKA SP Z O O", a merged name of "mart", is what matches
		assert.deepEqual(suggestions.get("mart-polska"), [{ merchantId: "mart", score: 1 }]);
		assert.deepEqual(suggestions.get("cafe"), []);
	});

	it("leaves out dismissed pairs", () => {
		const suggestions = findSuggestions(
			names,
			(a, b) => [a, b].includes("zabka") && [a, b].includes("zabka-store"),
		);

		assert.deepEqual(suggestions.get("zabka"), []);
	});

	it("keeps the best suggestions only", () => {
		const many = new Map(
			Array.from({ length: MAX_SUGGESTIONS + 3 }, (_, i) => [`m${i}`, [`Mart ${"x".repeat(i)}`]]),
		);
		const suggestions = findSuggestions(many, () => false).get("m0") ?? [];

		assert.equal(suggestions.length, MAX_SUGGESTIONS);
		assert.ok(suggestions.every((s, i) => i === 0 || (suggestions[i - 1]?.score ?? 0) >= s.score));
	});
});
