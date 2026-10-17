import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVersion } from "./buildVersion.mts";

describe("buildVersion", () => {
	const first = buildVersion({ version: "1.5" }, "code");

	it("increments the last number when no hash is recorded yet", () => {
		assert.equal(first.version, "1.6");
		assert.equal(first.changed, true);
	});

	it("keeps the version while the build has the recorded hash", () => {
		const again = buildVersion({ version: "1.6", versionHash: first.versionHash }, "code");
		assert.deepEqual(again, { version: "1.6", versionHash: first.versionHash, changed: false });
	});

	it("increments the version when the build changes", () => {
		const changed = buildVersion({ version: "1.9", versionHash: first.versionHash }, "other code");
		assert.equal(changed.version, "1.10");
		assert.notEqual(changed.versionHash, first.versionHash);
	});

	it("refuses a version whose last part is not a number", () => {
		assert.throws(() => buildVersion({ version: "1.5-beta" }, "code"), /Cannot increment/);
	});
});
