<script lang="ts">
	import { Badge, type BadgeVariant } from "$lib/components/ui/badge";

	let { status }: { status: string } = $props();

	const variants: Record<string, BadgeVariant> = {
		processed: "secondary",
		error: "destructive",
		hold: "outline",
		unprocessed: "outline",
		raw: "secondary",
		rules: "default",
		reprocess: "outline",
	};
</script>

<Badge variant={variants[status] ?? "outline"}>{status}</Badge>
