<script lang="ts">
	import { reprocess, type ProcessingReport, type ReprocessScope } from "$lib/api";
	import ReportView from "$lib/components/ReportView.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";

	let {
		scope,
		label,
		ondone,
	}: { scope: ReprocessScope; label: string; ondone?: () => void } = $props();

	let open = $state(false);
	let busy = $state(false);
	let preview = $state<ProcessingReport>();
	let error = $state<string>();

	async function run(dryRun: boolean) {
		busy = true;
		error = undefined;

		try {
			const report = await reprocess(scope, dryRun);

			if (dryRun) {
				preview = report;
				open = true;
			} else {
				open = false;
				ondone?.();
			}
		} catch (e) {
			error = String(e);
			open = true;
		} finally {
			busy = false;
		}
	}
</script>

<Button variant="outline" size="sm" disabled={busy} onclick={() => run(true)}>{label}</Button>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>{label}</Dialog.Title>
			<Dialog.Description>
				This is a preview. Nothing is written until you apply it.
			</Dialog.Description>
		</Dialog.Header>

		{#if error}
			<p class="text-sm text-destructive">{error}</p>
		{:else if preview}
			<ReportView report={preview} />
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button disabled={busy || !preview || Boolean(error)} onclick={() => run(false)}>Apply</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
