<script lang="ts">
	import { searchParams } from "sv-router";

	import { loadAccounts, loadTransactions, type Account } from "$lib/api";
	import AccountSelect from "$lib/components/AccountSelect.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { p } from "$lib/router";

	const limit = 100;

	let accounts = $state<Account[]>([]);
	let accountId = $state("");
	let search = $state("");
	let withoutMerchant = $state(searchParams.get("withoutMerchant") === true);
	let offset = $state(0);

	const page = $derived(
		loadTransactions({ limit, offset, accountId, search, withoutMerchant: withoutMerchant || undefined }),
	);

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;

	void loadAccounts().then((loaded) => (accounts = loaded));
</script>

<h1 class="text-xl font-semibold">Transactions</h1>

<div class="flex flex-wrap items-center gap-4">
	<Input
		class="max-w-xs"
		placeholder="Merchant, description or bank id"
		bind:value={search}
		oninput={() => (offset = 0)}
	/>
	<AccountSelect bind:value={accountId} {accounts} />
	<span class="flex items-center gap-2">
		<Switch id="without-merchant" bind:checked={withoutMerchant} onCheckedChange={() => (offset = 0)} />
		<Label for="without-merchant">Without merchant</Label>
	</span>
</div>

{#await page}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then data}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Date</Table.Head>
				<Table.Head>Account</Table.Head>
				<Table.Head>Merchant</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head class="text-right">Amount</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.items as transaction (transaction.id)}
				<Table.Row>
					<Table.Cell class="whitespace-nowrap tabular-nums">
						<a class="underline-offset-4 hover:underline" href={p("/transactions/:id", { params: { id: transaction.id } })}>
							{transaction.date}
						</a>
					</Table.Cell>
					<Table.Cell>{accountName(transaction.accountId)}</Table.Cell>
					<Table.Cell>
						{#if transaction.merchant}
							{transaction.merchant}
						{:else}
							<span class="text-muted-foreground">none</span>
						{/if}
					</Table.Cell>
					<Table.Cell class="max-w-md truncate">{transaction.description}</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-right tabular-nums">
						{transaction.amount}
						{transaction.currency}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<Pagination bind:offset {limit} total={data.total} />
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
