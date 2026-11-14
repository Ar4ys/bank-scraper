<script lang="ts">
	import {
		deleteMerchant,
		detachMerchantName,
		dismissMerchantPair,
		loadBrandfetch,
		loadMerchants,
		loadMerchantSuggestions,
		loadSureCategories,
		mergeMerchant,
		removeMerchantPermanently,
		renameMerchant,
		restoreMerchant,
		reviewMerchant,
		setMerchantCategory,
		setMerchantDomain,
		type Merchant,
		type MerchantChangeReport,
		type MerchantSuggestions,
		type SureCategory,
	} from "$lib/api";
	import CategoryPicker from "$lib/components/CategoryPicker.svelte";
	import DomainPicker from "$lib/components/DomainPicker.svelte";
	import MerchantChanges from "$lib/components/MerchantChanges.svelte";
	import MerchantTransactions from "$lib/components/MerchantTransactions.svelte";
	import SortButton from "$lib/components/SortButton.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { formatInstant } from "$lib/format";
	import { queryFlag, queryText } from "$lib/queryState";
	import { p } from "$lib/router";
	import { compareOptional, querySort, type QuerySort } from "$lib/sorting";

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
	/** The category picked for each merchant, saved together with its name */
	let categories = $state<Record<string, string | null>>({});
	/** Sure's categories; `undefined` while they can't be read, `null` while Sure isn't configured */
	let sureCategories = $state<SureCategory[] | null>();
	/** The domain picked for each merchant, saved together with its name */
	let domains = $state<Record<string, string | null>>({});
	let brandfetchClientId = $state<string | null>(null);
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

	const sortKeys = ["name", "domain", "category", "transactionCount"] as const;
	type SortKey = (typeof sortKeys)[number];
	// Counts are looked at from the largest, texts from A
	const startsDescending = (key: SortKey) => key === "transactionCount";
	const allSort = querySort(
		{ key: "sort", descending: "descending" },
		sortKeys,
		{ key: "name", descending: false },
		startsDescending,
	);
	const reviewSort = querySort(
		{ key: "reviewSort", descending: "reviewDescending" },
		sortKeys,
		{ key: "transactionCount", descending: true },
		startsDescending,
	);

	const categoryLabel = (merchant: Merchant) => {
		const category = sureCategories?.find((item) => item.id === merchant.sureCategoryId);
		if (!category) return null;
		return category.parentName ? `${category.parentName} › ${category.name}` : category.name;
	};

	/** By the saved values, so a row doesn't move while its drafts are edited */
	const compareMerchants = (sort: QuerySort<SortKey>) => (a: Merchant, b: Merchant) => {
		const byName = a.name.localeCompare(b.name);
		const direction = sort.descending ? -1 : 1;
		const order =
			sort.key === "name"
				? byName * direction
				: sort.key === "transactionCount"
					? (a.transactionCount - b.transactionCount) * direction
					: sort.key === "domain"
						? compareOptional(a.domain, b.domain, sort.descending)
						: compareOptional(categoryLabel(a), categoryLabel(b), sort.descending);

		return order || byName;
	};

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
			.toSorted(compareMerchants(allSort)),
	);
	const merchantById = $derived(new Map(merchants.map((merchant) => [merchant.id, merchant])));

	/** Merchants waiting to be reviewed, by default those with the most transactions first */
	const toReview = $derived(
		merchants
			.filter((merchant) => !merchant.deletedAt && !merchant.reviewedAt)
			.toSorted(compareMerchants(reviewSort)),
	);
	/** Columns of a merchant's first line; its second line spans them all */
	const reviewColumns = $derived(sureCategories === null ? 4 : 5);
	const allColumns = $derived(reviewColumns + 1);

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
			const [loadedMerchants, loadedSuggestions, sure, brandfetch] = await Promise.all([
				loadMerchants(),
				loadMerchantSuggestions(),
				loadSureCategories().catch((e: unknown) => {
					error = `Sure's categories can't be loaded: ${String(e)}`;
					return undefined;
				}),
				loadBrandfetch(),
			]);

			// Saving one row reloads them all, so edits of the other rows that weren't saved are kept
			const before = merchantById;
			/** The draft while it differs from what was saved before the reload, else the saved value */
			const keepUnsaved = <T,>(
				merchant: Merchant,
				drafts: Record<string, T | undefined>,
				saved: (merchant: Merchant) => T,
			) => {
				const previous = before.get(merchant.id);
				const draft = drafts[merchant.id];
				const edited = previous !== undefined && draft !== undefined && draft !== saved(previous);
				return [merchant.id, edited ? draft : saved(merchant)] as const;
			};

			[merchants, suggestions] = [loadedMerchants, loadedSuggestions];
			sureCategories = sure && (sure.enabled ? sure.categories : null);
			brandfetchClientId = brandfetch.clientId;
			names = Object.fromEntries(
				merchants.map((merchant) => keepUnsaved(merchant, names, (m) => m.name)),
			);
			categories = Object.fromEntries(
				merchants.map((merchant) => keepUnsaved(merchant, categories, (m) => m.sureCategoryId)),
			);
			domains = Object.fromEntries(
				merchants.map((merchant) => keepUnsaved(merchant, domains, (m) => m.domain)),
			);
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

	const draftName = (merchant: Merchant) => (names[merchant.id] ?? "").trim();
	const nameChanged = (merchant: Merchant) => draftName(merchant) !== merchant.name;
	const categoryChanged = (merchant: Merchant) =>
		(categories[merchant.id] ?? null) !== merchant.sureCategoryId;
	const domainChanged = (merchant: Merchant) => (domains[merchant.id] ?? null) !== merchant.domain;

	async function saveDetails(merchant: Merchant) {
		if (categoryChanged(merchant)) {
			await setMerchantCategory(merchant.id, categories[merchant.id] ?? null);
		}
		if (domainChanged(merchant)) {
			await setMerchantDomain(merchant.id, domains[merchant.id] ?? null);
		}
	}

	/**
	 * Saves the edited name, the picked category and the picked domain of a merchant. A new name goes
	 * through the rename preview first, and the rest is saved only once the rename is applied, so a
	 * rejected rename saves nothing. A rename reviews the merchant; `review` reviews it otherwise too.
	 */
	function save(merchant: Merchant, review: boolean) {
		if (!nameChanged(merchant)) {
			return act(async () => {
				await saveDetails(merchant);
				if (review) await reviewMerchant(merchant.id);
			});
		}

		const name = draftName(merchant);
		return propose({
			title: `Rename "${merchant.name}" to "${name}"`,
			description: `Its transactions get the new name. "${merchant.name}" stays a name of the merchant, so whatever still derives it ends up here.`,
			run: async (dryRun) => {
				const report = await renameMerchant(merchant.id, name, dryRun);
				if (!dryRun) await saveDetails(merchant);
				return report;
			},
		});
	}

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

