<script lang="ts">
	import { loadAccounts, loadRawTransactions, type Account } from "$lib/api";
	import AccountSelect from "$lib/components/AccountSelect.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { queryCount, queryOption, queryText } from "$lib/queryState";
	import { navigate } from "$lib/router";

	const limit = 100;
	const statuses = ["unprocessed", "processed", "hold", "error"] as const;

	let accounts = $state<Account[]>([]);
	const accountId = queryText("accountId");
	const status = queryOption("status", ["", ...statuses], "");
	const offset = queryCount("offset");

	const page = $derived(
		loadRawTransactions({
			limit,
			offset: offset.value,
			accountId: accountId.value,
			status: status.value || undefined,
		}),
	);

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;
	// Raw data has whatever shape the bank sent, so everything read from it is checked
	const textAt = (data: unknown, ...path: string[]) => {
		let value = data;
		for (const key of path) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
		}
		return typeof value === "string" ? value : "";
	};

	void loadAccounts().then((loaded) => (accounts = loaded));
</script>

<h1 class="text-xl font-semibold">Raw transactions</h1>
<p class="text-sm text-muted-foreground">
	One row per bank transaction, showing its latest version as scraped from the bank.
</p>

<div class="flex flex-wrap items-center gap-4">
	<AccountSelect bind:value={accountId.value} {accounts} onchange={() => (offset.value = 0)} />
	<select
		bind:value={status.value}
		onchange={() => (offset.value = 0)}
		class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
	>
		<option value="">All statuses</option>
		{#each statuses as option (option)}
			<option value={option}>{option}</option>
		{/each}
	</select>
</div>

{#await page}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then data}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Bank id</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Versions</Table.Head>
				<Table.Head>Bank's title</Table.Head>
				<Table.Head class="text-right">Amount</Table.Head>
				<Table.Head>Account</Table.Head>
				<Table.Head>Scraped</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.items as raw (raw.id)}
				<Table.Row
					class="cursor-pointer"
					onclick={() =>
						navigate("/raw/:accountId/:bankId", {
							params: { accountId: String(raw.accountId), bankId: raw.bankId },
						})}
				>
					<Table.Cell class="font-mono text-xs">{raw.bankId}</Table.Cell>
					<Table.Cell><StatusBadge status={raw.status} /></Table.Cell>
					<Table.Cell class="tabular-nums">
						{#if raw.versionCount > 1}
							<span class="font-medium">{raw.versionCount}</span>
						{:else}
							<span class="text-muted-foreground">1</span>
						{/if}
					</Table.Cell>
					<Table.Cell class="max-w-md truncate">
						{textAt(raw.data, "title")}
						<span class="text-muted-foreground">{textAt(raw.data, "details", "title")}</span>
						{#if raw.error}
							<div class="truncate text-xs text-destructive">{raw.error.message.split("\n")[0]}</div>
						{/if}
					</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-right tabular-nums">
						{textAt(raw.data, "money", "amount")}
						{textAt(raw.data, "money", "currency")}
					</Table.Cell>
					<Table.Cell class="max-w-48 truncate text-muted-foreground">{accountName(raw.accountId)}</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-muted-foreground">{formatInstant(raw.createdAt)}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<Pagination bind:offset={offset.value} {limit} total={data.total} />
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
