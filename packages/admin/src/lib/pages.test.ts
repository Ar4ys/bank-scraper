import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pageItems } from "./pages.ts";

describe("pageItems", () => {
	it("shows nothing for a single page", () => {
		assert.deepEqual(pageItems(0, 0), []);
		assert.deepEqual(pageItems(0, 1), []);
	});

	it("shows every page when there are few", () => {
		assert.deepEqual(pageItems(0, 5), [0, 1, 2, 3, 4]);
		assert.deepEqual(pageItems(3, 7), [0, 1, 2, 3, 4, 5, 6]);
	});

	it("shows the first, the last and two either side of the current page", () => {
		assert.deepEqual(pageItems(10, 20), [0, null, 8, 9, 10, 11, 12, null, 19]);
		assert.deepEqual(pageItems(0, 20), [0, 1, 2, null, 19]);
		assert.deepEqual(pageItems(19, 20), [0, null, 17, 18, 19]);
	});

	it("shows a single skipped page rather than a gap", () => {
		assert.deepEqual(pageItems(4, 20), [0, 1, 2, 3, 4, 5, 6, null, 19]);
	});
});
