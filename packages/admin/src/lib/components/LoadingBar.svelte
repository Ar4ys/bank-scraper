<script lang="ts">
	let { loading }: { loading: boolean } = $props();
</script>

<!-- Takes its height whether it loads or not, so that nothing below it moves -->
<div class="h-0.5 overflow-hidden rounded-full" aria-busy={loading}>
	{#if loading}
		<div class="bar h-full w-1/3 rounded-full bg-primary"></div>
	{/if}
</div>

<style>
	.bar {
		opacity: 0;
		/* Shows up late, so that a load that ends right away does not flash it */
		animation:
			slide 1s ease-in-out infinite,
			appear 0s 150ms forwards;
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	@keyframes appear {
		to {
			opacity: 1;
		}
	}
</style>
