<script lang="ts">
	import { loadRawTransaction } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";
	import JsonView from "$lib/components/JsonView.svelte";
	import ReprocessButton from "$lib/components/ReprocessButton.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import * as Card from "$lib/components/ui/card";
	import * as Tabs from "$lib/components/ui/tabs";
	import { formatInstant } from "$lib/format";
	import { p, route } from "$lib/router";

	const accountId = $derived(route.params.accountId ?? "");
	const bankId = $derived(route.params.bankId ?? "");

	// Bumped to load again after a reprocess
	let reloads = $state(0);
	const load = (account: string, bank: string, _reloads: number) => loadRawTransaction(account, bank);
	const detail = $derived(load(accountId, bankId, reloads));
</script>

<div class="flex items-center justify-between">
	<h1 class="text-xl font-semibold">Raw transaction <span class="font-mono text-base">{bankId}</span></h1>
	<ReprocessButton scope={{ accountId: Number(accountId), bankId }} label="Reprocess" ondone={() => reloads++} />
</div>

{#await detail}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then { versions, transactionId, parsed }}
	<p class="text-sm">
		{#if transactionId}
			<a class="underline underline-offset-4" href={p("/transactions/:id", { params: { id: transactionId } })}>
				Parsed as transaction {transactionId}
			</a>
		{:else}
			<span class="text-muted-foreground">Not parsed into a transaction.</span>
		{/if}
		{#if parsed}
			·
			<a class="underline underline-offset-4" href={p("/rules", { search: { accountId, bankId } })}>
				Try rules on it
			</a>
		{/if}
	</p>

	<!-- Newest first, each version diffed against the one before it -->
	{#each versions.toReversed() as version, index (version.id)}
		{@const previous = versions[versions.length - index - 2]}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					Version {versions.length - index} of {versions.length}
					<StatusBadge status={version.status} />
					<span class="text-sm font-normal text-muted-foreground">
						scraped {formatInstant(version.createdAt)}
					</span>
				</Card.Title>
				<Card.Description class="font-mono text-xs">{version.id}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if version.error}
					<pre class="whitespace-pre-wrap rounded bg-destructive/10 p-2 text-xs">{version.error.stage} error
{version.error.message}</pre>
				{/if}

				<Tabs.Root value={previous ? "diff" : "json"}>
					<Tabs.List>
						<Tabs.Trigger value="diff" disabled={!previous}>Changes</Tabs.Trigger>
						<Tabs.Trigger value="json">JSON</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="diff">
						{#if previous}
							<JsonDiff before={previous.data} after={version.data} />
						{/if}
					</Tabs.Content>
					<Tabs.Content value="json">
						<JsonView value={version.data} />
					</Tabs.Content>
				</Tabs.Root>
			</Card.Content>
		</Card.Root>
	{/each}
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
