import fs from "node:fs/promises";
import path from "node:path";

import JSONC from "jsonc-simple-parser";

/**
 * The set of possible `typeof` results, with `null` specially reported as `"null"` instead of
 * `"object"` (since `typeof null === "object"` in JS).
 */
type TypeName =
	| "string"
	| "number"
	| "boolean"
	| "bigint"
	| "symbol"
	| "function"
	| "object"
	| "null"
	| "undefined";

/** A plain object: not an array, not null. */
type PlainObject = Record<string, unknown>;

/**
 * Recursive shape of the output. Each key maps either to an array of encountered `TypeName`s
 * (leaf), or to a nested `TypeShapeNode` (when the key held object values). A nested node may
 * additionally carry a `__types__` array to record any primitive/undefined sightings for that same
 * key at that depth.
 */
interface TypeShapeNode {
	[key: string]: TypeName[] | TypeShapeNode;
}

function isPlainObject(value: unknown): value is PlainObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeOf(value: unknown): TypeName {
	if (value === null) return "null";
	return typeof value;
}

/**
 * Deeply merges the _shape_ of a list of objects into a single object, collecting an array of
 * unique `typeof` values seen for each leaf key (with `null` specially reported as "null" instead
 * of "object"), and `"undefined"` recorded whenever the key is missing from a sibling object at
 * that same depth.
 *
 * - Nested plain objects are preserved as nested objects (recursively merged).
 * - Arrays anywhere in the structure cause a thrown Error.
 * - If a key is sometimes an object and sometimes a primitive/missing across sibling objects, the
 *   primitive/undefined types get recorded under a `__types__` bucket on that nested object.
 *
 * @param items - Array of plain objects to walk
 * @returns A single object with all keys, values = array of typeof strings
 */
function collectTypeShape(items: unknown[]): TypeShapeNode {
	if (!Array.isArray(items)) {
		throw new TypeError("Input must be an array of objects");
	}

	/**
	 * `sources` = sibling objects that live at this same depth/branch. e.g. at the top level,
	 * `sources` = the original `items` array. For a nested key, `sources` = every object-value found
	 * for that key across the parent's siblings.
	 */
	function buildLevel(sources: PlainObject[], keyPath: string): TypeShapeNode {
		const result: TypeShapeNode = {};
		const keys = new Set<string>();

		for (const src of sources) {
			if (Array.isArray(src)) {
				throw new Error(`Unexpected array found at "${keyPath || "<root>"}"`);
			}
			for (const key of Object.keys(src)) keys.add(key);
		}

		for (const key of keys) {
			const currentPath = keyPath ? `${keyPath}.${key}` : key;
			const types = new Set<TypeName>();
			const nestedSources: PlainObject[] = [];
			let hasObject = false;

			for (const src of sources) {
				if (!(key in src)) {
					types.add("undefined");
					continue;
				}

				const value = src[key];

				if (Array.isArray(value)) {
					throw new Error(`Unexpected array found at "${currentPath}"`);
				}

				if (isPlainObject(value)) {
					hasObject = true;
					nestedSources.push(value);
				} else {
					types.add(typeOf(value));
				}
			}

			if (hasObject) {
				const nested = buildLevel(nestedSources, currentPath);
				if (types.size > 0) {
					// oxlint-disable-next-line no-underscore-dangle
					nested.__types__ = Array.from(types);
				}
				result[key] = nested;
			} else {
				result[key] = Array.from(types);
			}
		}

		return result;
	}

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (Array.isArray(item)) {
			throw new Error(`Unexpected array found at top-level index [${i}]`);
		}
		if (!isPlainObject(item)) {
			throw new TypeError(`Item at index ${i} is not a plain object`);
		}
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return buildLevel(items as PlainObject[], "");
}

const basePath = path.join(import.meta.dirname, "../local/schemas/filtered");
const dirs = await fs.readdir(basePath);

const objects: unknown[] = [];

for (const dir of dirs) {
	// skip files
	if (dir.includes(".")) continue;

	const files = await fs.readdir(path.join(basePath, dir));

	for (const file of files) {
		const data: { sample: unknown } = JSON.parse(
			await fs.readFile(path.join(basePath, dir, file), "utf8"),
		);

		objects.push(data.sample);
	}
}

// const a = JSONC.parse(
// 	await fs.readFile(path.join(import.meta.dirname, "../local/schemas/filtered/all.json"), "utf8"),
// );

console.dir(collectTypeShape(objects), {
	depth: 10,
});
