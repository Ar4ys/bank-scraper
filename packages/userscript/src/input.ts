/**
 * Whether the sync scrolls, waits and clicks like a person. Off, it waits a flat 0.5 s before each
 * press and scrolls in one smooth go. Hardcoded until there is a setting for it.
 */
export const humanLikeInput = false;

const fastPauseMs = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const uniform = (min: number, max: number) => min + Math.random() * (max - min);

function standardNormal() {
	// Box-Muller; 1 - random() keeps the logarithm away from 0
	return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function whenVisible(): Promise<void> {
	if (document.visibilityState === "visible") return Promise.resolve();

	return new Promise((resolve) => {
		const onChange = () => {
			if (document.visibilityState !== "visible") return;
			document.removeEventListener("visibilitychange", onChange);
			resolve();
		};
		document.addEventListener("visibilitychange", onChange);
	});
}

/**
 * Waits like a person between two actions: log-normal around 1.1 s within 0.6-2.5 s, and about one
 * wait in ten 3-8 s long, as if reading the rows. Also waits for the tab to be visible.
 */
async function humanPause() {
	// Reaction times are skewed: mostly short, with a long tail, which a uniform delay is not
	const ms =
		Math.random() < 0.1
			? uniform(3000, 8000)
			: Math.min(2500, Math.max(600, 1100 * Math.exp(0.35 * standardNormal())));

	await sleep(ms);
	await whenVisible();
}

/** Waits before pressing something */
export const pauseBeforePress = () => (humanLikeInput ? humanPause() : sleep(fastPauseMs));

/** Waits after new rows arrived, as a person reading them would; not at all without human-like input */
export const pauseAfterLoad = () => (humanLikeInput ? humanPause() : Promise.resolve());

function scrollParent(element: Element): Element {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (/auto|scroll/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
	}
	return document.scrollingElement ?? document.documentElement;
}

/** Scrolls until the element is in the lower half of the view, in wheel-sized steps */
async function humanScrollTo(element: Element) {
	const scroller = scrollParent(element);
	const isRoot = scroller === document.scrollingElement || scroller === document.documentElement;
	const view = isRoot
		? { top: 0, height: window.innerHeight }
		: { top: scroller.getBoundingClientRect().top, height: scroller.clientHeight };

	const targetY = view.top + view.height * uniform(0.55, 0.8);

	for (let step = 0; step < 200; step++) {
		const remaining = element.getBoundingClientRect().top - targetY;
		if (Math.abs(remaining) < 60) return;

		const before = scroller.scrollTop;
		scroller.scrollBy({
			top: Math.sign(remaining) * Math.min(Math.abs(remaining), uniform(80, 160)),
		});
		// The end of the page: the element cannot get any closer to the target
		if (scroller.scrollTop === before) return;

		await sleep(uniform(30, 120));
	}
}

/** Brings the element into view: in wheel-sized steps, or in one smooth scroll */
export async function scrollToElement(element: Element) {
	if (humanLikeInput) return await humanScrollTo(element);
	element.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Smoothly scrolls whatever scrolls the element to its bottom, in one go */
export function scrollToBottom(element: Element) {
	const scroller = scrollParent(element);
	scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
}

/**
 * Clicks at a random point near the middle of the element, with the pointer and mouse events a real
 * click fires. They are still untrusted (`isTrusted: false`) like every event a script dispatches.
 */
async function humanClick(element: Element) {
	const rect = element.getBoundingClientRect();
	const position = {
		bubbles: true,
		cancelable: true,
		composed: true,
		view: window,
		clientX: rect.left + rect.width * uniform(0.25, 0.75),
		clientY: rect.top + rect.height * uniform(0.25, 0.75),
		button: 0,
		isPrimary: true,
		pointerId: 1,
		pointerType: "mouse",
	};
	const pressed = { ...position, buttons: 1 };

	element.dispatchEvent(new PointerEvent("pointerover", position));
	element.dispatchEvent(new MouseEvent("mouseover", position));
	element.dispatchEvent(new PointerEvent("pointermove", position));
	element.dispatchEvent(new MouseEvent("mousemove", position));
	await sleep(uniform(80, 250));

	element.dispatchEvent(new PointerEvent("pointerdown", pressed));
	element.dispatchEvent(new MouseEvent("mousedown", pressed));
	if (element instanceof HTMLElement) element.focus({ preventScroll: true });
	await sleep(uniform(60, 140));

	element.dispatchEvent(new PointerEvent("pointerup", position));
	element.dispatchEvent(new MouseEvent("mouseup", position));
	element.dispatchEvent(new MouseEvent("click", position));
}

export async function click(element: Element) {
	if (humanLikeInput) return await humanClick(element);

	if (element instanceof HTMLElement) element.click();
	else
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
		);
}
