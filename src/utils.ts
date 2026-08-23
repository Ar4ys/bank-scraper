import { createHash } from "node:crypto";

import type { ServerType } from "@hono/node-server";
import { type Hook } from "@hono/zod-validator";
import * as hono from "hono";
import { stableHash } from "stable-hash";
import { z } from "zod";

import { db } from "./db/db.ts";

type EnumLike = Readonly<Record<string, string | number>>;
export type DefineEnum<T extends EnumLike> = T[keyof T];

export function jsonSha256(arg: unknown) {
	return createHash("sha256").update(stableHash(arg)).digest("hex");
}

export function registerShutdownHandlers(server: ServerType) {
	const handler = async () => {
		console.log("Stopping http server...");
		const error = await new Promise<Error | undefined>((res) => server.close(res));

		if (error) {
			console.error("While shutting down http server:", error);
		}

		console.log("Http server is down!");

		console.log("Flushing SQLite WAL...");
		db.run("PRAGMA wal_checkpoint(TRUNCATE);");
		console.log("Flushed successfully!");

		console.log("Closing SQLite...");
		db.$client.close();
		console.log("Closed!");

		process.exit(error ? 1 : 0);
	};

	process.on("SIGINT", handler);
	process.on("SIGTERM", handler);
	process.on("uncaughtException", handler);
	process.on("unhandledRejection", handler);
}

export const zValidatorHook = <
	T,
	E extends hono.Env,
	P extends string,
	Target extends keyof hono.ValidationTargets = keyof hono.ValidationTargets,
	O = {},
	Schema extends z.ZodSchema = any,
>(
	...[result, c]: Parameters<Hook<T, E, P, Target, O, Schema>>
): ReturnType<Hook<T, E, P, Target, O, Schema>> => {
	if (c.req.header("Content-Type") !== "application/json")
		return c.json(
			{
				success: false,
				error: "Expected Content-Type to be application/json",
			},
			400,
		);

	if (result.success) return;

	return c.json(
		{
			success: false,
			error: z.flattenError(result.error),
		},
		400,
	);
};
