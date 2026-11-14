import type { AdminApi } from "@bank-scraper/api/admin";
import { hc, type ClientResponse } from "hono/client";

export const api = hc<AdminApi>("/api/admin");

type OkBody<R> = R extends ClientResponse<infer T, 200> ? T : never;

/** Body of a successful response. Throws the server's message for any other status. */
export async function unwrap<R extends ClientResponse<unknown>>(request: Promise<R>) {
	const response = await request;

	if (!response.ok) {
		const body: unknown = await response.json().catch(() => undefined);
		const message =
			typeof body === "object" && body !== null && "message" in body
				? String(body.message)
				: response.statusText;

		throw new Error(`${response.status} ${message}`);
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return (await response.json()) as OkBody<R>;
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
export const loadDashboard = () => unwrap(api.dashboard.$get());

export type Userscript = Awaited<ReturnType<typeof loadUserscript>>;
export const loadUserscript = () => unwrap(api.userscript.$get());

export type Account = Awaited<ReturnType<typeof loadAccounts>>[number];
export const loadAccounts = () => unwrap(api.accounts.$get());

export type RawTransactionList = Awaited<ReturnType<typeof loadRawTransactions>>;
export const loadRawTransactions = (query: {
	limit: number;
	offset: number;
	accountId?: string;
	status?: "unprocessed" | "processed" | "hold" | "error";
}) => unwrap(api["raw-transactions"].$get({ query: toQuery(query) }));

export type RawTransactionDetail = Awaited<ReturnType<typeof loadRawTransaction>>;
export const loadRawTransaction = (accountId: string, bankId: string) =>
	unwrap(api["raw-transactions"][":accountId"][":bankId"].$get({ param: { accountId, bankId } }));

export type TransactionList = Awaited<ReturnType<typeof loadTransactions>>;
export const loadTransactions = (query: {
	limit: number;
	offset: number;
	accountId?: string;
	withoutMerchant?: boolean;
	merchantId?: string;
	merchantMapEntryId?: string;
	search?: string;
}) => unwrap(api.transactions.$get({ query: toQuery(query) }));

export type TransactionDetail = Awaited<ReturnType<typeof loadTransaction>>;
export const loadTransaction = (id: string) =>
	unwrap(api.transactions[":id"].$get({ param: { id } }));

export type ProcessingReport = Awaited<ReturnType<typeof reprocess>>;
export type ReprocessScope = "all" | "failed" | { accountId: number; bankId: string };
export const reprocess = (scope: ReprocessScope, dryRun: boolean) =>
	unwrap(api.reprocess.$post({ json: { scope, dryRun } }));

export const updateAccount = (
	id: number,
	changes: { name?: string; balanceSource?: Account["balanceSource"] },
) => unwrap(api.accounts[":id"].$patch({ param: { id: String(id) }, json: changes }));

export type Merchant = Awaited<ReturnType<typeof loadMerchants>>[number];
export const loadMerchants = () => unwrap(api.merchants.$get());

/** By merchant id: the merchants that are probably the same one, best first */
export type MerchantSuggestions = Awaited<ReturnType<typeof loadMerchantSuggestions>>;
export const loadMerchantSuggestions = () => unwrap(api.merchants.suggestions.$get());

/** Sure's categories; `enabled` is false while Sure isn't configured */
export type SureCategory = Awaited<ReturnType<typeof loadSureCategories>>["categories"][number];
export const loadSureCategories = () => unwrap(api.sure.categories.$get());

/** Reaches Sure on its next sync; nothing is reprocessed here */
export const setMerchantCategory = (id: string, sureCategoryId: string | null) =>
	unwrap(api.merchants[":id"].category.$put({ param: { id }, json: { sureCategoryId } }));

/** Takes a domain or a URL and answers with the domain stored; reaches Sure on its next sync */
export const setMerchantDomain = (id: string, domain: string | null) =>
	unwrap(api.merchants[":id"].domain.$put({ param: { id }, json: { domain } }));

/** `clientId` is `null` while Brandfetch isn't configured */
export const loadBrandfetch = () => unwrap(api.brandfetch.$get());

/** Confirms a merchant in the review; nothing is reprocessed */
export const reviewMerchant = (id: string) =>
	unwrap(api.merchants[":id"].review.$post({ param: { id } }));

/** Marks two merchants as no duplicates, so they are not suggested together again */
export const dismissMerchantPair = (id: string, otherId: string) =>
	unwrap(api.merchants[":id"].dismiss.$post({ param: { id }, json: { otherId } }));

/**
 * Changes of merchants derive every transaction again and report what changed. With `dryRun`
 * nothing is written, and the report says what would change.
 */
export type MerchantChangeReport = Awaited<ReturnType<typeof deleteMerchant>>;
const dryRunQuery = (dryRun: boolean) => ({ dryRun: String(dryRun) });

export const renameMerchant = (id: string, name: string, dryRun: boolean) =>
	unwrap(
		api.merchants[":id"].$patch({ param: { id }, query: dryRunQuery(dryRun), json: { name } }),
	);

/** Leaves only `intoId`, which takes over the names and transactions of `id` */
export const mergeMerchant = (id: string, intoId: string, dryRun: boolean) =>
	unwrap(
		api.merchants[":id"].merge.$post({
			param: { id },
			query: dryRunQuery(dryRun),
			json: { intoId },
		}),
	);

export const detachMerchantName = (id: string, key: string, dryRun: boolean) =>
	unwrap(
		api.merchants[":id"].detach.$post({ param: { id }, query: dryRunQuery(dryRun), json: { key } }),
	);

export const deleteMerchant = (id: string, dryRun: boolean) =>
	unwrap(api.merchants[":id"].$delete({ param: { id }, query: dryRunQuery(dryRun) }));

/** Removes a deleted merchant and its names for good */
export const removeMerchantPermanently = (id: string, dryRun: boolean) =>
	unwrap(api.merchants[":id"].permanent.$delete({ param: { id }, query: dryRunQuery(dryRun) }));

export const restoreMerchant = (id: string, dryRun: boolean) =>
	unwrap(api.merchants[":id"].restore.$post({ param: { id }, query: dryRunQuery(dryRun) }));

export type RulesState = Awaited<ReturnType<typeof loadRules>>;
export type Rule = RulesState["rules"][number];
/** A rule in the editor: one that is new has no id yet, and its priority is its position */
export type RuleDraft = Omit<Rule, "id" | "priority" | "txTypes"> & {
	id?: string;
	txTypes: string[] | null;
};
export const loadRules = () => unwrap(api.rules.$get());

// The server checks the transaction types, the editor only passes them through
type RulesInput = Parameters<typeof api.rules.$put>[0]["json"]["rules"];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const toRulesInput = (rules: RuleDraft[]) => rules as RulesInput;

export const saveRules = (rules: RuleDraft[]) =>
	unwrap(api.rules.$put({ json: { rules: toRulesInput(rules) } }));

export const previewRules = (rules: RuleDraft[], only?: { accountId: number; bankId: string }) =>
	unwrap(api.rules.preview.$post({ json: { rules: toRulesInput(rules), only } }));

export const applyRules = () => unwrap(api.rules.apply.$post());

export type RuleRevisionSummary = Awaited<ReturnType<typeof loadRuleRevisions>>[number];
export const loadRuleRevisions = () => unwrap(api.rules.revisions.$get());
export const loadRuleRevision = (id: string) =>
	unwrap(api.rules.revisions[":id"].$get({ param: { id } }));

/** Query strings carry text only, and a filter that is not set must be left out */
function toQuery<T extends Record<string, string | number | boolean | undefined>>(query: T) {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return Object.fromEntries(
		Object.entries(query)
			.filter(([, value]) => value !== undefined && value !== "")
			.map(([key, value]) => [key, String(value)]),
	) as { [K in keyof T]: T[K] extends string | undefined ? T[K] : string };
}

/** Recurring card and mobile payments without a merchant, grouped by their address */
export type RecurringPlace = Awaited<ReturnType<typeof loadRecurringPlaces>>[number];
export const loadRecurringPlaces = () => unwrap(api["merchant-map"].places.$get());

/** Leaves a place out of the list: for good, or until it gets a payment dated after today */
export const ignorePlace = (key: string, forever: boolean) =>
	unwrap(api["merchant-map"].places.ignore.$post({ json: { key, forever } }));

/** Puts an ignored place back into the list */
export const restorePlace = (key: string) =>
	unwrap(api["merchant-map"].places.restore.$post({ json: { key } }));

export type MerchantMapEntry = Awaited<ReturnType<typeof loadMerchantMap>>[number];
export const loadMerchantMap = () => unwrap(api["merchant-map"].$get());

/** What a merchant map entry says: payments whose field contains the text get the merchant */
export type MerchantMapEntryInput = Pick<MerchantMapEntry, "field" | "text" | "merchant">;

export const addMerchantMapEntry = (entry: MerchantMapEntryInput, dryRun: boolean) =>
	unwrap(api["merchant-map"].$post({ query: dryRunQuery(dryRun), json: entry }));

export const updateMerchantMapEntry = (
	id: string,
	changes: Partial<MerchantMapEntryInput>,
	dryRun: boolean,
) =>
	unwrap(
		api["merchant-map"][":id"].$patch({ param: { id }, query: dryRunQuery(dryRun), json: changes }),
	);

export const deleteMerchantMapEntry = (id: string, dryRun: boolean) =>
	unwrap(api["merchant-map"][":id"].$delete({ param: { id }, query: dryRunQuery(dryRun) }));
