<script lang="ts">
	import { loadTransaction } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";
	import ReprocessButton from "$lib/components/ReprocessButton.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import * as Card from "$lib/components/ui/card";
	import { formatInstant } from "$lib/format";
	import { p, route } from "$lib/router";

	// Bumped to load again after a reprocess
	let reloads = $state(0);
	const load = (id: string, _reloads: number) => loadTransaction(id);
	const detail = $derived(load(route.params.id ?? "", reloads));
</script>

{#await detail}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then { transaction, versions }}
	{@const rawHref = p("/raw/:accountId/:bankId", {
		params: { accountId: String(transaction.accountId), bankId: transaction.bankId },
	})}

	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold">{transaction.merchant ?? "No merchant"}</h1>
		<ReprocessButton
			scope={{ accountId: transaction.accountId, bankId: transaction.bankId }}
			label="Reprocess"
			ondone={() => reloads++}
		/>
	</div>

	<dl class="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
		<dt class="text-muted-foreground">Id</dt>
		<dd class="font-mono text-xs">{transaction.id}</dd>
		<dt class="text-muted-foreground">Bank id</dt>
		<dd class="font-mono text-xs">
			<a class="underline underline-offset-4" href={rawHref}>{transaction.bankId}</a>
		</dd>
		<dt class="text-muted-foreground">Date</dt>
		<dd>{transaction.date}</dd>
		<dt class="text-muted-foreground">Amount</dt>
		<dd class="tabular-nums">{transaction.amount} {transaction.currency}</dd>
		<dt class="text-muted-foreground">Description</dt>
		<dd>{transaction.description}</dd>
	</dl>

	<h2 class="pt-4 text-lg font-semibold">History</h2>

	<!-- Newest first, each version diffed against the one before it -->
	{#each versions.toReversed() as version, index (version.id)}
		{@const previous = versions[versions.length - index - 2]}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<StatusBadge status={version.cause} />
					{formatInstant(version.createdAt)}
				</Card.Title>
				<Card.Description class="space-x-3 font-mono text-xs">
					<a class="underline underline-offset-4" href={rawHref}>raw {version.rawTransactionId}</a>
					<span>rules {version.ruleRevisionId ?? "none"}</span>
					<span>commit {version.appCommit}</span>
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<JsonDiff before={previous?.data ?? null} after={version.data} />

				{@const ruled = Object.entries(version.fieldSources).filter(([, source]) => source !== "default")}
				{#if ruled.length}
					<p class="text-xs text-muted-foreground">
						Set by rules:
						{#each ruled as [field, source] (field)}
							<span class="mr-2 font-mono">{field} ← {source}</span>
						{/each}
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/each}
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
