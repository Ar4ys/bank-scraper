<script lang="ts">
	import { getTextByPath, matchRule, renderTemplate } from "@bank-scraper/shared";
	import { searchParams } from "sv-router";
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";

	import {
		applyRules,
		loadAccounts,
		loadMerchants,
		loadRawTransaction,
		loadRuleRevision,
		loadRuleRevisions,
		loadRules,
		previewRules,
		saveRules,
		type Account,
		type ProcessingReport,
		type RuleDraft,
		type RuleRevisionSummary,
		type RulesState,
	} from "$lib/api";
	import AccountSelect from "$lib/components/AccountSelect.svelte";
	import ReportView from "$lib/components/ReportView.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import { formatInstant } from "$lib/format";

	// The fields the editor exposes. The rule engine itself can set any field of a transaction.
	const fields = [
		{ key: "merchant", label: "Merchant", placeholder: "Bolt" },
		{ key: "description", label: "Description", placeholder: "Ride {match.1} in {details.city}" },
		{ key: "date", label: "Date", placeholder: "{details.exec_date}" },
	] as const;

	const operators = ["contains", "equals", "regex"] as const;

	type Field = RulesState["fieldsByTxType"][string][number];

	let rules = $state<RuleDraft[]>([]);
	let txTypes = $state<string[]>([]);
	let fieldsByTxType = $state<RulesState["fieldsByTxType"]>({});
	/** The input a clicked field goes into: the one that had focus last */
	type FieldTarget = {
		rule: RuleDraft;
		/** The condition or the internal field the input belongs to */
		owner: object | string;
		part: "path" | "pattern" | "template";
		element: HTMLInputElement;
		/** What a clicked field puts into the input, nothing if it has no text for it */
		textFor: (path: string) => string | undefined;
		/** Whether that text replaces what the input holds, or goes where its caret is */
		replaces: boolean;
		write: (text: string) => void;
	};
	let fieldTarget = $state.raw<FieldTarget>();
	let appliedRevisionId = $state<string | null>(null);
	let hasUnappliedChanges = $state(false);
	/** The rules as last loaded from or saved to the server, to tell whether the editor has edits */
	let savedJson = $state("[]");
	let revisions = $state<RuleRevisionSummary[]>([]);
	let accounts = $state<Account[]>([]);
	/** Suggested for the merchant a rule sets */
	let merchantNames = $state<string[]>([]);

	let busy = $state(false);
	let error = $state<string>();
	/** What the last action did, shown until the next one */
	let notice = $state<string>();
	let report = $state<ProcessingReport>();
	let reportTitle = $state("");
	let reportOpen = $state(false);

	// The sample transaction: rules can be tried on it, and its values are shown next to the fields
	let sampleAccountId = $state(String(searchParams.get("accountId") ?? ""));
	let sampleBankId = $state(String(searchParams.get("bankId") ?? ""));
	let sample = $state<Record<string, unknown>>();
	let sampleError = $state<string>();

	/** Rules that are folded to one line */
	const collapsed = new SvelteSet<RuleDraft>();

	const hasUnsavedEdits = $derived(JSON.stringify(rules) !== savedJson);
	const reportBlocksApply = $derived(report?.errors.some((failure) => failure.error.stage === "rules") ?? false);

	function setRules(loaded: RuleDraft[]) {
		rules = loaded.map(({ id, name, enabled, txTypes: types, conditions, set }) => ({
			id,
			name,
			enabled,
			txTypes: types,
			conditions,
			set,
		}));
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		error = undefined;
		notice = undefined;

		try {
			await action();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	const load = () =>
		run(async () => {
			const state = await loadRules();
			setRules(state.rules);
			savedJson = JSON.stringify(rules);
			// With several rules the list reads better folded; one being edited gets unfolded by hand
			collapsed.clear();
			if (rules.length > 1) for (const rule of rules) collapsed.add(rule);
			({ txTypes, fieldsByTxType, appliedRevisionId, hasUnappliedChanges } = state);
			revisions = await loadRuleRevisions();
		});

	const save = () =>
		run(async () => {
			await saveRules(rules);
			await load();
			notice = "Draft saved. It takes effect once it is applied.";
		});

	const preview = (only?: { accountId: number; bankId: string }) =>
		run(async () => {
			report = await previewRules(rules, only);
			reportTitle = only ? `Rules against ${only.bankId}` : "Changes the rules would make";
			reportOpen = true;
		});

	const apply = () =>
		run(async () => {
			await saveRules(rules);
			const applied = await applyRules();
			reportOpen = false;
			await load();
			notice = `Rules applied: ${applied.changes.length} transaction(s) changed.`;
		});

	const loadRevision = (id: string) =>
		run(async () => {
			setRules((await loadRuleRevision(id)).rules);
		});

	function addRule() {
		// Starts from the sample transaction, if there is one: its type, and its text to match on.
		// Payments carry that text in the address (their title is a reference number), the rest in the title.
		const type = sample && getTextByPath(sample, "$type");
		const textPath = sample && getTextByPath(sample, "details.address") ? "details.address" : "details.title";
		const text = sample && getTextByPath(sample, textPath);

		rules.push({
			name: "New rule",
			enabled: true,
			txTypes: type ? [type] : null,
			conditions: text ? [{ path: textPath, operator: "contains", pattern: text }] : [],
			set: {},
		});
	}

	async function loadSample() {
		sample = undefined;
		sampleError = undefined;
		if (!sampleAccountId || !sampleBankId.trim()) return;

		try {
			const { parsed } = await loadRawTransaction(sampleAccountId, sampleBankId.trim());
			if (parsed) sample = parsed;
			else sampleError = "This one is a hold or could not be parsed, so rules never see it.";
		} catch (e) {
			sampleError = String(e);
		}
	}

	const sampleKey = () => ({ accountId: Number(sampleAccountId), bankId: sampleBankId.trim() });

	const targetOnFocus =
		(target: Omit<FieldTarget, "element">) => (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
			fieldTarget = { ...target, element: event.currentTarget };
		};

	/** The focus ring of an input, for the one fields go into while the focus is elsewhere */
	const targetClass = (rule: RuleDraft, owner: FieldTarget["owner"], part: FieldTarget["part"]) =>
		fieldTarget?.rule === rule && fieldTarget.owner === owner && fieldTarget.part === part
			? "border-ring ring-3 ring-ring/50"
			: "";

	const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

	/** One line that says what a rule does, for when it is folded */
	function summarize(rule: RuleDraft) {
		const conditions = rule.conditions.map((c) => `${c.path} ${c.operator} "${c.pattern}"`).join(" and ");
		const sets = Object.entries(rule.set)
			.map(([field, template]) => `${field} = "${template}"`)
			.join(", ");

		return `${conditions || "always"} → ${sets || "sets nothing"}`;
	}

	function move(index: number, by: -1 | 1) {
		const [rule] = rules.splice(index, 1);
		if (rule) rules.splice(index + by, 0, rule);
	}

	function toggleTxType(rule: RuleDraft, txType: string) {
		const selected = new Set(rule.txTypes ?? []);
		if (selected.has(txType)) selected.delete(txType);
		else selected.add(txType);
		rule.txTypes = selected.size ? [...selected] : null;
	}

	function setTemplate(rule: RuleDraft, field: (typeof fields)[number]["key"], template: string) {
		// An empty template means the rule does not set the field, not that it sets it to nothing
		if (template === "") delete rule.set[field];
		else rule.set[field] = template;
	}

	/** The fields a rule can read: those of its transaction types, or of all types if it has none */
	function fieldsFor(rule: RuleDraft): Field[] {
		const types = rule.txTypes ?? txTypes;
		const fieldsOf = (txType: string) => fieldsByTxType[txType] ?? [];
		const byPath = new Map<string, Field>();

		for (const field of types.flatMap(fieldsOf)) {
			const known = byPath.get(field.path);
			byPath.set(field.path, { ...field, optional: field.optional || (known?.optional ?? false) });
		}

		return [...byPath.values()]
			// The type of the transaction is not picked as a field, it has the picker above the conditions
			.filter((field) => field.path !== "$type")
			.map((field) => ({
				...field,
				// A field that one of the types lacks is not always there either
				optional: field.optional || types.some((txType) => !fieldsOf(txType).some((f) => f.path === field.path)),
			}))
			.toSorted((a, b) => a.path.localeCompare(b.path));
	}

	function insertField(rule: RuleDraft, path: string) {
		const target = fieldTarget?.rule === rule ? fieldTarget : undefined;

		if (!target) {
			rule.conditions.push({ path, operator: "contains", pattern: "" });
			return;
		}

		const text = target.textFor(path);
		if (!text) return;

		if (target.replaces) {
			target.write(text);
			return;
		}

		const { element } = target;
		// An input that lost the focus has no caret to speak of, so the text goes to its end
		const focused = document.activeElement === element;
		const start = (focused ? element.selectionStart : null) ?? element.value.length;
		const end = (focused ? element.selectionEnd : null) ?? element.value.length;

		target.write(element.value.slice(0, start) + text + element.value.slice(end));

		// The new value reaches the input with the next render, only then can the caret go behind the text
		if (focused) {
			void tick().then(() => element.setSelectionRange(start + text.length, start + text.length));
		}
	}

	function exportRules() {
		const url = URL.createObjectURL(new Blob([JSON.stringify(rules, null, "\t")], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "bank-scraper-rules.json";
		link.click();
		URL.revokeObjectURL(url);
	}

	async function importRules(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;

		try {
			// The server validates the rules on save, so a wrong file shows up there
			rules = JSON.parse(await file.text());
			error = undefined;
		} catch (e) {
			error = `Could not read ${file.name}: ${String(e)}`;
		} finally {
			input.value = "";
		}
	}

	void load();
	void loadSample();
	void loadAccounts().then((loaded) => (accounts = loaded));
	void loadMerchants().then((loaded) => {
		// A deleted merchant is no suggestion: a rule that sets its name leaves the transaction without one
		merchantNames = loaded.filter((merchant) => !merchant.deletedAt).map((merchant) => merchant.name);
	});
</script>

<datalist id="merchant-names">
	{#each merchantNames as name (name)}
		<option value={name}></option>
	{/each}
</datalist>

<div class="flex flex-wrap items-center justify-between gap-2">
	<h1 class="flex items-center gap-2 text-xl font-semibold">
		Rules
		{#if hasUnsavedEdits}
			<Badge variant="outline">unsaved edits</Badge>
		{:else if hasUnappliedChanges}
			<Badge variant="outline">saved, not applied</Badge>
		{/if}
	</h1>
	<span class="flex flex-wrap gap-2">
		<Button variant="outline" size="sm" onclick={exportRules}>Export</Button>
		<Button variant="outline" size="sm" onclick={() => document.getElementById("import-rules")?.click()}>
			Import
		</Button>
		<input id="import-rules" type="file" accept="application/json" class="hidden" onchange={importRules} />
		<Button variant="outline" size="sm" disabled={busy || !hasUnsavedEdits} onclick={save}>Save draft</Button>
		<Button size="sm" disabled={busy} onclick={() => preview()}>Preview changes</Button>
	</span>
</div>

<p class="text-sm text-muted-foreground">
	For every field of a transaction, the first enabled rule from the top that matches and sets that
	field wins; fields no rule sets keep the value the code derives. Conditions and templates read the
	parsed bank transaction: a template can use <code>{"{path}"}</code> for one of its fields, e.g.
	<code>{"{details.title}"}</code>, and
	<code>{"{match.1}"}</code> for a capture group of the rule's first regex condition. Rules take
	effect when they are applied, after a preview.
</p>

{#if error}
	<p class="whitespace-pre-wrap text-sm text-destructive">{error}</p>
{/if}
{#if notice}
	<p class="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">{notice}</p>
{/if}

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">Sample transaction</Card.Title>
		<Card.Description>
			Pick a transaction to see its values next to the fields below, which rules match it, and what
			the rules in the editor would make of it. Its bank id is on its page.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		<div class="flex flex-wrap items-center gap-3">
			<AccountSelect bind:value={sampleAccountId} {accounts} />
			<Input class="max-w-xs font-mono" placeholder="Bank id" bind:value={sampleBankId} />
			<Button variant="outline" disabled={!sampleAccountId || !sampleBankId.trim()} onclick={loadSample}>
				Load
			</Button>
			<Button disabled={busy || !sample} onclick={() => preview(sampleKey())}>Try the rules on it</Button>
		</div>

		{#if sampleError}
			<p class="text-sm text-destructive">{sampleError}</p>
		{:else if sample}
			<p class="text-sm">
				<Badge variant="secondary">{getTextByPath(sample, "$type")}</Badge>
				{getTextByPath(sample, "details.address") ?? getTextByPath(sample, "details.title") ?? getTextByPath(sample, "title")}
				<span class="tabular-nums text-muted-foreground">
					{getTextByPath(sample, "money.amount")}
					{getTextByPath(sample, "money.currency")}
				</span>
			</p>
		{/if}
	</Card.Content>
</Card.Root>

{#each rules as rule, index (rule)}
	{@const ruleFields = fieldsFor(rule)}
	{@const captures = sample && matchRule(rule, sample)}

	<datalist id="fields-{index}">
		{#each ruleFields as field (field.path)}
			<option value={field.path}>{field.type}{field.optional ? ", optional" : ""}</option>
		{/each}
	</datalist>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex flex-wrap items-center gap-3">
				<button
					type="button"
					class="w-6 text-left text-muted-foreground"
					aria-label={collapsed.has(rule) ? "Unfold rule" : "Fold rule"}
					onclick={() => (collapsed.has(rule) ? collapsed.delete(rule) : collapsed.add(rule))}
				>
					{collapsed.has(rule) ? "▸" : "▾"}
				</button>
				<span class="tabular-nums text-muted-foreground">{index + 1}</span>
				<Input class="max-w-sm" bind:value={rule.name} aria-label="Rule name" />
				{#if sample}
					{#if captures}
						<Badge>matches the sample</Badge>
					{:else}
						<Badge variant="outline">no match</Badge>
					{/if}
				{/if}
				<span class="flex items-center gap-2 text-sm font-normal">
					<Switch id="enabled-{index}" bind:checked={rule.enabled} />
					<Label for="enabled-{index}">Enabled</Label>
				</span>
				<span class="ml-auto flex gap-2">
					<Button variant="outline" size="sm" disabled={index === 0} onclick={() => move(index, -1)}>Up</Button>
					<Button variant="outline" size="sm" disabled={index === rules.length - 1} onclick={() => move(index, 1)}>
						Down
					</Button>
					<Button variant="destructive" size="sm" onclick={() => rules.splice(index, 1)}>Delete</Button>
				</span>
			</Card.Title>
			{#if collapsed.has(rule)}
				<Card.Description class="flex items-center gap-2 text-xs">
					{#each rule.txTypes ?? [] as txType (txType)}
						<Badge variant="secondary">{txType}</Badge>
					{:else}
						<Badge variant="outline">all types</Badge>
					{/each}
					<span class="truncate font-mono">{summarize(rule)}</span>
				</Card.Description>
			{/if}
		</Card.Header>

		{#if !collapsed.has(rule)}
		<Card.Content class="space-y-4">
			<div class="space-y-2">
				<Label>Transaction types <span class="font-normal text-muted-foreground">(none selected = all)</span></Label>
				<div class="flex flex-wrap gap-2">
					{#each txTypes as txType (txType)}
						<button type="button" onclick={() => toggleTxType(rule, txType)}>
							<Badge variant={rule.txTypes?.includes(txType) ? "default" : "outline"}>{txType}</Badge>
						</button>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<Label>Conditions <span class="font-normal text-muted-foreground">(all must match)</span></Label>
				{#each rule.conditions as condition, conditionIndex (condition)}
					<div class="flex flex-wrap gap-2">
						<Input
							class="max-w-xs font-mono {targetClass(rule, condition, 'path')}"
							placeholder="details.address"
							list="fields-{index}"
							bind:value={condition.path}
							onfocus={targetOnFocus({
								rule,
								owner: condition,
								part: "path",
								textFor: (path) => path,
								replaces: true,
								write: (path) => (condition.path = path),
							})}
						/>
						<select bind:value={condition.operator} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
							{#each operators as operator (operator)}
								<option value={operator}>{operator}</option>
							{/each}
						</select>
						<Input
							class="max-w-md flex-1 font-mono {targetClass(rule, condition, 'pattern')}"
							placeholder="^BOLT\.EU/P/(\d+)"
							bind:value={condition.pattern}
							onfocus={targetOnFocus({
								rule,
								owner: condition,
								part: "pattern",
								textFor: (path) => {
									const value = sample && getTextByPath(sample, path);
									return value && condition.operator === "regex" ? escapeRegex(value) : value;
								},
								replaces: false,
								write: (pattern) => (condition.pattern = pattern),
							})}
						/>
						{#if sample}
							{@const holds = matchRule({ txTypes: null, conditions: [condition] }, sample)}
							<span
								class="self-center text-xs {holds ? 'text-green-700 dark:text-green-400' : 'text-destructive'}"
								title="Against the sample transaction"
							>
								{holds ? "✓ holds" : "✗ fails"}
							</span>
						{/if}
						<Button variant="outline" size="sm" onclick={() => rule.conditions.splice(conditionIndex, 1)}>
							Remove
						</Button>
					</div>
				{/each}
				<Button
					variant="outline"
					size="sm"
					onclick={() => rule.conditions.push({ path: "", operator: "contains", pattern: "" })}
				>
					Add condition
				</Button>
			</div>

			<div class="grid gap-3 md:grid-cols-3">
				{#each fields as field (field.key)}
					<div class="space-y-1">
						<Label for="{field.key}-{index}">{field.label}</Label>
						<Input
							id="{field.key}-{index}"
							class="font-mono {targetClass(rule, field.key, 'template')}"
							list={field.key === "merchant" ? "merchant-names" : undefined}
							placeholder={field.placeholder}
							value={rule.set[field.key] ?? ""}
							oninput={(event) => setTemplate(rule, field.key, event.currentTarget.value)}
							onfocus={targetOnFocus({
								rule,
								owner: field.key,
								part: "template",
								textFor: (path) => `{${path}}`,
								replaces: false,
								write: (template) => setTemplate(rule, field.key, template),
							})}
						/>
						{#if sample && captures && rule.set[field.key] !== undefined}
							<p class="truncate text-xs text-muted-foreground" title="For the sample transaction">
								→ {renderTemplate(rule.set[field.key] ?? "", sample, captures) || "(empty)"}
							</p>
						{/if}
					</div>
				{/each}
			</div>

			<details class="text-sm" open={Boolean(sample)}>
				<summary class="cursor-pointer text-muted-foreground">
					Fields of the parsed bank transaction ({ruleFields.length})
				</summary>
				<p class="py-2 text-xs text-muted-foreground">
					Click a field to put it into the input you used last, which stays outlined: its name into the
					field of a condition, its value in the sample transaction into the pattern of a condition, and
					a placeholder for it into a template. A field marked with
					<code class="text-amber-700 dark:text-amber-300">?</code> is not always there.
					{#if sample}
						The values are those of the sample transaction.
					{:else}
						Values show up once a sample transaction is loaded.
					{/if}
				</p>
				<div class="grid grid-cols-[max-content_max-content_minmax(0,1fr)] gap-x-4 text-xs">
					<div class="col-span-full grid grid-cols-subgrid border-b px-2 py-1 font-medium text-muted-foreground">
						<span>Field</span>
						<span>Type</span>
						<span>Value in the sample</span>
					</div>
					{#each ruleFields as field (field.path)}
						{@const value = sample && getTextByPath(sample, field.path)}
						<!-- Without the default of mousedown the click leaves the focus, and with it the caret, in the input -->
						<button
							type="button"
							class="col-span-full grid cursor-pointer grid-cols-subgrid items-baseline rounded px-2 py-1 text-left even:bg-muted/40 hover:bg-muted"
							onmousedown={(event) => event.preventDefault()}
							onclick={() => insertField(rule, field.path)}
						>
							<span class="font-mono text-blue-700 dark:text-blue-300">
								{field.path}{#if field.optional}<span class="text-amber-700 dark:text-amber-300">?</span>{/if}
							</span>
							<span class="text-muted-foreground">{field.type}</span>
							{#if !sample}
								<span></span>
							{:else if value === undefined}
								<span class="italic text-muted-foreground">not there</span>
							{:else if value === ""}
								<span class="italic text-muted-foreground">(empty)</span>
							{:else}
								<span class="truncate text-emerald-700 dark:text-emerald-300" title={value}>{value}</span>
							{/if}
						</button>
					{/each}
				</div>
			</details>
		</Card.Content>
		{/if}
	</Card.Root>
{/each}

<Button variant="outline" onclick={addRule}>Add rule</Button>

<h2 class="pt-4 text-lg font-semibold">Applied revisions</h2>

{#if revisions.length === 0}
	<p class="text-sm text-muted-foreground">No rules were applied yet.</p>
{/if}

<ul class="divide-y rounded-md border text-sm">
	{#each revisions as revision (revision.id)}
		<li class="flex flex-wrap items-center gap-3 px-3 py-2">
			<span>{formatInstant(revision.createdAt)}</span>
			<span class="text-muted-foreground">{revision.ruleCount} rule(s)</span>
			<span class="font-mono text-xs text-muted-foreground">{revision.id}</span>
			{#if revision.id === appliedRevisionId}
				<Badge variant="secondary">in effect</Badge>
			{/if}
			<Button class="ml-auto" variant="outline" size="sm" disabled={busy} onclick={() => loadRevision(revision.id)}>
				Load into editor
			</Button>
		</li>
	{/each}
</ul>

<Dialog.Root bind:open={reportOpen}>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-3xl"
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{reportTitle}</Dialog.Title>
			<Dialog.Description>
				This is a preview of the rules in the editor. Applying saves them, makes them a new revision and
				reprocesses every transaction.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
		{#if report}
			<ReportView {report} />

			{#if reportBlocksApply}
				<p class="text-sm text-destructive">
					The rules produce values their fields cannot hold, so they cannot be applied.
				</p>
			{/if}
		{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (reportOpen = false)}>Close</Button>
			<Button disabled={busy || reportBlocksApply} onclick={apply}>Apply rules</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
