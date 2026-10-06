import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tokenizeJson } from "./jsonTokens.ts";

const highlighted = (json: string) =>
	tokenizeJson(json)
		.filter((token) => token.kind !== "punctuation")
		.map((token) => [token.kind, token.text]);

describe("tokenizeJson", () => {
	it("tells keys, strings, numbers and literals apart", () => {
		const json = JSON.stringify(
			{ title: "Zakup", amount: -12.5, count: 3, big: 1e21, held: false, done: true, note: null },
			null,
			2,
		);

		assert.deepEqual(highlighted(json), [
			["key", '"title"'],
			["string", '"Zakup"'],
			["key", '"amount"'],
			["number", "-12.5"],
			["key", '"count"'],
			["number", "3"],
			["key", '"big"'],
			["number", "1e+21"],
			["key", '"held"'],
			["literal", "false"],
			["key", '"done"'],
			["literal", "true"],
			["key", '"note"'],
			["literal", "null"],
		]);
	});

	it("gives the input back when the tokens are joined", () => {
		const json = JSON.stringify({ list: [1, "two", { three: null }], empty: {} }, null, 2);

		assert.equal(
			tokenizeJson(json)
				.map((token) => token.text)
				.join(""),
			json,
		);
	});

	it("keeps what looks like syntax inside a string as one string", () => {
		const json = JSON.stringify({ text: 'say "true": 42, {null}\\' });

		assert.deepEqual(highlighted(json), [
			["key", '"text"'],
			["string", String.raw`"say \"true\": 42, {null}\\"`],
		]);
	});

	it("highlights a value that is not an object", () => {
		assert.deepEqual(highlighted('"plain"'), [["string", '"plain"']]);
		assert.deepEqual(highlighted("[]"), []);
	});
});
