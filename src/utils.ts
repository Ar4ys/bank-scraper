import { createHash } from "node:crypto";

import type { ServerType } from "@hono/node-server";
import { stableHash } from "stable-hash";

import { db } from "./db/db.ts";

export function jsonSha256(arg: unknown) {
	return createHash("sha256").update(stableHash(arg)).digest("hex");
}

export function registerShutdownHandlers(server: ServerType) {
	const handler = async () => {
		console.log("Stopping http server...");
		const error = await new Promise<Error | undefined>((res) =>
			server.close(res),
		);

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
