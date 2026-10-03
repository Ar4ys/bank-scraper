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
	search?: string;
}) => unwrap(api.transactions.$get({ query: toQuery(query) }));

export type TransactionDetail = Awaited<ReturnType<typeof loadTransaction>>;
export const loadTransaction = (id: string) =>
	unwrap(api.transactions[":id"].$get({ param: { id } }));

export type ProcessingReport = Awaited<ReturnType<typeof reprocess>>;
export type ReprocessScope = "all" | "failed" | { accountId: number; bankId: string };
export const reprocess = (scope: ReprocessScope, dryRun: boolean) =>
	unwrap(api.reprocess.$post({ json: { scope, dryRun } }));

export const renameAccount = (id: number, name: string) =>
	unwrap(api.accounts[":id"].$patch({ param: { id: String(id) }, json: { name } }));

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
