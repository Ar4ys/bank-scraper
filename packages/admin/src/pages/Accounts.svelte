<script lang="ts">
	import { loadAccounts, updateAccount, type Account } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";

	const balanceSources = [
		{ value: "ledger", label: "Ledger (holds deducted)" },
		{ value: "balance", label: "Balance (holds not deducted)" },
	] as const;

	let accounts = $state<Account[]>([]);
	let error = $state<string>();
	let names = $state<Record<number, string>>({});

	async function load() {
		try {
			accounts = await loadAccounts();
			names = Object.fromEntries(accounts.map((account) => [account.id, account.name]));
		} catch (e) {
			error = String(e);
		}
	}

	async function update(account: Account, changes: Parameters<typeof updateAccount>[1]) {
		try {
			await updateAccount(account.id, changes);
			error = undefined;
			await load();
		} catch (e) {
			error = String(e);
		}
	}

	const money = (account: Account, amount: string | null) =>
		amount === null ? "—" : `${amount} ${account.balanceCurrency ?? ""}`;

	void load();
</script>

<h1 class="text-xl font-semibold">Accounts</h1>
<p class="text-sm text-muted-foreground">
	The bank reports two amounts per account: its balance, and the ledger, which is the balance with
	holds deducted. "Reported to Sure" picks which of them the Lunch Flow API returns as the balance.
</p>

{#if error}
	<p class="text-sm text-destructive">{error}</p>
{/if}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Id</Table.Head>
			<Table.Head>Name</Table.Head>
			<Table.Head></Table.Head>
			<Table.Head class="text-right">Ledger</Table.Head>
			<Table.Head class="text-right">Balance</Table.Head>
			<Table.Head>Reported to Sure</Table.Head>
			<Table.Head>Scraped</Table.Head>
			<Table.Head>Bank's id</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each accounts as account (account.id)}
			<Table.Row>
				<Table.Cell class="tabular-nums">{account.id}</Table.Cell>
				<Table.Cell><Input class="min-w-72" bind:value={names[account.id]} /></Table.Cell>
				<Table.Cell>
					<Button
						size="sm"
						disabled={!names[account.id]?.trim() || names[account.id] === account.name}
						onclick={() => update(account, { name: names[account.id] })}
					>
						Rename
					</Button>
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right tabular-nums">{money(account, account.ledger)}</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right tabular-nums">{money(account, account.balance)}</Table.Cell>
				<Table.Cell>
					<select
						class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
						value={account.balanceSource}
						onchange={(event) =>
							update(account, {
								balanceSource: balanceSources.find((source) => source.value === event.currentTarget.value)?.value,
							})}
					>
						{#each balanceSources as source (source.value)}
							<option value={source.value}>{source.label}</option>
						{/each}
					</select>
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap">
					{account.balanceAt ? formatInstant(account.balanceAt) : "never"}
				</Table.Cell>
				<Table.Cell class="max-w-40 truncate font-mono text-xs" title={account.sourceAccount}>
					{account.sourceAccount}
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
