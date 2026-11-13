<script lang="ts">
	import {
		deleteMerchant,
		detachMerchantName,
		dismissMerchantPair,
		loadMerchants,
		loadMerchantSuggestions,
		mergeMerchant,
		removeMerchantPermanently,
		renameMerchant,
		restoreMerchant,
		reviewMerchant,
		type Merchant,
		type MerchantChangeReport,
		type MerchantSuggestions,
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
	import { queryFlag, queryOption, queryText } from "$lib/queryState";
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
	let suggestions = $state<MerchantSuggestions>({});
	let names = $state<Record<string, string>>({});
	const filter = queryText("search");
	const showDeleted = queryFlag("showDeleted");
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

	/** The two merchants of a suggestion being merged, in a fixed order, and which of them stays */
	let pairMerge = $state<{ merchants: [Merchant, Merchant]; staysId: string }>();
	let pairMergeOpen = $state(false);

	let transactionsOpen = $state(false);
	let transactionsOf = $state<Merchant>();

	const sortKeys = ["name", "transactionCount"] as const;
	type SortKey = (typeof sortKeys)[number];
	const sortKey = queryOption("sort", sortKeys, "name");
	const sortDescending = queryFlag("descending");

	function sortBy(key: SortKey) {
		if (sortKey.value === key) {
			sortDescending.value = !sortDescending.value;
		} else {
			sortKey.value = key;
			// Counts are looked at from the largest, names from A
			sortDescending.value = key === "transactionCount";
		}
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
			.filter((merchant) => !merchant.deletedAt && matches(merchant, filter.value))
			.toSorted((a, b) => {
				const byName = a.name.localeCompare(b.name);
				const order = sortKey.value === "name" ? byName : a.transactionCount - b.transactionCount;

				return (sortDescending.value ? -order : order) || byName;
			}),
	);
	const merchantById = $derived(new Map(merchants.map((merchant) => [merchant.id, merchant])));

	/** Merchants waiting to be reviewed, those with the most transactions first */
	const toReview = $derived(
		merchants
			.filter((merchant) => !merchant.deletedAt && !merchant.reviewedAt)
			.toSorted((a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name)),
	);

	const suggestionsOf = (merchant: Merchant) =>
		(suggestions[merchant.id] ?? []).flatMap((suggestion) => {
			const other = merchantById.get(suggestion.merchantId);
			return other ? [other] : [];
		});

	const deleted = $derived(
		merchants.filter((merchant) => merchant.deletedAt && matches(merchant, filter.value)),
	);
	const mergeTargets = $derived(
		merchants.filter(
			(merchant) =>
				!merchant.deletedAt && merchant.id !== mergeSource?.id && matches(merchant, mergeFilter),
		),
	);

	async function load() {
		try {
			[merchants, suggestions] = await Promise.all([loadMerchants(), loadMerchantSuggestions()]);
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

	/** Opens the merge of a suggested pair, keeping the merchant with more transactions */
	function startPairMerge(merchant: Merchant, other: Merchant) {
		pairMerge = {
			merchants: [merchant, other],
			staysId: other.transactionCount > merchant.transactionCount ? other.id : merchant.id,
		};
		pairMergeOpen = true;
	}

	async function previewPairMerge() {
		const pair = pairMerge;
		if (!pair) return;

		const [first, second] = pair.merchants;
		const [stays, goes] = first.id === pair.staysId ? [first, second] : [second, first];

		pairMergeOpen = false;
		mergeSource = goes;
		await mergeInto(stays);
	}

	async function act(action: () => Promise<unknown>) {
		busy = true;
		error = undefined;
		notice = undefined;

		try {
			await action();
			await load();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	const markReviewed = (merchant: Merchant) => act(() => reviewMerchant(merchant.id));

	const dismiss = (merchant: Merchant, other: Merchant) =>
		act(() => dismissMerchantPair(merchant.id, other.id));

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
	restored. Every change shows the transactions it affects before it is applied. New merchants wait
	in "To review" until they are confirmed, renamed or have another merchant merged into them, and
	merchants with alike names are suggested as possible duplicates.
</p>

<div class="flex flex-wrap items-center gap-4">
	<Input class="max-w-xs" placeholder="Name" bind:value={filter.value} />
	<span class="flex items-center gap-2">
		<Switch id="show-deleted" bind:checked={showDeleted.value} />
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

{#snippet duplicates(merchant: Merchant)}
	{@const others = suggestionsOf(merchant)}
	{#if others.length}
		<span class="flex flex-wrap items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Possible duplicates:</span>
			{#each others as other (other.id)}
				<span
					class="inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 whitespace-normal wrap-anywhere"
				>
					{other.name}
					<span class="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
						({other.transactionCount})
					</span>
					<Button
						variant="outline"
						size="xs"
						disabled={busy}
						onclick={() => startPairMerge(merchant, other)}
					>
						Merge
					</Button>
					<Button
						variant="ghost"
						size="xs"
						disabled={busy}
						onclick={() => dismiss(merchant, other)}
					>
						Not a duplicate
					</Button>
				</span>
			{/each}
		</span>
	{/if}
{/snippet}

{#if toReview.length}
	<h2 class="pt-2 text-lg font-semibold">To review ({toReview.length})</h2>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head class="text-right">Transactions</Table.Head>
				<Table.Head>Merged names and possible duplicates</Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each toReview as merchant (merchant.id)}
				<Table.Row>
					<Table.Cell>
						<span class="flex items-center gap-2">
							<Input class="min-w-56" bind:value={names[merchant.id]} />
							<Button
								size="sm"
								disabled={busy || !names[merchant.id]?.trim() || names[merchant.id] === merchant.name}
								onclick={() => rename(merchant)}
							>
								Rename
							</Button>
						</span>
					</Table.Cell>
					<Table.Cell class="text-right tabular-nums">{merchant.transactionCount}</Table.Cell>
					<Table.Cell class="min-w-72 space-y-1 whitespace-normal">
						{#if merchant.otherNames.length}
							<span class="flex flex-wrap gap-1">
								{#each merchant.otherNames as other (other.key)}
									<Badge variant="secondary" class="h-auto whitespace-normal wrap-anywhere">{other.name}</Badge>
								{/each}
							</span>
						{/if}
						{@render duplicates(merchant)}
					</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-right">
						<Button variant="outline" size="sm" onclick={() => viewTransactions(merchant)}>
							View transactions
						</Button>
						<Button variant="outline" size="sm" disabled={busy} onclick={() => startMerge(merchant)}>
							Merge into…
						</Button>
						<Button size="sm" disabled={busy} onclick={() => markReviewed(merchant)}>
							Looks fine
						</Button>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<h2 class="pt-4 text-lg font-semibold">All merchants</h2>
{/if}

{#snippet sortButton(key: SortKey, label: string)}
	<button
		class="inline-flex cursor-pointer items-center gap-1 hover:underline"
		title="Sort by this column"
		onclick={() => sortBy(key)}
	>
		{label}
		<span class="w-3 text-muted-foreground">
			{sortKey.value === key ? (sortDescending.value ? "↓" : "↑") : "↕"}
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
			{@const hasDuplicates = suggestionsOf(merchant).length > 0}
			<Table.Row class={hasDuplicates ? "border-b-0" : ""}>
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
				<Table.Cell class="whitespace-normal">
					<span class="flex flex-wrap gap-1.5">
						{#each merchant.otherNames as other (other.key)}
							<span
								class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium whitespace-normal wrap-anywhere"
							>
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
			{#if hasDuplicates}
				<!-- Its own row: next to the rename field and the buttons the chips get squeezed -->
				<Table.Row>
					<Table.Cell colspan={5} class="pt-0 whitespace-normal">
						{@render duplicates(merchant)}
					</Table.Cell>
				</Table.Row>
			{/if}
		{:else}
			<Table.Row>
				<Table.Cell colspan={5} class="text-muted-foreground">No merchants</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>

{#if showDeleted.value}
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
					<Table.Cell class="min-w-48 font-medium whitespace-normal wrap-anywhere">{merchant.name}</Table.Cell>
					<Table.Cell>
						<span class="flex flex-wrap gap-1">
							{#each merchant.otherNames as other (other.key)}
								<Badge variant="secondary" class="h-auto whitespace-normal wrap-anywhere">{other.name}</Badge>
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

<Dialog.Root bind:open={pairMergeOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				Merge "{pairMerge?.merchants[0].name}" and "{pairMerge?.merchants[1].name}"
			</Dialog.Title>
			<Dialog.Description>
				Pick the merchant that is left. You see the affected transactions before anything is written.
			</Dialog.Description>
		</Dialog.Header>

		{#if pairMerge}
			{@const pair = pairMerge}
			<div class="space-y-1">
				{#each pair.merchants as merchant (merchant.id)}
					<label class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
						<input
							type="radio"
							name="stays"
							checked={merchant.id === pair.staysId}
							onchange={() => (pairMerge = { ...pair, staysId: merchant.id })}
						/>
						<span class="font-medium">{merchant.name}</span>
						<span class="ml-auto tabular-nums text-muted-foreground">{merchant.transactionCount}</span>
					</label>
				{/each}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (pairMergeOpen = false)}>Cancel</Button>
			<Button disabled={busy} onclick={previewPairMerge}>Preview merge</Button>
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
					<MerchantTransactions filter={{ merchantId: transactionsOf.id }} />
				{/key}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
