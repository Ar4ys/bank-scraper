import { z } from "zod";

/** Sure's logo URL for a domain, so both apps show the same icon */
export const logoUrl = (clientId: string, domain: string) =>
	`https://cdn.brandfetch.io/${encodeURIComponent(domain)}/icon/fallback/lettermark/w/64/h/64?c=${encodeURIComponent(clientId)}`;

const searchResultsSchema = z.array(
	z.object({
		brandId: z.string(),
		name: z.string().nullable(),
		domain: z.string(),
		icon: z.string().nullable(),
	}),
);

export type BrandSearchResult = z.infer<typeof searchResultsSchema>[number];

/**
 * Brandfetch's brand search, called from the browser as Brandfetch requires. The results are only
 * shown: Brandfetch's terms don't allow keeping them, and their icon URLs expire after a day.
 */
export async function searchBrands(clientId: string, query: string, signal?: AbortSignal) {
	const response = await fetch(
		`https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}?c=${encodeURIComponent(clientId)}`,
		{ signal },
	);
	if (response.status === 429) throw new Error("Brandfetch's search limit is reached, try later");
	if (!response.ok) throw new Error(`Brandfetch answered ${response.status}`);

	const parsed = searchResultsSchema.safeParse(await response.json());
	if (!parsed.success) throw new Error("Brandfetch answered with unexpected results");
	// The list is keyed by brand, and a key may appear only once
	return [...new Map(parsed.data.map((result) => [result.brandId, result])).values()];
}
