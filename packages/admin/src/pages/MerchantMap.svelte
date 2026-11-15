<script lang="ts">
	import {
		addMerchantMapEntry,
		deleteMerchantMapEntry,
		ignorePlace,
		loadAccounts,
		loadMerchantMap,
		loadMerchantMapEntryCoverage,
		loadMerchants,
		loadRecurringCounterparties,
		loadRecurringPlaces,
		restorePlace,
		updateMerchantMapEntry,
		type Account,
		type Merchant,
		type MerchantChangeReport,
		type MerchantMapEntry,
		type MerchantMapEntryCoverage,
		type MerchantMapEntryInput,
		type RecurringCounterparty,
		type RecurringPlace,
	} from "$lib/api";
	import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";

	import MerchantChanges from "$lib/components/MerchantChanges.svelte";
	import MerchantTransactions from "$lib/components/MerchantTransactions.svelte";
	import Pagination from "$lib/components/Pagination.svelte";
	import SortButton from "$lib/components/SortButton.svelte";
	import TransactionsButton from "$lib/components/TransactionsButton.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Badge } from "$lib/components/ui/badge";
	import { Switch } from "$lib/components/ui/switch";
	import * as Table from "$lib/components/ui/table";
	import { amountClass } from "$lib/format";
	import { clampOffset, PAGE_SIZE } from "$lib/pages";
	import { queryCount, queryFlag, queryText } from "$lib/queryState";
	import { p } from "$lib/router";
	import { querySort } from "$lib/sorting";

	/** A change of the map that is shown as a preview first and written only when applied */
	type Proposal = {
		title: string;
		destructive?: boolean;
		run: (dryRun: boolean) => Promise<MerchantChangeReport>;
	};

	const fieldLabels: Record<MerchantMapEntry["field"], string> = {
		address: "Address",
		city: "City",
		counterparty: "Recipient or sender",
	};

	/** A place or a person without a merchant, in the shape both lists are shown in */
	type Suggestion = {
		field: "address" | "counterparty";
		key: string;
		payments: number;
		/** Only for people: the transfers by side */
		sides?: { sent: number; received: number };
		firstDate: string;
		lastDate: string;
		/** The addresses of a place, the spellings of a person's name */
		texts: Array<{ text: string; payments: number }>;
		proposedText: string;
		proposedMerchant: string;
		transactions: RecurringPlace["transactions"];
		ignored: RecurringPlace["ignored"];
	};

	const placeSuggestion = (place: RecurringPlace): Suggestion => ({
		...place,
		field: "address",
		texts: place.addresses.map(({ address, payments }) => ({ text: address, payments })),
		proposedMerchant: "",
	});

	const personSuggestion = ({ sent, received, names, ...person }: RecurringCounterparty): Suggestion => ({
		...person,
		field: "counterparty",
		sides: { sent, received },
		texts: names.map((spelling) => ({ text: spelling.name, payments: spelling.payments })),
	});

	let entries = $state<MerchantMapEntry[]>([]);
	let merchants = $state<Merchant[]>([]);
	let places = $state<Suggestion[]>([]);
	let people = $state<Suggestion[]>([]);
	/** The entry each place or person would get, editable before it is named */
	let drafts = $state<Record<string, { text: string; merchant: string }>>({});
	/** Places and people whose texts are all shown */
	let expanded = $state<Record<string, boolean>>({});
	let accounts = $state<Account[]>([]);
	const showIgnored = queryFlag("showIgnored");
	const showIgnoredPeople = queryFlag("showIgnoredPeople");

	const openPlaces = $derived(places.filter((place) => !place.ignored));
	const ignoredList = $derived(places.filter((place) => place.ignored));
	const openPeople = $derived(people.filter((person) => !person.ignored));
	const ignoredPeople = $derived(people.filter((person) => person.ignored));

	let transactionsOpen = $state(false);
	let transactionsOf = $state<Suggestion>();

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;

	function viewTransactions(place: Suggestion) {
		transactionsOf = place;
		transactionsOpen = true;
	}

	let entryTransactionsOpen = $state(false);
	let entryTransactionsOf = $state<MerchantMapEntry>();
	let coverage = $state<MerchantMapEntryCoverage>();
	let coverageError = $state<string>();

	function viewEntryTransactions(entry: MerchantMapEntry) {
		entryTransactionsOf = entry;
		entryTransactionsOpen = true;
		coverage = undefined;
		coverageError = undefined;
		loadMerchantMapEntryCoverage(entry.id).then(
			(loaded) => {
				if (entryTransactionsOf?.id === entry.id) coverage = loaded;
			},
			(e: unknown) => (coverageError = String(e)),
		);
	}
	const filter = queryText("search");
	let busy = $state(false);
	let error = $state<string>();
	let notice = $state<string>();

	let editOpen = $state(false);
	/** The entry being edited, `undefined` while adding one */
	let editing = $state<MerchantMapEntry>();
	let form = $state<MerchantMapEntryInput>({
		field: "address",
		text: "",
		merchant: "",
		overridesBankMerchant: false,
	});

	let proposal = $state<Proposal>();
	let preview = $state<MerchantChangeReport>();
	let previewOpen = $state(false);
	let previewError = $state<string>();

	const entriesOffset = queryCount("offset");

	const sortKeys = ["text", "merchant", "transactionCount"] as const;
	type SortKey = (typeof sortKeys)[number];
	const sort = querySort(
		{ key: "sort", descending: "descending" },
		sortKeys,
		{ key: "merchant", descending: false },
		// Counts are looked at from the largest, texts from A
		(key) => key === "transactionCount",
		() => (entriesOffset.value = 0),
	);

	const compareEntries = (a: MerchantMapEntry, b: MerchantMapEntry) => {
		const byMerchant = a.merchant.localeCompare(b.merchant) || a.text.localeCompare(b.text);
		const order =
			sort.key === "text"
				? a.text.localeCompare(b.text)
				: sort.key === "merchant"
					? byMerchant
					: a.transactionCount - b.transactionCount;

		return (sort.descending ? -order : order) || byMerchant;
	};

	const shown = $derived.by(() => {
		const needle = filter.value.trim().toLowerCase();

		return entries
			.filter(
				(entry) =>
					entry.text.toLowerCase().includes(needle) || entry.merchant.toLowerCase().includes(needle),
			)
			.toSorted(compareEntries);
	});

	// An offset past the end, e.g. after deletes shortened the list, shows its last page
	const entriesPage = $derived(clampOffset(entriesOffset.value, shown.length));
	const shownPage = $derived(shown.slice(entriesPage, entriesPage + PAGE_SIZE));

	const merchantNames = $derived(
		merchants.filter((merchant) => !merchant.deletedAt).map((merchant) => merchant.name),
	);

	async function load() {
		try {
			let loadedPlaces: RecurringPlace[];
			let loadedPeople: RecurringCounterparty[];
			[entries, merchants, loadedPlaces, loadedPeople, accounts] = await Promise.all([
				loadMerchantMap(),
				loadMerchants(),
				loadRecurringPlaces(),
				loadRecurringCounterparties(),
				loadAccounts(),
			]);
			places = loadedPlaces.map(placeSuggestion);
			people = loadedPeople.map(personSuggestion);
			drafts = Object.fromEntries(
				[...places, ...people].map((item) => [
					item.key,
					drafts[item.key] ?? { text: item.proposedText, merchant: item.proposedMerchant },
				]),
			);
		} catch (e) {
			error = String(e);
		}
	}

	function startAdd() {
		editing = undefined;
		form = { field: "address", text: "", merchant: "", overridesBankMerchant: false };
		editOpen = true;
	}

	function startEdit(entry: MerchantMapEntry) {
		editing = entry;
		form = {
			field: entry.field,
			text: entry.text,
			merchant: entry.merchant,
			overridesBankMerchant: entry.overridesBankMerchant,
		};
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
		const input = {
			field: form.field,
			text: form.text.trim(),
			merchant: form.merchant.trim(),
			overridesBankMerchant: form.overridesBankMerchant,
		};
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

	function name(place: Suggestion) {
		const draft = drafts[place.key];
		if (!draft) return;

		const input = {
			field: place.field,
			text: draft.text.trim(),
			merchant: draft.merchant.trim(),
			overridesBankMerchant: false,
		};

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

	const ignore = (place: Suggestion, forever: boolean) =>
		act(() => ignorePlace(place.key, forever));

	const restore = (place: Suggestion) => act(() => restorePlace(place.key));

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
	several entries match, the longest text wins. A merchant name from the bank is replaced only by
	entries that override it. Transfers get a merchant only from a "Recipient or sender" entry whose
	text is exactly their recipient's or sender's name. A rule that sets the merchant overrides the
	map. Every change shows the transactions it affects before it is applied.
</p>

{#snippet placeRow(place: Suggestion)}
	{@const draft = drafts[place.key]}
	{@const shownTexts = expanded[place.key] ? place.texts : place.texts.slice(0, 3)}
	<Table.Row>
		<Table.Cell class="text-right">
			<TransactionsButton count={place.payments} onclick={() => viewTransactions(place)} />
			{#if place.sides}
				<div class="text-xs whitespace-nowrap text-muted-foreground">
					{place.sides.sent} sent, {place.sides.received} received
				</div>
			{/if}
		</Table.Cell>
		<Table.Cell class="whitespace-nowrap text-xs">
			{place.firstDate}<br />{place.lastDate}
		</Table.Cell>
		<Table.Cell class="min-w-56 font-mono text-xs">
			<button
				class="block w-full cursor-pointer text-left hover:underline hover:underline-offset-4"
				title="View transactions"
				onclick={() => viewTransactions(place)}
			>
				{#each shownTexts as { text, payments } (text)}
					<div class="whitespace-pre-wrap wrap-anywhere">
						{text} <span class="text-muted-foreground">×{payments}</span>
					</div>
				{/each}
			</button>
			{#if place.texts.length > 3}
				<button
					class="cursor-pointer text-muted-foreground underline underline-offset-4"
					onclick={() => (expanded[place.key] = !expanded[place.key])}
				>
					{expanded[place.key] ? "Show fewer" : `Show all ${place.texts.length}`}
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

{#snippet placesTable(list: Suggestion[], people = false)}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="text-right">{people ? "Transfers" : "Payments"}</Table.Head>
				<Table.Head>Dates</Table.Head>
				<Table.Head>{people ? "Names" : "Addresses"}</Table.Head>
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
			<Label for="show-ignored" class="cursor-pointer">Ignored ({ignoredList.length})</Label>
		</span>
		{#if showIgnored.value}
			{@render placesTable(ignoredList)}
		{/if}
	{/if}
{/if}

{#if people.length}
	<h2 class="pt-2 text-lg font-semibold">People without a merchant ({openPeople.length})</h2>
	<p class="text-sm text-muted-foreground">
		Transfers and card transfers (such as PayPal) without a merchant, grouped by the recipient's or
		sender's name, sent and received together, from three transfers on. Naming one adds an entry
		that matches that name exactly. An ignored person leaves the list, for now (until a transfer
		dated after the day they were ignored) or forever.
	</p>

	{#if openPeople.length}
		{@render placesTable(openPeople, true)}
	{:else}
		<p class="text-sm text-muted-foreground">No people left to name.</p>
	{/if}

	{#if ignoredPeople.length}
		<span class="flex items-center gap-2 pt-2">
			<Switch id="show-ignored-people" bind:checked={showIgnoredPeople.value} />
			<Label for="show-ignored-people" class="cursor-pointer">Ignored ({ignoredPeople.length})</Label>
		</span>
		{#if showIgnoredPeople.value}
			{@render placesTable(ignoredPeople, true)}
		{/if}
	{/if}
{/if}

{#if places.length || people.length}
	<h2 class="pt-4 text-lg font-semibold">Entries ({entries.length})</h2>
{/if}

<div class="flex flex-wrap items-center gap-4">
	<Input
		class="max-w-xs"
		placeholder="Text or merchant"
		bind:value={filter.value}
		oninput={() => (entriesOffset.value = 0)}
	/>
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
			<Table.Head><SortButton {sort} key="text" label="Text" /></Table.Head>
			<Table.Head><SortButton {sort} key="merchant" label="Merchant" /></Table.Head>
			<Table.Head class="text-right">
				<SortButton {sort} key="transactionCount" label="Transactions" />
			</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each shownPage as entry (entry.id)}
			<Table.Row>
				<Table.Cell>{fieldLabels[entry.field]}</Table.Cell>
				<Table.Cell class="min-w-48 font-mono text-xs whitespace-pre-wrap wrap-anywhere">{entry.text}</Table.Cell>
				<Table.Cell class="min-w-48 font-medium whitespace-normal wrap-anywhere">
					{entry.merchant}
					{#if entry.overridesBankMerchant}
						<Badge
							variant="secondary"
							class="ml-1"
							title="Also replaces a merchant name from the bank"
						>
							overrides bank
						</Badge>
					{/if}
				</Table.Cell>
				<Table.Cell class="text-right">
					<TransactionsButton
						count={entry.transactionCount}
						onclick={() => viewEntryTransactions(entry)}
					/>
				</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-right">
					<Button variant="outline" size="sm" disabled={busy} onclick={() => startEdit(entry)}>
						Edit
					</Button>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger disabled={busy}>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon-sm" aria-label="More actions">
									<EllipsisVertical />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-auto">
							<DropdownMenu.Item variant="destructive" onSelect={() => remove(entry)}>
								Delete
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell colspan={5} class="text-muted-foreground">No entries</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
{#if shown.length > PAGE_SIZE}
	<Pagination
		bind:offset={() => entriesPage, (offset) => (entriesOffset.value = offset)}
		limit={PAGE_SIZE}
		total={shown.length}
	/>
{/if}

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
					<option value="counterparty">{fieldLabels.counterparty}</option>
				</select>
			</div>
			<div class="space-y-1">
				<Label for="entry-text">
					{form.field === "counterparty" ? "Name, exactly as the bank gives it" : "Text the field contains"}
				</Label>
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
			<!-- Transfers have no merchant from the bank to override -->
			{#if form.field !== "counterparty"}
			<div class="flex items-start gap-3">
				<Switch id="entry-overrides" bind:checked={form.overridesBankMerchant} />
				<div class="space-y-0.5">
					<Label for="entry-overrides" class="cursor-pointer">Override the bank's merchant</Label>
					<p class="text-sm text-muted-foreground">
						Also applies to payments the bank names a merchant for, such as Bolt's rides, food
						and scooters that the bank all calls "Bolt". Off, the entry only names payments
						without one.
					</p>
				</div>
			</div>
			{/if}
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
			<Dialog.Title>
				{transactionsOf?.field === "counterparty" ? "Transfers" : "Payments"} of "{transactionsOf?.proposedText}"
			</Dialog.Title>
			<Dialog.Description>
				{transactionsOf?.payments}
				{transactionsOf?.field === "counterparty" ? "transfer(s)" : "payment(s)"} without a merchant. A
				row opens its transaction in a new tab.
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

<Dialog.Root bind:open={entryTransactionsOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-3xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>
				Transactions of "{entryTransactionsOf?.text}" → {entryTransactionsOf?.merchant}
			</Dialog.Title>
			<Dialog.Description>
				{#if entryTransactionsOf}
					<a
						class="underline underline-offset-4"
						href={p("/transactions", { search: { merchantMapEntryId: entryTransactionsOf.id } })}
					>
						Open in Transactions
					</a>
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
			{#if coverageError}
				<p class="text-sm text-destructive">{coverageError}</p>
			{:else if coverage && coverage.matching === 0}
				<p class="rounded-md bg-muted px-3 py-2 text-sm">Its text matches no payment.</p>
			{:else if coverage && coverage.others.length}
				<div class="rounded-md bg-muted px-3 py-2 text-sm">
					<p>
						Its text matches {coverage.matching} payment(s), and sets the merchant of
						{coverage.set}. For the rest something else does:
					</p>
					<ul class="list-disc pl-5">
						{#each coverage.others as other, index (index)}
							<li>
								<span class="tabular-nums">{other.payments}</span>:
								{#if other.kind === "bank"}
									the bank names their merchant. "Override the bank's merchant" on this entry would
									replace it.
								{:else if other.kind === "entry"}
									{other.label} sets it, as the longer (or older) text.
								{:else if other.kind === "rule"}
									the rule "{other.label}" sets it: rules override the map.
								{:else}
									not processed since this entry changed; reprocessing updates them.
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if entryTransactionsOf}
				{#key entryTransactionsOf.id}
					<MerchantTransactions filter={{ merchantMapEntryId: entryTransactionsOf.id }} />
				{/key}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
