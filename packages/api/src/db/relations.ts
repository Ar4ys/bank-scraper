import { defineRelations } from "drizzle-orm";

import { rawTransactions } from "./schema.ts";

export const relations = defineRelations({ rawTransactions });