{#snippet mergedNames(merchant: Merchant, detachable: boolean)}
	{#if merchant.otherNames.length}
		<span class="flex flex-wrap items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Merged names:</span>
			{#each merchant.otherNames as other (other.key)}
				<span
					class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-secondary py-0.5 pl-2 font-medium whitespace-normal wrap-anywhere {detachable
						? 'pr-0.5'
						: 'pr-2'}"
				>
					{other.name}
					{#if detachable}
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
					{/if}
				</span>
			{/each}
		</span>
	{/if}
{/snippet}

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
				<Table.Head><SortButton sort={reviewSort} key="name" label="Name" /></Table.Head>
				<Table.Head><SortButton sort={reviewSort} key="domain" label="Domain" /></Table.Head>
				{#if sureCategories !== null}
					<Table.Head><SortButton sort={reviewSort} key="category" label="Category" /></Table.Head>
				{/if}
				<Table.Head class="text-right">
					<SortButton sort={reviewSort} key="transactionCount" label="Transactions" />
				</Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each toReview as merchant (merchant.id)}
				{@const secondLine = merchant.otherNames.length > 0 || suggestionsOf(merchant).length > 0}
				<Table.Row class={secondLine ? "border-b-0" : ""}>
					<Table.Cell><Input class="min-w-56" bind:value={names[merchant.id]} /></Table.Cell>
					<Table.Cell>
						<DomainPicker
							bind:value={domains[merchant.id]}
							merchantName={merchant.name}
							clientId={brandfetchClientId}
						/>
					</Table.Cell>
					{#if sureCategories !== null}
						<Table.Cell>
							<CategoryPicker bind:value={categories[merchant.id]} categories={sureCategories} />
						</Table.Cell>
					{/if}
					<Table.Cell class="text-right tabular-nums">{merchant.transactionCount}</Table.Cell>
					<Table.Cell class="whitespace-nowrap text-right">
						<Button variant="outline" size="sm" onclick={() => viewTransactions(merchant)}>
							View transactions
						</Button>
						<Button variant="outline" size="sm" disabled={busy} onclick={() => startMerge(merchant)}>
							Merge into…
						</Button>
						<Button size="sm" disabled={busy || !draftName(merchant)} onclick={() => save(merchant, true)}>
							Looks fine
						</Button>
					</Table.Cell>
				</Table.Row>
				{#if secondLine}
					<Table.Row>
						<Table.Cell colspan={reviewColumns} class="space-y-1.5 pt-0 whitespace-normal">
							{@render mergedNames(merchant, false)}
							{@render duplicates(merchant)}
						</Table.Cell>
					</Table.Row>
				{/if}
			{/each}
		</Table.Body>
	</Table.Root>

	<h2 class="pt-4 text-lg font-semibold">All merchants</h2>
{/if}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head><SortButton sort={allSort} key="name" label="Name" /></Table.Head>
			<Table.Head><SortButton sort={allSort} key="domain" label="Domain" /></Table.Head>
			{#if sureCategories !== null}
				<Table.Head><SortButton sort={allSort} key="category" label="Category" /></Table.Head>
			{/if}
			<Table.Head></Table.Head>
			<Table.Head class="text-right">
				<SortButton sort={allSort} key="transactionCount" label="Transactions" />
			</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each active as merchant (merchant.id)}
			{@const secondLine = merchant.otherNames.length > 0 || suggestionsOf(merchant).length > 0}
			<Table.Row class={secondLine ? "border-b-0" : ""}>
				<Table.Cell><Input class="min-w-56" bind:value={names[merchant.id]} /></Table.Cell>
				<Table.Cell>
					<DomainPicker
						bind:value={domains[merchant.id]}
						merchantName={merchant.name}
						clientId={brandfetchClientId}
					/>
				</Table.Cell>
				{#if sureCategories !== null}
					<Table.Cell>
						<CategoryPicker bind:value={categories[merchant.id]} categories={sureCategories} />
					</Table.Cell>
				{/if}
				<Table.Cell>
					<Button
						size="sm"
						disabled={busy ||
							!draftName(merchant) ||
							(!nameChanged(merchant) && !categoryChanged(merchant) && !domainChanged(merchant))}
						onclick={() => save(merchant, false)}
					>
						Save
					</Button>
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums">{merchant.transactionCount}</Table.Cell>
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
			{#if secondLine}
				<!-- Its own row: next to the name, pickers and buttons the chips get squeezed -->
				<Table.Row>
					<Table.Cell colspan={allColumns} class="space-y-1.5 pt-0 whitespace-normal">
						{@render mergedNames(merchant, true)}
						{@render duplicates(merchant)}
					</Table.Cell>
				</Table.Row>
			{/if}
		{:else}
			<Table.Row>
				<Table.Cell colspan={allColumns} class="text-muted-foreground">No merchants</Table.Cell>
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
