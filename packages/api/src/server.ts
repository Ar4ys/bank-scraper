import { serve, type ServerType } from "@hono/node-server";

import { app } from "./app.ts";
import { config } from "./config.ts";
import { db, initSQLite } from "./db/db.ts";

function registerShutdownHandlers(server: ServerType) {
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

async function main() {
	await initSQLite();

	const server = serve(
		{ fetch: app.fetch, hostname: config.HTTP_HOST, port: config.HTTP_PORT },
		(info) => {
			console.log(`Running on ${info.address}:${info.port}`);
		},
	);

	registerShutdownHandlers(server);
}

void main();
