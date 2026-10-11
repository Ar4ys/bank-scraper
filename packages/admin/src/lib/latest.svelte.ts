/**
 * Loads a value again whenever the state that `load` reads changes, and keeps the value it had
 * until the new one arrives, so that what shows it does not go blank in between.
 *
 * Has to be called while a component is being set up. `value` is `undefined` until the first load
 * ends. A load that a newer one overtook is ignored.
 */
export function latest<T>(load: () => Promise<T>) {
	let value = $state.raw<T>();
	let loading = $state(true);
	let error = $state<string>();

	$effect(() => {
		let outdated = false;
		loading = true;

		load().then(
			(loaded) => {
				if (outdated) return;
				value = loaded;
				error = undefined;
				loading = false;
			},
			(reason: unknown) => {
				if (outdated) return;
				error = String(reason);
				loading = false;
			},
		);

		return () => {
			outdated = true;
		};
	});

	return {
		get value() {
			return value;
		},
		get loading() {
			return loading;
		},
		/** Why the last load failed. `value` is still the one loaded before it. */
		get error() {
			return error;
		},
	};
}
