<script lang="ts">
	import { loadDashboard } from "$lib/api";
	import ReprocessButton from "$lib/components/ReprocessButton.svelte";
	import * as Card from "$lib/components/ui/card";
	import { p } from "$lib/router";

	let dashboard = $state(loadDashboard());
	const reload = () => (dashboard = loadDashboard());
</script>

<div class="flex items-center justify-between">
	<h1 class="text-xl font-semibold">Dashboard</h1>
	<span class="flex gap-2">
		<ReprocessButton scope="failed" label="Reprocess failed" ondone={reload} />
		<ReprocessButton scope="all" label="Reprocess everything" ondone={reload} />
	</span>
</div>

{#await dashboard}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then data}
	{@const tiles = [
		{ label: "Transactions", value: data.transactions, href: p("/transactions") },
		{
			label: "Without merchant",
			value: data.transactionsWithoutMerchant,
			href: p("/transactions", { search: { withoutMerchant: true } }),
		},
		{ label: "Failed to process", value: data.rawByStatus.error ?? 0, href: p("/raw", { search: { status: "error" } }) },
		{ label: "Holds", value: data.rawByStatus.hold ?? 0, href: p("/raw", { search: { status: "hold" } }) },
		{
			label: "Unprocessed",
			value: data.rawByStatus.unprocessed ?? 0,
			href: p("/raw", { search: { status: "unprocessed" } }),
		},
	]}

	<div class="grid grid-cols-2 gap-4 md:grid-cols-5">
		{#each tiles as tile (tile.label)}
			<a href={tile.href}>
				<Card.Root class="hover:bg-muted/50">
					<Card.Header>
						<Card.Description>{tile.label}</Card.Description>
						<Card.Title class="text-2xl tabular-nums">{tile.value}</Card.Title>
					</Card.Header>
				</Card.Root>
			</a>
		{/each}
	</div>
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
