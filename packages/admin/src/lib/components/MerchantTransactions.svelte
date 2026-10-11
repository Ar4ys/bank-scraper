<script lang="ts">
	import { loadTransactions } from "$lib/api";
	import Pagination from "$lib/components/Pagination.svelte";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { navigate } from "$lib/router";

	let { merchantId }: { merchantId: string } = $props();

	const limit = 50;
	let offset = $state(0);

	const page = $derived(loadTransactions({ limit, offset, merchantId }));
</script>

{#await page}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then data}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Date</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head class="text-right">Amount</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.items as transaction (transaction.id)}
				<Table.Row
					class="cursor-pointer"
					onclick={() => navigate("/transactions/:id", { params: { id: transaction.id } })}
				>
					<Table.Cell class="whitespace-nowrap tabular-nums">{transaction.date}</Table.Cell>
					<Table.Cell class="max-w-md truncate" title={transaction.description}>
						{transaction.description}
					</Table.Cell>
					<Table.Cell
						class="whitespace-nowrap text-right tabular-nums {amountClass(transaction.amount)}"
					>
						{transaction.amount}
						{transaction.currency}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={3} class="text-muted-foreground">No transactions</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<Pagination bind:offset {limit} total={data.total} />
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
