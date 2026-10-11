<script lang="ts">
	import {
		deleteMerchant,
		detachMerchantName,
		loadMerchants,
		mergeMerchant,
		removeMerchantPermanently,
		renameMerchant,
		restoreMerchant,
		type Merchant,
		type MerchantChangeReport,
	} from "$lib/api";
	import MerchantChanges from "$lib/components/MerchantChanges.svelte";
	import MerchantTransactions from "$lib/components/MerchantTransactions.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { p } from "$lib/router";

	/** A change of merchants that is shown as a preview first and written only when applied */
	type Proposal = {
		title: string;
		description: string;
		/** It takes something away that applying another change does not bring back as it was */
		destructive?: boolean;
		run: (dryRun: boolean) => Promise<MerchantChangeReport>;
	};

	let merchants = $state<Merchant[]>([]);
	let names = $state<Record<string, string>>({});
	let filter = $state("");
	let showDeleted = $state(false);
	let busy = $state(false);
	let error = $state<string>();
	let notice = $state<string>();

	let proposal = $state<Proposal>();
	let preview = $state<MerchantChangeReport>();
	let previewOpen = $state(false);
	let previewError = $state<string>();

	let mergeOpen = $state(false);
	let mergeSource = $state<Merchant>();
	let mergeFilter = $state("");

	let transactionsOpen = $state(false);
	let transactionsOf = $state<Merchant>();

	type SortKey = "name" | "transactionCount";
	let sort = $state<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });

	function sortBy(key: SortKey) {
		sort =
			sort.key === key
				? { key, descending: !sort.descending }
				: // Counts are looked at from the largest, names from A
					{ key, descending: key === "transactionCount" };
	}

	const matches = (merchant: Merchant, text: string) => {
		const needle = text.trim().toLowerCase();

		return (
			merchant.name.toLowerCase().includes(needle) ||
			merchant.otherNames.some((other) => other.key.includes(needle))
		);
	};

	const active = $derived(
		merchants
			.filter((merchant) => !merchant.deletedAt && matches(merchant, filter))
			.toSorted((a, b) => {
				const byName = a.name.localeCompare(b.name);
				const order = sort.key === "name" ? byName : a.transactionCount - b.transactionCount;

				return (sort.descending ? -order : order) || byName;
			}),
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

	async function propose(proposed: Proposal) {
		busy = true;
		error = undefined;
		notice = undefined;
		previewError = undefined;

		try {
			preview = await proposed.run(true);
			proposal = proposed;
			previewOpen = true;
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!proposal) return;

		busy = true;
		previewError = undefined;

		try {
			const report = await proposal.run(false);
			notice = `${proposal.title}. Transactions changed: ${report.changes.length}`;
			previewOpen = false;
			await load();
		} catch (e) {
			previewError = String(e);
		} finally {
			busy = false;
		}
	}

	const rename = (merchant: Merchant) => {
		const name = (names[merchant.id] ?? "").trim();

		return propose({
			title: `Rename "${merchant.name}" to "${name}"`,
			description: `Its transactions get the new name. "${merchant.name}" stays a name of the merchant, so whatever still derives it ends up here.`,
			run: (dryRun) => renameMerchant(merchant.id, name, dryRun),
		});
	};

	const detach = (merchant: Merchant, other: Merchant["otherNames"][number]) =>
		propose({
			title: `Detach "${other.name}" from "${merchant.name}"`,
			description: `"${other.name}" becomes a merchant of its own again and takes the transactions that derive that name.`,
			run: (dryRun) => detachMerchantName(merchant.id, other.key, dryRun),
		});

	const remove = (merchant: Merchant) =>
		propose({
			title: `Delete "${merchant.name}"`,
			description:
				"These transactions lose their merchant, and so do later ones with its names, until the merchant is restored.",
			destructive: true,
			run: (dryRun) => deleteMerchant(merchant.id, dryRun),
		});

	const removePermanently = (merchant: Merchant) =>
		propose({
			title: `Permanently remove "${merchant.name}"`,
			description:
				"The merchant and its names are removed for good and cannot be restored. A transaction that still derives one of its names gets a new merchant with that name.",
			destructive: true,
			run: (dryRun) => removeMerchantPermanently(merchant.id, dryRun),
		});

	const restore = (merchant: Merchant) =>
		propose({
			title: `Restore "${merchant.name}"`,
			description: "The transactions that derive its names get the merchant back.",
			run: (dryRun) => restoreMerchant(merchant.id, dryRun),
		});

	function startMerge(merchant: Merchant) {
		mergeSource = merchant;
		mergeFilter = "";
		mergeOpen = true;
	}

	async function mergeInto(target: Merchant) {
		const source = mergeSource;
		if (!source) return;

		mergeOpen = false;
		await propose({
			title: `Merge "${source.name}" into "${target.name}"`,
			description: `Only "${target.name}" is left. It takes over the transactions and the names of "${source.name}", so later transactions with those names get it too.`,
			run: (dryRun) => mergeMerchant(source.id, target.id, dryRun),
		});
	}

	function viewTransactions(merchant: Merchant) {
		transactionsOf = merchant;
		transactionsOpen = true;
	}

	void load();
</script>

<h1 class="text-xl font-semibold">Merchants</h1>
<p class="text-sm text-muted-foreground">
	The merchant that rules and defaults derive for a transaction is looked up here by name, ignoring
	case. Merging a merchant into another one makes its names stand for that merchant, for existing
	and future transactions. A deleted merchant leaves its transactions without a merchant until it is
	restored. Every change shows the transactions it affects before it is applied.
</p>

<div class="flex flex-wrap items-center gap-4">
	<Input class="max-w-xs" placeholder="Name" bind:value={filter} />
	<span class="flex items-center gap-2">
		<Switch id="show-deleted" bind:checked={showDeleted} />
		<Label for="show-deleted">
			Show deleted ({merchants.filter((merchant) => merchant.deletedAt).length})
		</Label>
	</span>
</div>

{#if error}
	<p class="text-sm text-destructive">{error}</p>
{/if}
{#if notice}
	<p class="text-sm text-muted-foreground">{notice}</p>
{/if}

{#snippet sortButton(key: SortKey, label: string)}
	<button
		class="inline-flex cursor-pointer items-center gap-1 hover:underline"
		title="Sort by this column"
		onclick={() => sortBy(key)}
	>
		{label}
		<span class="w-3 text-muted-foreground">
			{sort.key === key ? (sort.descending ? "↓" : "↑") : "↕"}
		</span>
	</button>
{/snippet}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>{@render sortButton("name", "Name")}</Table.Head>
			<Table.Head></Table.Head>
			<Table.Head class="text-right">
				{@render sortButton("transactionCount", "Transactions")}
			</Table.Head>
			<Table.Head>Merged names</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each active as merchant (merchant.id)}
			<Table.Row>
				<Table.Cell><Input class="min-w-56" bind:value={names[merchant.id]} /></Table.Cell>
				<Table.Cell>
					<Button
						size="sm"
						disabled={busy || !names[merchant.id]?.trim() || names[merchant.id] === merchant.name}
						onclick={() => rename(merchant)}
					>
						Rename
					</Button>
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums">{merchant.transactionCount}</Table.Cell>
				<Table.Cell>
					<span class="flex flex-wrap gap-1.5">
						{#each merchant.otherNames as other (other.key)}
							<span class="inline-flex items-center gap-1.5 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium">
								{other.name}
								<Button
									variant="outline"
									size="xs"
									class="cursor-pointer"
									title="Make it a merchant of its own again"
									disabled={busy}
									onclick={() => detach(merchant, other)}
								>
									Detach
								</Button>
							</span>
						{/each}
					</span>
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right">
					<Button variant="outline" size="sm" onclick={() => viewTransactions(merchant)}>
						View transactions
					</Button>
					<Button variant="outline" size="sm" disabled={busy} onclick={() => startMerge(merchant)}>
						Merge into…
					</Button>
					<Button variant="destructive" size="sm" disabled={busy} onclick={() => remove(merchant)}>
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

{#if showDeleted}
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
					<Table.Cell class="whitespace-nowrap text-right">
						<Button variant="outline" size="sm" disabled={busy} onclick={() => restore(merchant)}>
							Restore
						</Button>
						<Button
							variant="destructive"
							size="sm"
							disabled={busy}
							onclick={() => removePermanently(merchant)}
						>
							Permanently remove
						</Button>
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={4} class="text-muted-foreground">No deleted merchants</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-4xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{proposal?.title}</Dialog.Title>
			<Dialog.Description>
				{proposal?.description} This is a preview. Nothing is written until you apply it.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
			{#if previewError}
				<p class="text-sm text-destructive">{previewError}</p>
			{/if}
			{#if preview}
				<MerchantChanges report={preview} />
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (previewOpen = false)}>Cancel</Button>
			<Button
				variant={proposal?.destructive ? "destructive" : "default"}
				disabled={busy}
				onclick={apply}
			>
				Apply
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={mergeOpen}>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Merge "{mergeSource?.name}" into…</Dialog.Title>
			<Dialog.Description>
				Pick the merchant that is left. You see the affected transactions before anything is written.
			</Dialog.Description>
		</Dialog.Header>

		<Input placeholder="Name" bind:value={mergeFilter} />

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each mergeTargets as target (target.id)}
				<button
					class="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
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

<Dialog.Root bind:open={transactionsOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-3xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>Transactions of "{transactionsOf?.name}"</Dialog.Title>
			<Dialog.Description>
				{#if transactionsOf}
					<a
						class="underline underline-offset-4"
						href={p("/transactions", { search: { merchantId: transactionsOf.id } })}
					>
						Open in Transactions
					</a>
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
			{#if transactionsOf}
				{#key transactionsOf.id}
					<MerchantTransactions merchantId={transactionsOf.id} />
				{/key}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
