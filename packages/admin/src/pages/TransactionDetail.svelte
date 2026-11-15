<script lang="ts">
	import { loadAccounts, loadRawTransaction, loadTransaction, type Account } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";
	import JsonView from "$lib/components/JsonView.svelte";
	import ReprocessButton from "$lib/components/ReprocessButton.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import * as Card from "$lib/components/ui/card";
	import { amountClass, causeLabels, formatInstant } from "$lib/format";
	import { p, route } from "$lib/router";

	// Bumped to load again after a reprocess
	let reloads = $state(0);

	async function load(id: string, _reloads: number) {
		const detail = await loadTransaction(id);
		const { transaction } = detail;
		// What rules see comes with the raw transaction
		const raw = await loadRawTransaction(String(transaction.accountId), transaction.bankId);

		return { ...detail, parsed: raw.parsed, rawVersions: raw.versions };
	}

	const detail = $derived(load(route.params.id ?? "", reloads));

	let accounts = $state<Account[]>([]);
	void loadAccounts().then((loaded) => (accounts = loaded));
</script>

{#await detail}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then { transaction, currentSources, versions, parsed, rawVersions }}
	{@const bank = { accountId: String(transaction.accountId), bankId: transaction.bankId }}
	{@const rawHref = p("/raw/:accountId/:bankId", { params: bank })}

	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-semibold">
			{#if transaction.merchant}
				{transaction.merchant}
			{:else}
				<span class="text-muted-foreground">No merchant</span>
			{/if}
			<span class="ml-2 tabular-nums {amountClass(transaction.amount)}">
				{transaction.amount}
				{transaction.currency}
			</span>
		</h1>
		<span class="flex gap-2">
			<a
				class="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
				href={p("/rules", { search: bank })}
			>
				Try rules on it
			</a>
			<ReprocessButton
				scope={{ accountId: transaction.accountId, bankId: transaction.bankId }}
				label="Reprocess"
				ondone={() => reloads++}
			/>
		</span>
	</div>

	<dl class="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
		<dt class="text-muted-foreground">Description</dt>
		<dd>{transaction.description}</dd>
		<dt class="text-muted-foreground">Notes</dt>
		<dd class="whitespace-pre-line">
			{#if transaction.notes}{transaction.notes}{:else}<span class="text-muted-foreground">—</span>{/if}
		</dd>
		<dt class="text-muted-foreground">Date</dt>
		<dd class="tabular-nums">{transaction.date}</dd>
		<dt class="text-muted-foreground">Set by</dt>
		<dd>
			{#if currentSources.length === 0}
				<span class="text-muted-foreground">not known until it is processed again</span>
			{:else}
				{@const overridden = currentSources.filter((item) => item.source !== "default")}
				{#each overridden as item (item.field)}
					<span class="mr-3">
						<span class="font-mono">{item.field}</span>
						← {item.name ?? item.source}
					</span>
				{/each}
				<span class="text-muted-foreground">
					{overridden.length ? "everything else ←" : "every field ←"} the bank's data
				</span>
			{/if}
		</dd>
		<dt class="text-muted-foreground">Account</dt>
		<dd>{accounts.find((account) => account.id === transaction.accountId)?.name ?? transaction.accountId}</dd>
		<dt class="text-muted-foreground">Id</dt>
		<dd class="font-mono text-xs">{transaction.id}</dd>
		<dt class="text-muted-foreground">Raw transaction</dt>
		<dd>
			<a class="font-mono text-xs underline underline-offset-4" href={rawHref}>{transaction.bankId}</a>
			<span class="text-muted-foreground">
				· {rawVersions.length} version{rawVersions.length === 1 ? "" : "s"} from the bank
			</span>
		</dd>
	</dl>

	{#if parsed}
		<details class="text-sm">
			<summary class="cursor-pointer text-muted-foreground">Parsed bank transaction, as rules see it</summary>
			<JsonView class="mt-2" value={parsed} />
		</details>
	{/if}

	<h2 class="pt-4 text-lg font-semibold">History</h2>

	<!-- Newest first, each version diffed against the one before it -->
	{#each versions.toReversed() as version, index (version.id)}
		{@const previous = versions[versions.length - index - 2]}
		{@const rawVersion = rawVersions.findIndex((raw) => raw.id === version.rawTransactionId) + 1}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center gap-2 text-base">
					{previous ? causeLabels[version.cause] : "Created"}
					{#if index === 0}
						<Badge variant="secondary">current</Badge>
					{/if}
					<span class="text-sm font-normal text-muted-foreground">{formatInstant(version.createdAt)}</span>
				</Card.Title>
				<Card.Description class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
					<span>
						from
						<a class="underline underline-offset-4" href={rawHref}>
							raw version {rawVersion || "?"} of {rawVersions.length}
						</a>
					</span>
					<span>
						rules:
						<span class="font-mono">{version.ruleRevisionId ?? "none applied yet"}</span>
					</span>
					<span>commit: <span class="font-mono">{version.appCommit}</span></span>
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<JsonDiff before={previous?.data} after={version.data} />

				{#if version.fieldRules.length}
					<p class="text-xs text-muted-foreground">
						Set by:
						{#each version.fieldRules as fieldRule (fieldRule.field)}
							<span class="mr-3">
								<span class="font-mono">{fieldRule.field}</span>
								← {fieldRule.ruleName ?? fieldRule.ruleId}
							</span>
						{/each}
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/each}
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
