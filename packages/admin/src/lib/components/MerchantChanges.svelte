<script lang="ts">
	import type { MerchantChangeReport } from "$lib/api";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { p } from "$lib/router";

	let { report }: { report: MerchantChangeReport } = $props();

	// A preview is looked at next to what it previews, so its rows open elsewhere
	const openTransaction = (id: string) =>
		window.open(p("/transactions/:id", { params: { id } }), "_blank", "noopener");
</script>

{#snippet merchant(name: string | null | undefined)}
	{#if name}
		<span class="font-medium">{name}</span>
	{:else}
		<span class="text-muted-foreground">no merchant</span>
	{/if}
{/snippet}

<p class="text-sm">
	<span class="font-medium">{report.changes.length} transaction(s) would change</span>,
	{report.unchanged} stay the same.
</p>

{#if report.changes.length}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Date</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head class="text-right">Amount</Table.Head>
				<Table.Head>Merchant before</Table.Head>
				<Table.Head>Merchant after</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each report.changes as change (change.rawTransactionId)}
				{@const transactionId = change.transactionId}
				<Table.Row
					class={transactionId ? "cursor-pointer" : ""}
					title={transactionId ? "Open the transaction in a new tab" : undefined}
					onclick={() => transactionId && openTransaction(transactionId)}
				>
					<Table.Cell class="whitespace-nowrap tabular-nums">{change.after.date}</Table.Cell>
					<Table.Cell class="max-w-64 truncate" title={change.after.description}>
						{change.after.description}
						{#if change.cause !== "merchants"}
							<span class="block text-xs text-muted-foreground">Other fields change too</span>
						{/if}
					</Table.Cell>
					<Table.Cell
						class="whitespace-nowrap text-right tabular-nums {amountClass(change.after.amount)}"
					>
						{change.after.amount}
						{change.after.currency}
					</Table.Cell>
					<Table.Cell class="max-w-48 truncate">{@render merchant(change.before?.merchant)}</Table.Cell>
					<Table.Cell class="max-w-48 truncate">{@render merchant(change.after.merchant)}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
