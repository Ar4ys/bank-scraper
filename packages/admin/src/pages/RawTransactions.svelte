<script lang="ts">
	import { searchParams } from "sv-router";

	import { loadAccounts, loadRawTransactions, type Account } from "$lib/api";
	import AccountSelect from "$lib/components/AccountSelect.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { p } from "$lib/router";

	const limit = 100;
	const statuses = ["unprocessed", "processed", "hold", "error"] as const;
	type Status = (typeof statuses)[number];

	const initialStatus = statuses.find((status) => status === searchParams.get("status"));

	let accounts = $state<Account[]>([]);
	let accountId = $state("");
	let status = $state<Status | "">(initialStatus ?? "");
	let offset = $state(0);

	const page = $derived(loadRawTransactions({ limit, offset, accountId, status: status || undefined }));

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;
	const titleOf = (data: Record<string, unknown>) => (typeof data.title === "string" ? data.title : "");

	void loadAccounts().then((loaded) => (accounts = loaded));
</script>

<h1 class="text-xl font-semibold">Raw transactions</h1>
<p class="text-sm text-muted-foreground">
	One row per bank transaction, showing its latest version as scraped from the bank.
</p>

<div class="flex flex-wrap items-center gap-4">
	<AccountSelect bind:value={accountId} {accounts} />
	<select
		bind:value={status}
		onchange={() => (offset = 0)}
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
				<Table.Head>Account</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Versions</Table.Head>
				<Table.Head>Title</Table.Head>
				<Table.Head>Scraped</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.items as raw (raw.id)}
				<Table.Row>
					<Table.Cell class="font-mono text-xs">
						<a
							class="underline-offset-4 hover:underline"
							href={p("/raw/:accountId/:bankId", {
								params: { accountId: String(raw.accountId), bankId: raw.bankId },
							})}
						>
							{raw.bankId}
						</a>
					</Table.Cell>
					<Table.Cell>{accountName(raw.accountId)}</Table.Cell>
					<Table.Cell><StatusBadge status={raw.status} /></Table.Cell>
					<Table.Cell class="tabular-nums">{raw.versionCount}</Table.Cell>
					<Table.Cell class="max-w-md truncate">{titleOf(raw.data)}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{formatInstant(raw.createdAt)}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<Pagination bind:offset {limit} total={data.total} />
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
