import { z } from "zod";

import { config } from "./config.ts";

const categoriesPageSchema = z.object({
	categories: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			color: z.string(),
			parent: z.object({ name: z.string() }).nullable(),
		}),
	),
	pagination: z.object({ total_pages: z.number().int() }),
});

export type SureCategory = { id: string; name: string; color: string; parentName: string | null };

/** Whether Sure's URL and API key are configured */
export const sureEnabled = () =>
	config.SURE_API_URL !== undefined && config.SURE_API_KEY !== undefined;

/**
 * Every category of the family Sure's API key belongs to, in Sure's order. Throws when Sure isn't
 * configured, can't be reached, or answers with anything but its list.
 */
export async function listSureCategories(): Promise<SureCategory[]> {
	const { SURE_API_URL: baseUrl, SURE_API_KEY: apiKey } = config;
	if (baseUrl === undefined || apiKey === undefined) throw new Error("Sure is not configured");

	const categories: SureCategory[] = [];

	for (let page = 1, totalPages = 1; page <= totalPages; page++) {
		const url = `${baseUrl}/api/v1/categories?page=${page}&per_page=100`;
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { "X-Api-Key": apiKey, Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			});
		} catch (error) {
			throw new Error(`Sure can't be reached at ${baseUrl}: ${String(error)}`, { cause: error });
		}

		if (response.status !== 200) {
			throw new Error(`Sure answered ${response.status} when listing its categories`);
		}

		const parsed = categoriesPageSchema.safeParse(await response.json().catch(() => undefined));
		if (!parsed.success) throw new Error("Sure answered with an unexpected list of categories");

		totalPages = parsed.data.pagination.total_pages;
		for (const category of parsed.data.categories) {
			categories.push({
				id: category.id,
				name: category.name,
				color: category.color,
				parentName: category.parent?.name ?? null,
			});
		}
	}

	return categories;
}
