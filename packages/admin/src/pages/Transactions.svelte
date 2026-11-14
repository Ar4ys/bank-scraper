<script lang="ts">
	import { loadAccounts, loadTransactions, type Account } from "$lib/api";
	import AccountSelect from "$lib/components/AccountSelect.svelte";
	import LoadingBar from "$lib/components/LoadingBar.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { latest } from "$lib/latest.svelte";
	import { queryCount, queryFlag, queryText } from "$lib/queryState";
	import { p } from "$lib/router";

	const limit = 100;

	let accounts = $state<Account[]>([]);
	const accountId = queryText("accountId");
	const search = queryText("search");
	const withoutMerchant = queryFlag("withoutMerchant");
	const merchantId = queryText("merchantId");
	const merchantMapEntryId = queryText("merchantMapEntryId");
	const offset = queryCount("offset");

	const page = latest(() =>
		loadTransactions({
			limit,
			offset: offset.value,
			accountId: accountId.value,
			search: search.value,
			merchantId: merchantId.value,
			merchantMapEntryId: merchantMapEntryId.value,
			withoutMerchant: withoutMerchant.value || undefined,
		}),
	);

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;

	void loadAccounts().then((loaded) => (accounts = loaded));
</script>

<h1 class="text-xl font-semibold">Transactions</h1>

<div class="flex flex-wrap items-center gap-4">
	<Input
		class="max-w-xs"
		placeholder="Merchant, description or bank id"
		bind:value={search.value}
		oninput={() => (offset.value = 0)}
	/>
	<AccountSelect bind:value={accountId.value} {accounts} onchange={() => (offset.value = 0)} />
	<span class="flex items-center gap-2">
		<Switch
			id="without-merchant"
			bind:checked={withoutMerchant.value}
			onCheckedChange={() => (offset.value = 0)}
		/>
		<Label for="without-merchant" class="cursor-pointer">Without merchant</Label>
	</span>
	{#if merchantId.value}
		<Button
			variant="outline"
			size="sm"
			onclick={() => {
				merchantId.value = "";
				offset.value = 0;
			}}
		>
			Of one merchant ✕
		</Button>
	{/if}
	{#if merchantMapEntryId.value}
		<Button
			variant="outline"
			size="sm"
			onclick={() => {
				merchantMapEntryId.value = "";
				offset.value = 0;
			}}
		>
			Of one map entry ✕
		</Button>
	{/if}
</div>

{#if page.error}
	<p class="text-sm text-destructive">{page.error}</p>
{/if}

<div>
	<LoadingBar loading={page.loading} />
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
			{#each page.value?.items ?? [] as transaction (transaction.id)}
				<Table.Row class="relative">
					<Table.Cell class="whitespace-nowrap tabular-nums">{transaction.date}</Table.Cell>
					<Table.Cell class="max-w-48 truncate text-muted-foreground">
						{accountName(transaction.accountId)}
					</Table.Cell>
					<Table.Cell class="max-w-56 truncate font-medium">
						<a class="stretched-link" href={p("/transactions/:id", { params: { id: transaction.id } })}>
							{#if transaction.merchant}
								{transaction.merchant}
							{:else}
								<span class="font-normal text-muted-foreground">no merchant</span>
							{/if}
						</a>
					</Table.Cell>
					<Table.Cell class="max-w-md truncate" title={transaction.description}>
						{transaction.description}
					</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-right tabular-nums {amountClass(transaction.amount)}">
						{transaction.amount}
						{transaction.currency}
					</Table.Cell>
				</Table.Row>
			{:else}
				{#if page.value}
					<Table.Row>
						<Table.Cell colspan={5} class="text-muted-foreground">No transactions</Table.Cell>
					</Table.Row>
				{/if}
			{/each}
		</Table.Body>
	</Table.Root>
</div>

<Pagination bind:offset={offset.value} {limit} total={page.value?.total ?? 0} />
