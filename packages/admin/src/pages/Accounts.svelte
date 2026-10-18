<script lang="ts">
	import { TransactionAmount, zTransactionAmount } from "@bank-scraper/shared";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { SvelteSet } from "svelte/reactivity";
	import { z } from "zod";

	import { loadAccounts, updateAccount, type Account } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { queryCount } from "$lib/queryState";

	const balanceSources = [
		{ value: "ledger", label: "Ledger (holds deducted)" },
		{ value: "balance", label: "Balance (holds not deducted)" },
	] as const;

	let accounts = $state<Account[]>([]);
	let error = $state<string>();
	let names = $state<Record<number, string>>({});

	// The dashboard links to `?account=<id>` to show that account opened
	const linkedAccount = queryCount("account").value;
	const opened = new SvelteSet<number>(linkedAccount ? [linkedAccount] : []);

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

	const toggle = (account: Account) =>
		opened.has(account.id) ? opened.delete(account.id) : opened.add(account.id);

	const money = (account: Account, amount: string | null) =>
		amount === null ? "—" : `${amount} ${account.balanceCurrency ?? ""}`;

	const reported = (account: Account) =>
		account.balanceSource === "ledger" ? account.ledger : account.balance;

	const amount = (text: string) => z.decode(zTransactionAmount, text);

	function holds(account: Account) {
		if (account.balance === null || account.ledger === null) return null;

		return z.encode(
			zTransactionAmount,
			TransactionAmount(amount(account.balance) - amount(account.ledger)),
		);
	}

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
			<Table.Head>Number</Table.Head>
			<Table.Head>Name</Table.Head>
			<Table.Head class="text-right">Reported balance</Table.Head>
			<Table.Head>Balance scraped</Table.Head>
			<Table.Head>Last Auto-Sync</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each accounts as account (account.id)}
			{@const isOpen = opened.has(account.id)}
			<Table.Row class="relative {isOpen ? 'border-b-0 bg-muted/50' : ''}">
				<Table.Cell class="font-mono text-xs">
					<button
						type="button"
						class="stretched-link inline-flex cursor-pointer items-center gap-1"
						aria-expanded={isOpen}
						aria-controls="account-{account.id}"
						onclick={() => toggle(account)}
					>
						<ChevronRight class="size-4 shrink-0 transition-transform {isOpen ? 'rotate-90' : ''}" />
						{account.number}
					</button>
				</Table.Cell>
				<Table.Cell>{account.name}</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right tabular-nums">
					{money(account, reported(account))}
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap">
					{account.balanceAt ? formatInstant(account.balanceAt) : "never"}
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap tabular-nums">{account.syncedThrough ?? "never"}</Table.Cell>
			</Table.Row>
			<Table.Row id="account-{account.id}" hidden={!isOpen} class="bg-muted/50 hover:bg-muted/50">
				<Table.Cell colspan={5} class="px-8 pt-0 pb-4">
					<div class="flex flex-wrap items-start gap-x-12 gap-y-4 rounded-lg border bg-background p-4">
						<dl class="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
							<dt class="text-muted-foreground">Id</dt>
							<dd class="tabular-nums">{account.id}</dd>
							<dt class="text-muted-foreground">Ledger</dt>
							<dd class="text-right tabular-nums">{money(account, account.ledger)}</dd>
							<dt class="text-muted-foreground">Balance</dt>
							<dd class="text-right tabular-nums">{money(account, account.balance)}</dd>
							<dt class="text-muted-foreground">Holds</dt>
							<dd class="text-right tabular-nums">{money(account, holds(account))}</dd>
						</dl>
						<dl class="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
							<dt class="text-muted-foreground">Transactions</dt>
							<dd class="text-right tabular-nums">{account.transactionCount}</dd>
							<dt class="text-muted-foreground">Raw transactions</dt>
							<dd class="text-right tabular-nums">{account.rawTransactionCount}</dd>
						</dl>
						<div class="grid gap-3 text-sm">
							<div class="grid gap-1">
								<label for="account-name-{account.id}" class="text-muted-foreground">Name</label>
								<span class="flex gap-2">
									<Input id="account-name-{account.id}" class="min-w-72" bind:value={names[account.id]} />
									<Button
										disabled={!names[account.id]?.trim() || names[account.id] === account.name}
										onclick={() => update(account, { name: names[account.id] })}
									>
										Rename
									</Button>
								</span>
							</div>
							<label class="grid gap-1">
								<span class="text-muted-foreground">Reported to Sure</span>
								<select
									class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
									value={account.balanceSource}
									onchange={(event) =>
										update(account, {
											balanceSource: balanceSources.find((source) => source.value === event.currentTarget.value)
												?.value,
										})}
								>
									{#each balanceSources as source (source.value)}
										<option value={source.value}>{source.label}</option>
									{/each}
								</select>
							</label>
						</div>
					</div>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
