import { createHash } from "node:crypto";

/** `@version` of `meta.txt`, which the build replaces with the version it computes */
export const versionPlaceholder = "{{version}}";

type VersionedPackage = { version: string; versionHash?: string };

/**
 * Version of a build of the userscript: the package's version while the build has the recorded
 * `versionHash`, otherwise that version with its last number incremented. `code` is the bundle with
 * the placeholder still in it, so that the version does not feed into its own hash.
 */
export function buildVersion(pkg: VersionedPackage, code: string) {
	const versionHash = createHash("sha256").update(code).digest("hex").slice(0, 16);
	if (versionHash === pkg.versionHash) return { version: pkg.version, versionHash, changed: false };

	const parts = pkg.version.split(".");
	const last = Number(parts.at(-1));
	if (!/^\d+$/.test(parts.at(-1) ?? "") || !Number.isSafeInteger(last)) {
		throw new Error(`Cannot increment the last number of the version "${pkg.version}"`);
	}
	parts[parts.length - 1] = String(last + 1);

	return { version: parts.join("."), versionHash, changed: true };
}
