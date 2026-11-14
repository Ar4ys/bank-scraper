import { Hono } from "hono";

import { listSureCategories, sureEnabled } from "./sure.ts";

/** What the admin app reads from Sure, mounted at /api/admin/sure */
export const adminSureApi = new Hono()
	/**
	 * GET /api/admin/sure/categories
	 *
	 * Read from Sure on every request. `enabled` is false, with no categories, while Sure isn't
	 * configured; a Sure that fails answers 502.
	 */
	.get("/categories", async (c) => {
		if (!sureEnabled()) return c.json({ enabled: false, categories: [] }, 200);

		try {
			return c.json({ enabled: true, categories: await listSureCategories() }, 200);
		} catch (error) {
			return c.json({ message: error instanceof Error ? error.message : String(error) }, 502);
		}
	});
