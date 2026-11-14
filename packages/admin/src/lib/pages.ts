/**
 * The page buttons of a pager, as page indexes from 0 with `null` for a gap: the first and the last
 * page, and two either side of `current`. A gap of a single page shows that page instead. Empty
 * when there is at most one page.
 */
export function pageItems(current: number, count: number): Array<number | null> {
	if (count <= 1) return [];

	const shown = new Set([0, count - 1]);
	for (let page = current - 2; page <= current + 2; page++) {
		if (page >= 0 && page < count) shown.add(page);
	}

	const items: Array<number | null> = [];
	let previous = -1;
	for (const page of [...shown].toSorted((a, b) => a - b)) {
		if (page - previous === 2) items.push(previous + 1);
		else if (page - previous > 2) items.push(null);
		items.push(page);
		previous = page;
	}
	return items;
}

/** Rows shown per page by the lists the admin app pages through itself */
export const PAGE_SIZE = 50;

/** `offset` moved back onto the last page when the list became shorter than it */
export const clampOffset = (offset: number, total: number, limit = PAGE_SIZE) =>
	total === 0 ? 0 : Math.min(offset, Math.floor((total - 1) / limit) * limit);
