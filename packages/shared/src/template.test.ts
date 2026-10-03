import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderTemplate } from "./template.ts";

describe("renderTemplate", () => {
	const context = { title: "BOLT.EU/P/1", details: { city: "Tallinn", amount: 12 }, empty: null };

	it("replaces placeholders with values at dot paths", () => {
		assert.equal(renderTemplate("{title} in {details.city}", context), "BOLT.EU/P/1 in Tallinn");
		assert.equal(renderTemplate("{details.amount}", context), "12");
	});

	it("renders a placeholder that points at nothing as empty text", () => {
		assert.equal(renderTemplate("[{details.missing}][{nope.deeper}][{empty}]", context), "[][][]");
	});

	it("replaces {match.N} with capture groups", () => {
		assert.equal(
			renderTemplate("Ride {match.1} ({match.0})", context, ["P/1", "1"]),
			"Ride 1 (P/1)",
		);
		assert.equal(renderTemplate("{match.5}", context, ["all"]), "");
	});

	it("leaves text without placeholders alone", () => {
		assert.equal(renderTemplate("Bolt", context), "Bolt");
	});
});
