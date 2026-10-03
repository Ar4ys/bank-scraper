import { z } from "zod";

export const ingestBodySchema = z.object({
	/** The bank's identifier of the account the transactions belong to */
	sourceAccount: z.string().nonempty(),
	transactions: z.array(
		z.object({
			/** The bank's identifier of the transaction */
			bankId: z.string().nonempty(),
			data: z.json(),
		}),
	),
});
export type IngestBody = z.infer<typeof ingestBodySchema>;
