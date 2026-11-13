/** Merchants whose best pair of names scores lower are not suggested as duplicates */
export const SUGGESTION_MIN_SCORE = 0.4;

/** Suggestions per merchant, the best ones */
export const MAX_SUGGESTIONS = 5;

/** Legal forms in the form `normalizeMerchantName` compares them, longest first */
const legalForms = [
	"spolka z ograniczona odpowiedzialnoscia",
	"spolka akcyjna",
	"sp z o o",
	"s a",
	"sa",
	"gmbh",
	"b v",
	"bv",
	"ltd",
	"inc",
	"llc",
];

/**
 * A merchant name as it is compared for duplicates: lower case, without diacritics, punctuation,
 * words with digits (store numbers, codes) and legal forms. A name of nothing but those keeps its
 * words with digits, so `EC1` stays comparable.
 */
export function normalizeMerchantName(name: string): string {
	const words = name
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		// `ł` has no decomposition that would drop its stroke
		.replaceAll("ł", "l")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word !== "");

	let text = ` ${words.filter((word) => !/\p{N}/u.test(word)).join(" ")} `;
	for (const form of legalForms) {
		while (text.includes(` ${form} `)) text = text.replace(` ${form} `, " ");
	}

	return text.trim() || words.join(" ");
}

/** The character trigrams of a normalized name, padded so that its first and last letters count */
export function trigrams(normalized: string): Set<string> {
	const padded = ` ${normalized} `;
	const result = new Set<string>();
	for (let i = 0; i + 3 <= padded.length; i++) result.add(padded.slice(i, i + 3));

	return result;
}

/** Sørensen–Dice coefficient of two trigram sets: 1 for the same name, 0 for nothing in common */
export function similarity(a: Set<string>, b: Set<string>): number {
	if (!a.size || !b.size) return 0;

	let shared = 0;
	for (const gram of a) if (b.has(gram)) shared++;

	return (2 * shared) / (a.size + b.size);
}

export type MerchantSuggestion = { merchantId: string; score: number };

/**
 * For every merchant, the other merchants that are probably the same one, best first: those whose
 * most alike pair of names scores at least `SUGGESTION_MIN_SCORE`, without dismissed pairs, at most
 * `MAX_SUGGESTIONS`. `names` holds every name of every merchant to compare, the shown and the
 * merged ones; `isDismissed` says whether a pair of merchant ids was marked as no duplicates.
 */
export function findSuggestions(
	names: ReadonlyMap<string, readonly string[]>,
	isDismissed: (merchantId: string, otherMerchantId: string) => boolean,
): Map<string, MerchantSuggestion[]> {
	const merchants = [...names].map(([merchantId, merchantNames]) => ({
		merchantId,
		grams: merchantNames.map((name) => trigrams(normalizeMerchantName(name))),
	}));
	const suggestions = new Map<string, MerchantSuggestion[]>(
		merchants.map(({ merchantId }) => [merchantId, []]),
	);

	for (const [i, merchant] of merchants.entries()) {
		for (const other of merchants.slice(i + 1)) {
			let score = 0;
			for (const a of merchant.grams) {
				for (const b of other.grams) score = Math.max(score, similarity(a, b));
			}

			if (score < SUGGESTION_MIN_SCORE || isDismissed(merchant.merchantId, other.merchantId)) {
				continue;
			}

			suggestions.get(merchant.merchantId)?.push({ merchantId: other.merchantId, score });
			suggestions.get(other.merchantId)?.push({ merchantId: merchant.merchantId, score });
		}
	}

	for (const [merchantId, list] of suggestions) {
		suggestions.set(
			merchantId,
			list.toSorted((a, b) => b.score - a.score).slice(0, MAX_SUGGESTIONS),
		);
	}

	return suggestions;
}
