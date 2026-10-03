<script lang="ts">
	import { loadAccounts, renameAccount, type Account } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Table from "$lib/components/ui/table";

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

	async function rename(account: Account) {
		try {
			await renameAccount(account.id, names[account.id] ?? account.name);
			await load();
		} catch (e) {
			error = String(e);
		}
	}

	void load();
</script>

<h1 class="text-xl font-semibold">Accounts</h1>

{#if error}
	<p class="text-sm text-destructive">{error}</p>
{/if}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Id</Table.Head>
			<Table.Head>Bank account</Table.Head>
			<Table.Head>Currency</Table.Head>
			<Table.Head>Name</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each accounts as account (account.id)}
			<Table.Row>
				<Table.Cell class="tabular-nums">{account.id}</Table.Cell>
				<Table.Cell class="font-mono text-xs">{account.sourceAccount}</Table.Cell>
				<Table.Cell>{account.currency ?? "—"}</Table.Cell>
				<Table.Cell><Input bind:value={names[account.id]} /></Table.Cell>
				<Table.Cell>
					<Button
						size="sm"
						disabled={!names[account.id]?.trim() || names[account.id] === account.name}
						onclick={() => rename(account)}
					>
						Rename
					</Button>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
