<script lang="ts">
	import {
		addMerchantMapEntry,
		deleteMerchantMapEntry,
		ignorePlace,
		loadAccounts,
		loadMerchantMap,
		loadMerchants,
		loadRecurringPlaces,
		restorePlace,
		updateMerchantMapEntry,
		type Account,
		type Merchant,
		type MerchantChangeReport,
		type MerchantMapEntry,
		type MerchantMapEntryInput,
		type RecurringPlace,
	} from "$lib/api";
	import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";

	import MerchantChanges from "$lib/components/MerchantChanges.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { queryFlag, queryText } from "$lib/queryState";
	import { p } from "$lib/router";

	/** A change of the map that is shown as a preview first and written only when applied */
	type Proposal = {
		title: string;
		destructive?: boolean;
		run: (dryRun: boolean) => Promise<MerchantChangeReport>;
	};

	const fieldLabels: Record<MerchantMapEntry["field"], string> = {
		address: "Address",
		city: "City",
	};

	let entries = $state<MerchantMapEntry[]>([]);
	let merchants = $state<Merchant[]>([]);
	let places = $state<RecurringPlace[]>([]);
	/** The entry each place would get, editable before it is named */
	let drafts = $state<Record<string, { text: string; merchant: string }>>({});
	/** Places whose addresses are all shown */
	let expanded = $state<Record<string, boolean>>({});
	let accounts = $state<Account[]>([]);
	const showIgnored = queryFlag("showIgnored");

	const openPlaces = $derived(places.filter((place) => !place.ignored));
	const ignoredList = $derived(places.filter((place) => place.ignored));

	let transactionsOpen = $state(false);
	let transactionsOf = $state<RecurringPlace>();

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;

	function viewTransactions(place: RecurringPlace) {
		transactionsOf = place;
		transactionsOpen = true;
	}
	const filter = queryText("search");
	let busy = $state(false);
	let error = $state<string>();
	let notice = $state<string>();

	let editOpen = $state(false);
	/** The entry being edited, `undefined` while adding one */
	let editing = $state<MerchantMapEntry>();
	let form = $state<MerchantMapEntryInput>({ field: "address", text: "", merchant: "" });

	let proposal = $state<Proposal>();
	let preview = $state<MerchantChangeReport>();
	let previewOpen = $state(false);
	let previewError = $state<string>();

	const shown = $derived.by(() => {
		const needle = filter.value.trim().toLowerCase();

		return entries.filter(
			(entry) =>
				entry.text.toLowerCase().includes(needle) || entry.merchant.toLowerCase().includes(needle),
		);
	});

	const merchantNames = $derived(
		merchants.filter((merchant) => !merchant.deletedAt).map((merchant) => merchant.name),
	);

	async function load() {
		try {
			[entries, merchants, places, accounts] = await Promise.all([
				loadMerchantMap(),
				loadMerchants(),
				loadRecurringPlaces(),
				loadAccounts(),
			]);
			drafts = Object.fromEntries(
				places.map((place) => [
					place.key,
					drafts[place.key] ?? { text: place.proposedText, merchant: "" },
				]),
			);
		} catch (e) {
			error = String(e);
		}
	}

	function startAdd() {
		editing = undefined;
		form = { field: "address", text: "", merchant: "" };
		editOpen = true;
	}

	function startEdit(entry: MerchantMapEntry) {
		editing = entry;
		form = { field: entry.field, text: entry.text, merchant: entry.merchant };
		editOpen = true;
	}

	async function propose(proposed: Proposal) {
		busy = true;
		error = undefined;
		notice = undefined;
		previewError = undefined;

		try {
			preview = await proposed.run(true);
			proposal = proposed;
			editOpen = false;
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

	function save() {
		const input = { field: form.field, text: form.text.trim(), merchant: form.merchant.trim() };
		const entry = editing;

		return propose(
			entry
				? {
						title: `Change "${entry.text}" → ${entry.merchant}`,
						run: (dryRun) => updateMerchantMapEntry(entry.id, input, dryRun),
					}
				: {
						title: `Add "${input.text}" → ${input.merchant}`,
						run: (dryRun) => addMerchantMapEntry(input, dryRun),
					},
		);
	}

	function name(place: RecurringPlace) {
		const draft = drafts[place.key];
		if (!draft) return;

		const input = { field: "address" as const, text: draft.text.trim(), merchant: draft.merchant.trim() };

		return propose({
			title: `Add "${input.text}" → ${input.merchant}`,
			run: (dryRun) => addMerchantMapEntry(input, dryRun),
		});
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

	const ignore = (place: RecurringPlace, forever: boolean) =>
		act(() => ignorePlace(place.key, forever));

	const restore = (place: RecurringPlace) => act(() => restorePlace(place.key));

	const remove = (entry: MerchantMapEntry) =>
		propose({
			title: `Delete "${entry.text}" → ${entry.merchant}`,
			destructive: true,
			run: (dryRun) => deleteMerchantMapEntry(entry.id, dryRun),
		});

	void load();
</script>

<h1 class="text-xl font-semibold">Merchant map</h1>
<p class="text-sm text-muted-foreground">
	The merchant of card and mobile payments for which the bank names none: a payment whose address
	(or city) contains an entry's text gets its merchant. Case and repeated spaces do not count. When
	several entries match, the longest text wins. A merchant name from the bank is never replaced, and
	a rule that sets the merchant overrides the map. Every change shows the transactions it affects
	before it is applied.
</p>

{#snippet placeRow(place: RecurringPlace)}
	{@const draft = drafts[place.key]}
	{@const shownAddresses = expanded[place.key] ? place.addresses : place.addresses.slice(0, 3)}
	<Table.Row>
		<Table.Cell class="text-right tabular-nums">{place.payments}</Table.Cell>
		<Table.Cell class="whitespace-nowrap text-xs">
			{place.firstDate}<br />{place.lastDate}
		</Table.Cell>
		<Table.Cell class="min-w-56 font-mono text-xs">
			<button
				class="block w-full cursor-pointer text-left hover:underline hover:underline-offset-4"
				title="View transactions"
				onclick={() => viewTransactions(place)}
			>
				{#each shownAddresses as { address, payments } (address)}
					<div class="whitespace-pre-wrap wrap-anywhere">
						{address} <span class="text-muted-foreground">×{payments}</span>
					</div>
				{/each}
			</button>
			{#if place.addresses.length > 3}
				<button
					class="cursor-pointer text-muted-foreground underline underline-offset-4"
					onclick={() => (expanded[place.key] = !expanded[place.key])}
				>
					{expanded[place.key] ? "Show fewer" : `Show all ${place.addresses.length}`}
				</button>
			{/if}
		</Table.Cell>
		{#if draft}
			<Table.Cell>
				<Input class="min-w-40 font-mono" bind:value={draft.text} />
			</Table.Cell>
			<Table.Cell>
				<Input class="min-w-40" list="merchant-names" placeholder="Merchant" bind:value={draft.merchant} />
			</Table.Cell>
			<Table.Cell>
				<div class="flex flex-wrap justify-end gap-1">
					{#if place.ignored}
						<span class="w-full text-right text-xs text-muted-foreground">
							{place.ignored.forever ? "Ignored forever" : "Until a new payment"}
						</span>
					{/if}
					<Button variant="outline" size="sm" onclick={() => viewTransactions(place)}>
						View transactions
					</Button>
					<Button
						size="sm"
						disabled={busy || !draft.text.trim() || !draft.merchant.trim()}
						onclick={() => name(place)}
					>
						Name it
					</Button>
					{#if place.ignored}
						<Button variant="outline" size="sm" disabled={busy} onclick={() => restore(place)}>
							Restore
						</Button>
					{:else}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger disabled={busy}>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="icon-sm" aria-label="More actions">
										<EllipsisVertical />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-auto">
								<DropdownMenu.Item onSelect={() => ignore(place, false)}>
									<div>
										<div>Ignore for now</div>
										<div class="text-xs whitespace-nowrap text-muted-foreground">Until a payment dated after today</div>
									</div>
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => ignore(place, true)}>
									<div>
										<div>Ignore forever</div>
										<div class="text-xs whitespace-nowrap text-muted-foreground">Even when new payments arrive</div>
									</div>
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			</Table.Cell>
		{/if}
	</Table.Row>
{/snippet}

{#snippet placesTable(list: RecurringPlace[])}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="text-right">Payments</Table.Head>
				<Table.Head>Dates</Table.Head>
				<Table.Head>Addresses</Table.Head>
				<Table.Head>Text</Table.Head>
				<Table.Head>Merchant</Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each list as place (place.key)}
				{@render placeRow(place)}
			{/each}
		</Table.Body>
	</Table.Root>
{/snippet}

{#if places.length}
	<h2 class="pt-2 text-lg font-semibold">Places without a merchant ({openPlaces.length})</h2>
	<p class="text-sm text-muted-foreground">
		Card and mobile payments that have no merchant, grouped by their address without digits and
		punctuation, from three payments on. Naming a place adds an entry for the text. The preview shows
		every payment it catches, also outside the place. An ignored place leaves the list, for now (until
		it gets a payment dated after the day it was ignored) or forever.
	</p>

	{#if openPlaces.length}
		{@render placesTable(openPlaces)}
	{:else}
		<p class="text-sm text-muted-foreground">No places left to name.</p>
	{/if}

	{#if ignoredList.length}
		<span class="flex items-center gap-2 pt-2">
			<Switch id="show-ignored" bind:checked={showIgnored.value} />
			<Label for="show-ignored">Ignored ({ignoredList.length})</Label>
		</span>
		{#if showIgnored.value}
			{@render placesTable(ignoredList)}
		{/if}
	{/if}

	<h2 class="pt-4 text-lg font-semibold">Entries ({entries.length})</h2>
{/if}

<div class="flex flex-wrap items-center gap-4">
	<Input class="max-w-xs" placeholder="Text or merchant" bind:value={filter.value} />
	<Button disabled={busy} onclick={startAdd}>Add entry</Button>
</div>

{#if error}
	<p class="text-sm text-destructive">{error}</p>
{/if}
{#if notice}
	<p class="text-sm text-muted-foreground">{notice}</p>
{/if}

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Field</Table.Head>
			<Table.Head>Text</Table.Head>
			<Table.Head>Merchant</Table.Head>
			<Table.Head class="text-right">Transactions</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each shown as entry (entry.id)}
			<Table.Row>
				<Table.Cell>{fieldLabels[entry.field]}</Table.Cell>
				<Table.Cell class="min-w-48 font-mono text-xs whitespace-pre-wrap wrap-anywhere">{entry.text}</Table.Cell>
				<Table.Cell class="min-w-48 font-medium whitespace-normal wrap-anywhere">{entry.merchant}</Table.Cell>
				<Table.Cell class="text-right tabular-nums">{entry.transactionCount}</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right">
					<Button variant="outline" size="sm" disabled={busy} onclick={() => startEdit(entry)}>
						Edit
					</Button>
					<Button variant="destructive" size="sm" disabled={busy} onclick={() => remove(entry)}>
						Delete
					</Button>
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell colspan={5} class="text-muted-foreground">No entries</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>

<datalist id="merchant-names">
	{#each merchantNames as name (name)}
		<option value={name}></option>
	{/each}
</datalist>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{editing ? "Edit entry" : "Add entry"}</Dialog.Title>
			<Dialog.Description>
				You see the affected transactions before anything is written.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			<div class="space-y-1">
				<Label for="entry-field">Field</Label>
				<select
					id="entry-field"
					bind:value={form.field}
					class="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
				>
					<option value="address">{fieldLabels.address}</option>
					<option value="city">{fieldLabels.city}</option>
				</select>
			</div>
			<div class="space-y-1">
				<Label for="entry-text">Text the field contains</Label>
				<Input id="entry-text" class="font-mono" bind:value={form.text} />
			</div>
			<div class="space-y-1">
				<Label for="entry-merchant">Merchant</Label>
				<Input
					id="entry-merchant"
					list="merchant-names"
					placeholder="An existing merchant or a new name"
					bind:value={form.merchant}
				/>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
			<Button disabled={busy || !form.text.trim() || !form.merchant.trim()} onclick={save}>
				Preview
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-4xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{proposal?.title}</Dialog.Title>
			<Dialog.Description>This is a preview. Nothing is written until you apply it.</Dialog.Description>
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

<Dialog.Root bind:open={transactionsOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-3xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>Payments of "{transactionsOf?.proposedText}"</Dialog.Title>
			<Dialog.Description>
				{transactionsOf?.payments} payment(s) without a merchant. A row opens its transaction in a new
				tab.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Date</Table.Head>
						<Table.Head>Account</Table.Head>
						<Table.Head>Description</Table.Head>
						<Table.Head class="text-right">Amount</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each transactionsOf?.transactions ?? [] as payment (payment.transactionId)}
						<Table.Row class="relative">
							<Table.Cell class="whitespace-nowrap tabular-nums">{payment.date}</Table.Cell>
							<Table.Cell class="whitespace-nowrap">{accountName(payment.accountId)}</Table.Cell>
							<Table.Cell class="max-w-md truncate">
								<!-- The list stays open while a transaction is looked at -->
								<a
									class="stretched-link"
									href={p("/transactions/:id", { params: { id: payment.transactionId } })}
									target="_blank"
									rel="noopener"
									title="Open the transaction in a new tab"
								>
									{payment.description}
								</a>
							</Table.Cell>
							<Table.Cell
								class="whitespace-nowrap text-right tabular-nums {amountClass(payment.amount)}"
							>
								{payment.amount}
								{payment.currency}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</Dialog.Content>
</Dialog.Root>
