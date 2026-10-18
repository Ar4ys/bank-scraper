<script lang="ts">
	import { loadTransactions } from "$lib/api";
	import LoadingBar from "$lib/components/LoadingBar.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { latest } from "$lib/latest.svelte";
	import { p } from "$lib/router";

	let { merchantId }: { merchantId: string } = $props();

	const limit = 50;
	let offset = $state(0);

	const page = latest(() => loadTransactions({ limit, offset, merchantId }));
</script>

{#if page.error}
	<p class="text-sm text-destructive">{page.error}</p>
{/if}

<div>
	<LoadingBar loading={page.loading} />
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Date</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head class="text-right">Amount</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each page.value?.items ?? [] as transaction (transaction.id)}
				<Table.Row class="relative">
					<Table.Cell class="whitespace-nowrap tabular-nums">{transaction.date}</Table.Cell>
					<Table.Cell class="max-w-md truncate">
						<!-- A preview is looked at next to what it previews, so its rows open elsewhere -->
						<a
							class="stretched-link"
							href={p("/transactions/:id", { params: { id: transaction.id } })}
							target="_blank"
							rel="noopener"
							title="Open the transaction in a new tab"
						>
							{transaction.description}
						</a>
					</Table.Cell>
					<Table.Cell
						class="whitespace-nowrap text-right tabular-nums {amountClass(transaction.amount)}"
					>
						{transaction.amount}
						{transaction.currency}
					</Table.Cell>
				</Table.Row>
			{:else}
				{#if page.value}
					<Table.Row>
						<Table.Cell colspan={3} class="text-muted-foreground">No transactions</Table.Cell>
					</Table.Row>
				{/if}
			{/each}
		</Table.Body>
	</Table.Root>
</div>

<Pagination bind:offset {limit} total={page.value?.total ?? 0} />
