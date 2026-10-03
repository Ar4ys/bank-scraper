import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffJson } from "./diff.ts";

describe("diffJson", () => {
	it("returns nothing for equal values, whatever the key order", () => {
		assert.deepEqual(diffJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), []);
	});

	it("reports added, removed and changed leaves by path, sorted by key", () => {
		assert.deepEqual(
			diffJson(
				{ title: "old", details: { city: "Tallinn", gone: true } },
				{ title: "new", details: { city: "Tallinn", merchant_name: "Bolt" } },
			),
			[
				{ path: "details.gone", kind: "removed", before: true },
				{ path: "details.merchant_name", kind: "added", after: "Bolt" },
				{ path: "title", kind: "changed", before: "old", after: "new" },
			],
		);
	});

	it("compares arrays by index", () => {
		assert.deepEqual(
			diffJson({ items: [{ a: 1 }, { a: 2 }] }, { items: [{ a: 1 }, { a: 3 }, { a: 4 }] }),
			[
				{ path: "items[1].a", kind: "changed", before: 2, after: 3 },
				{ path: "items[2]", kind: "added", after: { a: 4 } },
			],
		);
	});

	it("reports a change of type as one changed entry", () => {
		assert.deepEqual(diffJson({ a: { b: 1 } }, { a: null }), [
			{ path: "a", kind: "changed", before: { b: 1 }, after: null },
		]);
		assert.deepEqual(diffJson({ a: [1] }, { a: { 0: 1 } }), [
			{ path: "a", kind: "changed", before: [1], after: { 0: 1 } },
		]);
	});

	it("diffs from nothing", () => {
		assert.deepEqual(diffJson(null, { a: 1 }), [
			{ path: "", kind: "changed", before: null, after: { a: 1 } },
		]);
	});
});
