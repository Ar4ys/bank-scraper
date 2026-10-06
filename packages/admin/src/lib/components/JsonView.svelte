<script lang="ts">
	import type { ClassValue } from "svelte/elements";

	import { type JsonTokenKind, tokenizeJson } from "$lib/jsonTokens";

	let { value, class: className }: { value: unknown; class?: ClassValue } = $props();

	const colors: Record<JsonTokenKind, string> = {
		key: "text-blue-700 dark:text-blue-300",
		string: "text-emerald-700 dark:text-emerald-300",
		number: "text-amber-700 dark:text-amber-300",
		literal: "text-fuchsia-700 dark:text-fuchsia-300",
		punctuation: "text-muted-foreground",
	};

	const tokens = $derived(tokenizeJson(JSON.stringify(value, null, 2)));
</script>

<pre class={["overflow-x-auto rounded-md border p-3 text-xs", className]}>{#each tokens as token, index (index)}<span
			class={colors[token.kind]}>{token.text}</span
		>{/each}</pre>
