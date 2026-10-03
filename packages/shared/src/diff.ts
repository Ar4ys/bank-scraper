export type DiffEntry = {
	/** Dot path of the value, with `[n]` for array items, e.g. `details.items[0].title` */
	path: string;
	kind: "added" | "removed" | "changed";
	before?: unknown;
	after?: unknown;
};

type Container = Record<string, unknown>;

// Arrays are read by key like objects are, their keys being the indexes
const asContainer = (value: unknown): Container | undefined =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	typeof value === "object" && value !== null ? (value as Container) : undefined;

function collect(before: unknown, after: unknown, path: string, entries: DiffEntry[]) {
	if (Object.is(before, after)) return;

	const [beforeContainer, afterContainer] = [asContainer(before), asContainer(after)];
	const isArray = Array.isArray(before);

	if (!beforeContainer || !afterContainer || isArray !== Array.isArray(after)) {
		entries.push({ path, kind: "changed", before, after });
		return;
	}

	const keys = [...new Set([...Object.keys(beforeContainer), ...Object.keys(afterContainer)])];
	// Array indexes stay in numeric order, object keys are sorted so that key order never matters
	if (!isArray) keys.sort();

	for (const key of keys) {
		const childPath = isArray ? `${path}[${key}]` : path ? `${path}.${key}` : key;

		if (!(key in beforeContainer)) {
			entries.push({ path: childPath, kind: "added", after: afterContainer[key] });
		} else if (!(key in afterContainer)) {
			entries.push({ path: childPath, kind: "removed", before: beforeContainer[key] });
		} else {
			collect(beforeContainer[key], afterContainer[key], childPath, entries);
		}
	}
}

/**
 * Structural diff of two JSON values: one entry per leaf that was added, removed or changed. Arrays
 * are compared item by item at the same index.
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
	const entries: DiffEntry[] = [];
	collect(before, after, "", entries);
	return entries;
}
