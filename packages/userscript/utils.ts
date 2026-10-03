import "./global";

type OnlyMethods<T> = {
	[K in keyof T as T[K] extends (...args: any) => any ? K : never]: T[K];
};

export function asyncSpyOn<T extends Record<any, any>, K extends keyof OnlyMethods<T>>(
	obj: T,
	method: K,
	spy: (args: Parameters<T[K]>, result: Awaited<ReturnType<T[K]>>) => void,
) {
	const orig = obj[method];
	obj[method] = exportFunction(
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		((...args: Parameters<T[K]>) => {
			return new unsafeWindow.Promise(
				exportFunction(async (res, rej) => {
					try {
						const result: Awaited<ReturnType<T[K]>> = await orig(...args);

						try {
							await Promise.try(() => spy(args, result));
						} catch (e) {
							console.error("Failed spy:", e);
						}

						res(result);
					} catch (e) {
						rej(e);
					}
				}, unsafeWindow),
			);
		}) as T[K],
		unsafeWindow,
	);
}

export function defer(cb: () => void): Disposable {
	const disposer = new DisposableStack();
	disposer.defer(cb);
	return disposer.move();
}

export function deferAsync(cb: () => void | Promise<void>): AsyncDisposable {
	const disposer = new AsyncDisposableStack();
	disposer.defer(cb);
	return disposer.move();
}
