import { createHash, timingSafeEqual } from "node:crypto";

import { createMiddleware } from "hono/factory";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * Requires the key in `x-api-key` or as `Authorization: Bearer`, which are the two ways the Lunch
 * Flow API accepts it. Answers 401 in the Lunch Flow error shape otherwise.
 */
export const apiKeyAuth = (expectedKey: string) => {
	const expectedHash = sha256(expectedKey);

	return createMiddleware(async (c, next) => {
		const key = c.req.header("x-api-key") ?? c.req.header("Authorization")?.replace(/^Bearer /, "");

		// Hashing first gives both sides the same length, which timingSafeEqual requires
		if (key === undefined || !timingSafeEqual(sha256(key), expectedHash)) {
			return c.json(
				{
					error: "Unauthorized",
					message:
						"Authentication required. Provide x-api-key header or Authorization: Bearer token.",
				},
				401,
			);
		}

		await next();
	});
};
