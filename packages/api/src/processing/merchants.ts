import { eq } from "drizzle-orm";

import { db, tables } from "../db/db.ts";
import { type Merchant } from "../db/schema.ts";

/** The form in which merchant names are compared: case and surrounding whitespace do not count */
export const merchantKey = (name: string) => name.trim().toLowerCase();

export type KnownMerchant = Pick<Merchant, "id" | "name" | "deletedAt">;

/** Every known merchant name, by its `merchantKey` */
export type MerchantDirectory = Map<string, KnownMerchant>;

export function loadMerchantDirectory(): MerchantDirectory {
	const { merchants, merchantNames } = tables;

	const rows = db
		.select({
			key: merchantNames.key,
			id: merchants.id,
			name: merchants.name,
			deletedAt: merchants.deletedAt,
		})
		.from(merchantNames)
		.innerJoin(merchants, eq(merchants.id, merchantNames.merchantId))
		.all();

	return new Map(rows.map(({ key, ...merchant }) => [key, merchant]));
}

/** Creates a merchant that is known by the given name only */
export function createMerchant(name: string): KnownMerchant {
	const { merchants, merchantNames } = tables;

	const merchant = db.insert(merchants).values({ name: name.trim() }).returning().get();
	db.insert(merchantNames)
		.values({ key: merchantKey(name), name: name.trim(), merchantId: merchant.id })
		.run();

	return merchant;
}

export type ResolvedMerchant = { id: string | null; name: string | null };

/**
 * Finds the merchant a derived merchant text stands for and creates it if the name is new. A
 * deleted merchant resolves to no merchant. With `dryRun` nothing is created: a new name is
 * returned as it is, without an id.
 */
export function resolveMerchant(
	derivedName: string | null,
	directory: MerchantDirectory,
	dryRun: boolean,
): ResolvedMerchant {
	if (derivedName === null) return { id: null, name: null };

	const key = merchantKey(derivedName);
	let merchant = directory.get(key);

	if (!merchant) {
		if (dryRun) return { id: null, name: derivedName };

		merchant = createMerchant(derivedName);
		directory.set(key, merchant);
	}

	return merchant.deletedAt ? { id: null, name: null } : { id: merchant.id, name: merchant.name };
}
