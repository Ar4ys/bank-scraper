export {};

declare global {
	const unsafeWindow: typeof window;

	function exportFunction<T extends (...args: any) => any>(
		fn: T,
		window: Window,
	): T;
}
