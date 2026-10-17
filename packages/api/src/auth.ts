import { createHash, timingSafeEqual } from "node:crypto";

import { createMiddleware } from "hono/factory";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Compares two secrets in constant time */
export const secretsEqual = (a: string, b: string) =>
	// Hashing first gives both sides the same length, which timingSafeEqual requires
	timingSafeEqual(sha256(a), sha256(b));

/**
 * Requires the key in `x-api-key` or as `Authorization: Bearer`, which are the two ways the Lunch
 * Flow API accepts it. Answers 401 in the Lunch Flow error shape otherwise.
 */
export const apiKeyAuth = (expectedKey: string) => {
	return createMiddleware(async (c, next) => {
		const key = c.req.header("x-api-key") ?? c.req.header("Authorization")?.replace(/^Bearer /, "");

		if (key === undefined || !secretsEqual(key, expectedKey)) {
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
