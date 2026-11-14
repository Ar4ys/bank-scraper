import { queryOption, queryState } from "$lib/queryState";

/**
 * The column a table is sorted by and its direction, kept in the URL under `params`. Sorting by
 * another column starts in the direction `startsDescending` gives it; the same column again
 * reverses. `onsort` runs after every change, e.g. to go back to the first page.
 */
export function querySort<const K extends string>(
	params: { key: string; descending: string },
	keys: readonly K[],
	fallback: { key: NoInfer<K>; descending: boolean },
	startsDescending: (key: K) => boolean,
	onsort?: () => void,
) {
	const key = queryOption(params.key, keys, fallback.key);
	const descending = queryState(params.descending, fallback.descending, {
		parse: (text) => (text === "true" ? true : text === "false" ? false : undefined),
		format: String,
	});

	return {
		get key() {
			return key.value;
		},
		get descending() {
			return descending.value;
		},
		sortBy(next: K) {
			if (key.value === next) {
				descending.value = !descending.value;
			} else {
				key.value = next;
				descending.value = startsDescending(next);
			}
			onsort?.();
		},
	};
}

export type QuerySort<K extends string> = ReturnType<typeof querySort<K>>;

/**
 * Compares two optional texts so that missing ones come last in either direction, and present ones
 * follow `descending`
 */
export function compareOptional(a: string | null, b: string | null, descending: boolean) {
	if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
	const order = a.localeCompare(b);
	return descending ? -order : order;
}
