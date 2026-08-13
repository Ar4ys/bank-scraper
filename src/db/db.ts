import { drizzle } from "drizzle-orm/pglite";

import { relations } from "./relations.ts";

export * as tables from "./schema.ts";

export const db = drizzle("./local/dev-db", { relations });
