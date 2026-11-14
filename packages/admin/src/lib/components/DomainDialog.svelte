<script lang="ts">
	import { normalizeDomain } from "@bank-scraper/shared";
	import ExternalLink from "@lucide/svelte/icons/external-link";

	import { searchBrands, type BrandSearchResult } from "$lib/brandfetch";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";

	let {
		clientId,
	}: {
		/** `null` while Brandfetch isn't configured: no search and no logos, only typing */
		clientId: string | null;
	} = $props();

	let open = $state(false);
	let merchantName = $state("");
	let value = $state<string | null>(null);
	let onpick: (domain: string | null) => void = () => {};
	let query = $state("");
	let typed = $state("");
	let results = $state<BrandSearchResult[]>([]);
	let searching = $state(false);
	let searchError = $state<string>();
	let typedError = $state<string>();

	/** Opens the dialog for a merchant, searching for its name, with the domain picked so far */
	export function show(
		name: string,
		current: string | null,
		onchoose: (domain: string | null) => void,
	) {
		merchantName = name;
		value = current;
		onpick = onchoose;
		query = name;
		typed = current ?? "";
		results = [];
		searchError = undefined;
		typedError = undefined;
		open = true;
	}

	// Searches when the dialog opens and again when the query changes, after a pause in typing
	$effect(() => {
		if (!open || !clientId) return;
		const text = query.trim();
		if (!text) {
			results = [];
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(async () => {
			searching = true;
			searchError = undefined;
			try {
				results = await searchBrands(clientId, text, controller.signal);
			} catch (e) {
				if (!controller.signal.aborted) searchError = e instanceof Error ? e.message : String(e);
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, 300);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function pick(domain: string | null) {
		onpick(domain);
		open = false;
	}

	function useTyped() {
		const domain = normalizeDomain(typed);
		if (domain === undefined) {
			typedError = `"${typed}" is not a domain such as lidl.pl`;
			return;
		}
		pick(domain);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Domain of "{merchantName}"</Dialog.Title>
			<Dialog.Description>
				Sure shows the merchant's logo from its domain. It takes the domain on its next sync once
				the row is saved.
			</Dialog.Description>
		</Dialog.Header>

		{#if clientId}
			<Input placeholder="Brand" bind:value={query} />

			<div class="min-h-24 flex-1 overflow-y-auto transition-opacity {searching ? 'opacity-50' : ''}">
				{#if searchError}
					<p class="px-2 py-1.5 text-sm text-destructive">{searchError}</p>
				{:else}
					{#each results as result (result.brandId)}
						<div class="flex items-center gap-1 rounded-md pr-1 hover:bg-muted">
							<button
								class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-1.5 text-left text-sm"
								onclick={() => pick(normalizeDomain(result.domain) ?? result.domain)}
							>
								{#if result.icon}
									<img class="size-6 shrink-0 rounded-sm" src={result.icon} alt="" />
								{:else}
									<span class="size-6 shrink-0"></span>
								{/if}
								<span class="min-w-0 flex-1 truncate font-medium">{result.name ?? result.domain}</span>
								<span class="shrink-0 text-muted-foreground">{result.domain}</span>
							</button>
							<a
								class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
								href={`https://${normalizeDomain(result.domain) ?? result.domain}`}
								target="_blank"
								rel="noopener noreferrer"
								title="Open {result.domain} in a new tab"
								aria-label="Open {result.domain} in a new tab"
							>
								<ExternalLink class="size-4" />
							</a>
						</div>
					{:else}
						<p class="px-2 py-1.5 text-sm text-muted-foreground">
							{searching ? "Searching…" : "No brands found"}
						</p>
					{/each}
				{/if}
			</div>
		{/if}

		<form
			class="flex items-start gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				useTyped();
			}}
		>
			<div class="flex-1 space-y-1">
				<Input placeholder="Domain or URL, e.g. lidl.pl" bind:value={typed} />
				{#if typedError}
					<p class="text-sm text-destructive">{typedError}</p>
				{/if}
			</div>
			<Button type="submit" variant="outline">Use</Button>
		</form>

		<Dialog.Footer>
			{#if value}
				<Button variant="ghost" onclick={() => pick(null)}>No domain</Button>
			{/if}
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
