import { Hono } from "hono";

import { config } from "./config.ts";

/** Brandfetch settings of the admin app, mounted at /api/admin/brandfetch */
export const adminBrandfetchApi = new Hono()
	/** GET /api/admin/brandfetch: `clientId` is `null` while Brandfetch isn't configured */
	.get("/", (c) => c.json({ clientId: config.BRANDFETCH_CLIENT_ID ?? null }, 200));
