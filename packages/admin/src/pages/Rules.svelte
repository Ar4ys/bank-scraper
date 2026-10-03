<script lang="ts">
	import { getTextByPath, matchRule, renderTemplate } from "@bank-scraper/shared";
	import { searchParams } from "sv-router";
	import { SvelteSet } from "svelte/reactivity";

	import {
		applyRules,
		loadAccounts,
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
	let fieldTarget = $state<{ rule: RuleDraft; insert: (path: string) => void }>();
	let appliedRevisionId = $state<string | null>(null);
	let hasUnappliedChanges = $state(false);
	/** The rules as last loaded from or saved to the server, to tell whether the editor has edits */
	let savedJson = $state("[]");
	let revisions = $state<RuleRevisionSummary[]>([]);
	let accounts = $state<Account[]>([]);

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
			.map((field) => ({
				...field,
				// A field that one of the types lacks is not always there either
				optional: field.optional || types.some((txType) => !fieldsOf(txType).some((f) => f.path === field.path)),
			}))
			.toSorted((a, b) => a.path.localeCompare(b.path));
	}

	function insertField(rule: RuleDraft, path: string) {
		if (fieldTarget?.rule === rule) fieldTarget.insert(path);
		else rule.conditions.push({ path, operator: "contains", pattern: "" });
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
</script>

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
				<Card.Description class="truncate font-mono text-xs">{summarize(rule)}</Card.Description>
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
							class="max-w-xs font-mono"
							placeholder="details.address"
							list="fields-{index}"
							bind:value={condition.path}
							onfocus={() => (fieldTarget = { rule, insert: (path) => (condition.path = path) })}
						/>
						<select bind:value={condition.operator} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
							{#each operators as operator (operator)}
								<option value={operator}>{operator}</option>
							{/each}
						</select>
						<Input class="max-w-md flex-1 font-mono" placeholder="^BOLT\.EU/P/(\d+)" bind:value={condition.pattern} />
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
							class="font-mono"
							placeholder={field.placeholder}
							value={rule.set[field.key] ?? ""}
							oninput={(event) => setTemplate(rule, field.key, event.currentTarget.value)}
							onfocus={() =>
								(fieldTarget = {
									rule,
									insert: (path) => setTemplate(rule, field.key, `${rule.set[field.key] ?? ""}{${path}}`),
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
					Click a field to put it into the condition or template you used last. A field marked with
					<code>?</code> is not always there.
					{#if sample}The values are those of the sample transaction.{/if}
				</p>
				<div class="grid gap-1 sm:grid-cols-2">
					{#each ruleFields as field (field.path)}
						{@const value = sample && getTextByPath(sample, field.path)}
						<button
							type="button"
							class="flex items-baseline gap-2 rounded border px-2 py-1 text-left text-xs hover:bg-muted"
							title="{field.type}{field.optional ? ', optional' : ''}"
							onclick={() => insertField(rule, field.path)}
						>
							<span class="shrink-0 font-mono">{field.path}{field.optional ? "?" : ""}</span>
							{#if sample}
								<span class="truncate {value === undefined ? 'italic text-muted-foreground' : ''}">
									{value === undefined ? "not there" : value || "(empty)"}
								</span>
							{:else}
								<span class="text-muted-foreground">{field.type}</span>
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
