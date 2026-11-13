/**
 * What the payments of one place have in common: the address in lower case and letters only, so
 * store numbers, timestamps, codes and punctuation do not split them. `BOLT.EU/O/2604081424`
 * becomes `bolt eu o`. It groups payments for the list of places, it never matches them.
 */
export const placeKey = (address: string) =>
	address
		.toLowerCase()
		// Bolt's service code is followed by a timestamp, and some statements drop the slashes
		// around it: https://bolt.eu/en-pl/support/articles/36283
		.replace(/^bolt\.eu\/?(cardcheck|[odrpscb])\/?(?=\d|$)/, "bolt.eu/$1/")
		.split(/[^\p{L}]+/u)
		.filter((word) => word !== "")
		.join(" ");

/** The text without what trails its last letter, e.g. a store number */
const withoutTrailingNonLetters = (text: string) => text.replace(/[^\p{L}]+$/u, "").trim();

/**
 * A merchant map entry text for the addresses of a place: the longest text they all share, ignoring
 * case, with whitespace collapsed and without what trails its last letter (`LIDL 3011`, `LIDL 3012`
 * → `LIDL`). Shared numbers alone never win. The shortest address when they share no letter.
 */
export function proposeEntryText(addresses: readonly string[]): string {
	const [shortest, ...others] = addresses
		.map((address) => address.replace(/\s+/g, " ").trim())
		.toSorted((a, b) => a.length - b.length);
	if (shortest === undefined) return "";

	const lowerOthers = others.map((text) => text.toLowerCase());
	let best = "";

	for (let start = 0; start < shortest.length; start++) {
		for (let end = shortest.length; end > start; end--) {
			const candidate = withoutTrailingNonLetters(shortest.slice(start, end));
			if (candidate.length <= best.length) break;

			const lower = shortest.slice(start, end).toLowerCase();
			if (lowerOthers.every((text) => text.includes(lower))) {
				best = candidate;
				break;
			}
		}
	}

	return best || shortest;
}
