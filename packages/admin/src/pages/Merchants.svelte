<script lang="ts">
	import {
		deleteMerchant,
		detachMerchantName,
		loadMerchants,
		mergeMerchant,
		renameMerchant,
		restoreMerchant,
		type Merchant,
	} from "$lib/api";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { p } from "$lib/router";

	let merchants = $state<Merchant[]>([]);
	let names = $state<Record<string, string>>({});
	let filter = $state("");
	let busy = $state(false);
	let error = $state<string>();
	let notice = $state<string>();

	let mergeOpen = $state(false);
	let mergeSource = $state<Merchant>();
	let mergeFilter = $state("");

	const matches = (merchant: Merchant, text: string) => {
		const needle = text.trim().toLowerCase();

		return (
			merchant.name.toLowerCase().includes(needle) ||
			merchant.otherNames.some((other) => other.key.includes(needle))
		);
	};

	const active = $derived(
		merchants.filter((merchant) => !merchant.deletedAt && matches(merchant, filter)),
	);
	const deleted = $derived(
		merchants.filter((merchant) => merchant.deletedAt && matches(merchant, filter)),
	);
	const mergeTargets = $derived(
		merchants.filter(
			(merchant) =>
				!merchant.deletedAt && merchant.id !== mergeSource?.id && matches(merchant, mergeFilter),
		),
	);

	async function load() {
		try {
			merchants = await loadMerchants();
			names = Object.fromEntries(merchants.map((merchant) => [merchant.id, merchant.name]));
		} catch (e) {
			error = String(e);
		}
	}

	async function change(what: string, action: () => Promise<{ changedTransactions: number }>) {
		busy = true;
		error = undefined;
		notice = undefined;

		try {
			const { changedTransactions } = await action();
			notice = `${what}. Transactions changed: ${changedTransactions}`;
			await load();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	function startMerge(merchant: Merchant) {
		mergeSource = merchant;
		mergeFilter = "";
		mergeOpen = true;
	}

	async function mergeInto(target: Merchant) {
		const source = mergeSource;
		if (!source) return;

		mergeOpen = false;
		await change(`Merged "${source.name}" into "${target.name}"`, () =>
			mergeMerchant(source.id, target.id),
		);
	}

	void load();
</script>

<h1 class="text-xl font-semibold">Merchants</h1>
<p class="text-sm text-muted-foreground">
	The merchant that rules and defaults derive for a transaction is looked up here by name, ignoring
	case. Merging a merchant into another one makes its names stand for that merchant, for existing
	and future transactions. A deleted merchant leaves its transactions without a merchant until it is
	restored.
</p>

<Input class="max-w-xs" placeholder="Name" bind:value={filter} />

{#if error}
	<p class="text-sm text-destructive">{error}</p>
{/if}
{#if notice}
	<p class="text-sm text-muted-foreground">{notice}</p>
{/if}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Name</Table.Head>
			<Table.Head></Table.Head>
			<Table.Head class="text-right">Transactions</Table.Head>
			<Table.Head>Merged names</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each active as merchant (merchant.id)}
			<Table.Row>
				<Table.Cell><Input class="min-w-64" bind:value={names[merchant.id]} /></Table.Cell>
				<Table.Cell>
					<Button
						size="sm"
						disabled={busy || !names[merchant.id]?.trim() || names[merchant.id] === merchant.name}
						onclick={() =>
							change(`Renamed "${merchant.name}"`, () =>
								renameMerchant(merchant.id, names[merchant.id] ?? ""),
							)}
					>
						Rename
					</Button>
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums">
					<a
						class="underline-offset-4 hover:underline"
						href={p("/transactions", { search: { merchantId: merchant.id } })}
					>
						{merchant.transactionCount}
					</a>
				</Table.Cell>
				<Table.Cell>
					<span class="flex flex-wrap gap-1">
						{#each merchant.otherNames as other (other.key)}
							<Badge variant="secondary" class="h-6 pr-0.5">
								{other.name}
								<Button
									variant="ghost"
									size="xs"
									class="h-5 px-1.5"
									title="Make it a merchant of its own again"
									disabled={busy}
									onclick={() =>
										change(`Detached "${other.name}" from "${merchant.name}"`, () =>
											detachMerchantName(merchant.id, other.key),
										)}
								>
									Detach
								</Button>
							</Badge>
						{/each}
					</span>
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right">
					<Button variant="outline" size="sm" disabled={busy} onclick={() => startMerge(merchant)}>
						Merge into…
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => change(`Deleted "${merchant.name}"`, () => deleteMerchant(merchant.id))}
					>
						Delete
					</Button>
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell colspan={5} class="text-muted-foreground">No merchants</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>

{#if deleted.length}
	<h2 class="pt-4 text-lg font-semibold">Deleted</h2>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Merged names</Table.Head>
				<Table.Head>Deleted</Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each deleted as merchant (merchant.id)}
				<Table.Row>
					<Table.Cell class="font-medium">{merchant.name}</Table.Cell>
					<Table.Cell>
						<span class="flex flex-wrap gap-1">
							{#each merchant.otherNames as other (other.key)}
								<Badge variant="secondary">{other.name}</Badge>
							{/each}
						</span>
					</Table.Cell>
					<Table.Cell class="whitespace-nowrap">
						{merchant.deletedAt ? formatInstant(merchant.deletedAt) : ""}
					</Table.Cell>
					<Table.Cell class="text-right">
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onclick={() =>
								change(`Restored "${merchant.name}"`, () => restoreMerchant(merchant.id))}
						>
							Restore
						</Button>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}

<Dialog.Root bind:open={mergeOpen}>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Merge "{mergeSource?.name}" into…</Dialog.Title>
			<Dialog.Description>
				Only the merchant you pick is left. It takes over the transactions and the names of
				"{mergeSource?.name}", so future transactions with those names get it too.
			</Dialog.Description>
		</Dialog.Header>

		<Input placeholder="Name" bind:value={mergeFilter} />

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each mergeTargets as target (target.id)}
				<button
					class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
					onclick={() => mergeInto(target)}
				>
					<span class="font-medium">{target.name}</span>
					<span class="tabular-nums text-muted-foreground">{target.transactionCount}</span>
				</button>
			{:else}
				<p class="px-2 py-1.5 text-sm text-muted-foreground">No other merchants</p>
			{/each}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (mergeOpen = false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
