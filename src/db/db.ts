import { drizzle } from "drizzle-orm/pglite";

export const db = drizzle("../local/dev.db");
