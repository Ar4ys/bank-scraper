<script lang="ts">
	import { loadAccounts, loadDashboard, loadRawTransactions } from "$lib/api";
	import InstallUserscriptButton from "$lib/components/InstallUserscriptButton.svelte";
	import ReprocessButton from "$lib/components/ReprocessButton.svelte";
	import * as Card from "$lib/components/ui/card";
	import { formatInstant } from "$lib/format";
	import { p } from "$lib/router";

	const load = async () => {
		const [dashboard, accounts, failures] = await Promise.all([
			loadDashboard(),
			loadAccounts(),
			loadRawTransactions({ limit: 5, offset: 0, status: "error" }),
		]);

		return { dashboard, accounts, failures };
	};

	let state = $state(load());
	const reload = () => (state = load());
</script>

<div class="flex items-center justify-between">
	<h1 class="text-xl font-semibold">Dashboard</h1>
	<span class="flex gap-2">
		<ReprocessButton scope="failed" label="Reprocess failed" ondone={reload} />
		<ReprocessButton scope="all" label="Reprocess everything" ondone={reload} />
	</span>
</div>

{#await state}
	<p class="text-sm text-muted-foreground">Loading…</p>
{:then { dashboard, accounts, failures }}
	{@const tiles = [
		{ label: "Transactions", value: dashboard.transactions, href: p("/transactions"), alert: false },
		{
			label: "Without merchant",
			value: dashboard.transactionsWithoutMerchant,
			href: p("/transactions", { search: { withoutMerchant: true } }),
			alert: false,
		},
		{
			label: "Failed to process",
			value: dashboard.rawByStatus.error ?? 0,
			href: p("/raw", { search: { status: "error" } }),
			alert: true,
		},
		{ label: "Holds", value: dashboard.rawByStatus.hold ?? 0, href: p("/raw", { search: { status: "hold" } }), alert: false },
		{
			label: "Unprocessed",
			value: dashboard.rawByStatus.unprocessed ?? 0,
			href: p("/raw", { search: { status: "unprocessed" } }),
			alert: true,
		},
	]}

	<div class="grid grid-cols-2 gap-4 md:grid-cols-5">
		{#each tiles as tile (tile.label)}
			<a href={tile.href}>
				<Card.Root class="hover:bg-muted/50">
					<Card.Header>
						<Card.Description>{tile.label}</Card.Description>
						<Card.Title class="text-2xl tabular-nums {tile.alert && tile.value > 0 ? 'text-destructive' : ''}">
							{tile.value}
						</Card.Title>
					</Card.Header>
				</Card.Root>
			</a>
		{/each}
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Accounts</Card.Title>
				<Card.Description>The balance is the one reported to Sure.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="divide-y text-sm">
					{#each accounts as account (account.id)}
						{@const reported = account.balanceSource === "ledger" ? account.ledger : account.balance}
						<li class="relative flex items-baseline justify-between gap-4 py-2 hover:bg-muted/50">
							<span>
								<a class="stretched-link" href={p("/accounts", { search: { account: account.id } })}>
									{account.name}
								</a>
								<span class="block text-xs text-muted-foreground">
									{account.balanceAt ? `balance scraped ${formatInstant(account.balanceAt)}` : "balance never scraped"}
								</span>
							</span>
							<span class="whitespace-nowrap tabular-nums">
								{reported === null ? "—" : `${reported} ${account.balanceCurrency ?? ""}`}
							</span>
						</li>
					{:else}
						<li class="py-2 text-muted-foreground">Nothing was scraped yet.</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Userscript</Card.Title>
				<Card.Description>Scrapes iPKO from the browser, in FireMonkey.</Card.Description>
				<Card.Action>
					<InstallUserscriptButton size="sm" />
				</Card.Action>
			</Card.Header>
			<Card.Content>
				<ol class="list-decimal space-y-1 pl-5 text-sm">
					<li>
						Press "Install userscript" and confirm in the tab FireMonkey opens. The URL of this server
						and the ingest key are filled in, and can be changed under User Variables of the script.
					</li>
					<li>
						For automatic updates, set "Auto-Update Interval" in the options of FireMonkey to a number
						of days. Otherwise the panel in iPKO says when to press Update on the script.
					</li>
					<li>
						After the ingest key changed, remove the script in FireMonkey and install it again from
						here: the install link contains a token derived from the key.
					</li>
				</ol>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Failed to process</Card.Title>
				<Card.Description>
					{#if failures.total > failures.items.length}
						The latest {failures.items.length} of {failures.total}.
					{:else}
						Bank transactions whose latest version could not be turned into a transaction.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="divide-y text-sm">
					{#each failures.items as raw (raw.id)}
						<li class="py-2">
							<a
								class="font-mono text-xs underline underline-offset-4"
								href={p("/raw/:accountId/:bankId", { params: { accountId: String(raw.accountId), bankId: raw.bankId } })}
							>
								{raw.bankId}
							</a>
							<span class="text-xs text-muted-foreground">{raw.error?.stage} error</span>
							<pre class="mt-1 whitespace-pre-wrap break-all text-xs text-destructive">{raw.error?.message}</pre>
						</li>
					{:else}
						<li class="py-2 text-muted-foreground">Everything was processed.</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	</div>
{:catch error}
	<p class="text-sm text-destructive">{String(error)}</p>
{/await}
