<script lang="ts">
	import {
		applyRules,
		loadAccounts,
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
	let report = $state<ProcessingReport>();
	let reportTitle = $state("");
	let reportOpen = $state(false);

	let testAccountId = $state("");
	let testBankId = $state("");

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
			({ txTypes, fieldsByTxType, appliedRevisionId, hasUnappliedChanges } = state);
			revisions = await loadRuleRevisions();
		});

	const save = () =>
		run(async () => {
			await saveRules(rules);
			await load();
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
			await applyRules();
			reportOpen = false;
			await load();
		});

	const loadRevision = (id: string) =>
		run(async () => {
			setRules((await loadRuleRevision(id)).rules);
		});

	function addRule() {
		rules.push({ name: "New rule", enabled: true, txTypes: null, conditions: [], set: {} });
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

<Card.Root>
	<Card.Content class="flex flex-wrap items-end gap-3">
		<div class="space-y-1">
			<Label>Try the rules on one transaction</Label>
			<AccountSelect bind:value={testAccountId} {accounts} />
		</div>
		<Input class="max-w-xs" placeholder="Bank id" bind:value={testBankId} />
		<Button
			variant="outline"
			disabled={busy || !testAccountId || !testBankId.trim()}
			onclick={() => preview({ accountId: Number(testAccountId), bankId: testBankId.trim() })}
		>
			Try
		</Button>
	</Card.Content>
</Card.Root>

{#each rules as rule, index (rule)}
	{@const ruleFields = fieldsFor(rule)}

	<datalist id="fields-{index}">
		{#each ruleFields as field (field.path)}
			<option value={field.path}>{field.type}{field.optional ? ", optional" : ""}</option>
		{/each}
	</datalist>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex flex-wrap items-center gap-3">
				<span class="tabular-nums text-muted-foreground">{index + 1}</span>
				<Input class="max-w-sm" bind:value={rule.name} aria-label="Rule name" />
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
		</Card.Header>

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
							placeholder="details.title"
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
					</div>
				{/each}
			</div>

			<details class="text-sm">
				<summary class="cursor-pointer text-muted-foreground">
					Fields of the parsed bank transaction ({ruleFields.length})
				</summary>
				<p class="py-2 text-xs text-muted-foreground">
					Click a field to put it into the condition or template you used last. A field marked with
					<code>?</code> is not always there.
				</p>
				<div class="flex flex-wrap gap-1">
					{#each ruleFields as field (field.path)}
						<button
							type="button"
							class="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-muted"
							title="{field.type}{field.optional ? ', optional' : ''}"
							onclick={() => insertField(rule, field.path)}
						>
							{field.path}{field.optional ? "?" : ""}
							<span class="text-muted-foreground">{field.type}</span>
						</button>
					{/each}
				</div>
			</details>
		</Card.Content>
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
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>{reportTitle}</Dialog.Title>
			<Dialog.Description>
				This is a preview of the rules in the editor. Applying saves them, makes them a new revision and
				reprocesses every transaction.
			</Dialog.Description>
		</Dialog.Header>

		{#if report}
			<ReportView {report} />

			{#if reportBlocksApply}
				<p class="text-sm text-destructive">
					The rules produce values their fields cannot hold, so they cannot be applied.
				</p>
			{/if}
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (reportOpen = false)}>Close</Button>
			<Button disabled={busy || reportBlocksApply} onclick={apply}>Apply rules</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
