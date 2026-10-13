/**
 * Trigger specification: which key combination arms the merge mode, and how.
 *
 * WHY COMBINATIONS RATHER THAN SINGLE MODIFIERS
 * --------------------------------------------
 * Single modifiers are the worst possible choice here, because Canvas and the OS
 * already use them during a drag:
 *   - Alt / Shift / Ctrl combined with a drag are conventional "modify the drag"
 *     gestures (duplicate, constrain, multi-select), so arming a mode on them
 *     fights whatever the Canvas is already doing with the same chord;
 *   - CapsLock is an OS-level toggle and several Chinese IMEs claim it, so the
 *     event may never arrive;
 *   - Tab auto-repeats and moves focus, so it has to be swallowed, which costs
 *     Canvas keyboard navigation.
 *
 * A combination like `Ctrl+Shift+M` has none of those problems: nothing else
 * uses it, no IME claims it, it does not auto-repeat, and it has no default
 * action to fight.
 */

/** How the trigger key arms the mode. */
export type TriggerMode = "hold" | "toggle";

/** A selectable trigger combination. */
export interface TriggerOption {
	/** Canonical combo string, e.g. `"Ctrl+Shift+M"`. */
	value: string;
	/** Label shown in the dropdown. */
	label: string;
}

/**
 * Trigger combinations offered in settings, best first.
 *
 * The single modifiers are kept because they were asked for, but they are the
 * riskiest entries: Canvas and the OS already use modifier+drag for duplicate /
 * constrain / multi-select, and several Chinese IMEs claim Shift. The labels say
 * so rather than hiding it.
 */
export const TRIGGER_KEY_OPTIONS: TriggerOption[] = [
	{ value: "Ctrl+Shift+M", label: "Ctrl + Shift + M（推荐，无冲突）" },
	{ value: "Ctrl+Alt+M", label: "Ctrl + Alt + M" },
	{ value: "Alt+Shift+M", label: "Alt + Shift + M" },
	{ value: "Alt", label: "Alt（可能和画布拖拽修饰冲突）" },
	{ value: "Control", label: "Ctrl（可能和画布拖拽修饰冲突）" },
	{ value: "Shift", label: "Shift（可能和画布/输入法冲突）" },
	{ value: "CapsLock", label: "CapsLock（可能被输入法占用）" },
	{ value: "Tab", label: "Tab（会占用画布里的 Tab 导航）" },
];

/** Default trigger: conflict-free and IME-proof. */
const DEFAULT_TRIGGER = "Ctrl+Shift+M";

/** Exposed so settings can show the same default. */
export const DEFAULT_TRIGGER_KEY = DEFAULT_TRIGGER;

/** Main keys that also have a default browser action worth swallowing. */
const KEYS_WITH_DEFAULT_ACTION = new Set(["Tab", " ", "Space"]);

/** Maps a modifier token to the `KeyboardEvent` flag it requires. */
const MODIFIER_FLAGS = {
	ctrl: "ctrlKey",
	alt: "altKey",
	shift: "shiftKey",
	meta: "metaKey",
} as const;

/** A parsed trigger combination. */
export interface TriggerSpec {
	/** The original combo string, for logging. */
	raw: string;
	/** The non-modifier key, compared against `KeyboardEvent.key`. */
	key: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
}

/**
 * Reports whether a value is one of the offered trigger combinations.
 *
 * @param value - Candidate value.
 * @returns True when the value appears in {@link TRIGGER_KEY_OPTIONS}.
 */
export function isKnownTriggerKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		TRIGGER_KEY_OPTIONS.some((option) => option.value === value)
	);
}

/**
 * Parses a combo string into a spec.
 *
 * The last `+`-separated token is the main key; the rest are required
 * modifiers. `Ctrl` and `Control` are treated as the same modifier.
 *
 * @param raw - Combo string, e.g. `"Ctrl+Shift+M"` or `"CapsLock"`.
 * @returns The parsed spec.
 */
export function parseTrigger(raw: string): TriggerSpec {
	const parts = raw
		.split("+")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

	// A single token is a bare key with no modifier requirements.
	if (parts.length <= 1) {
		return {
			raw,
			key: parts[0] ?? raw,
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
		};
	}

	const key = parts[parts.length - 1];
	const spec: TriggerSpec = {
		raw,
		key,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
	};
	for (const part of parts.slice(0, -1)) {
		const lower = part.toLowerCase();
		if (lower === "ctrl" || lower === "control") spec.ctrl = true;
		else if (lower === "alt") spec.alt = true;
		else if (lower === "shift") spec.shift = true;
		else if (lower === "meta" || lower === "cmd") spec.meta = true;
	}
	return spec;
}

/**
 * Compares two key names, case-insensitively for single characters.
 *
 * `Ctrl+Shift+M` reports `key === "M"` (capitalised because Shift is down), so a
 * strict comparison against `"m"` would never match.
 *
 * @param actual - `KeyboardEvent.key`.
 * @param expected - Key name from the spec.
 * @returns True when they denote the same key.
 */
function keysEqual(actual: string, expected: string): boolean {
	if (actual === expected) return true;
	if (actual.length === 1 && expected.length === 1) {
		return actual.toLowerCase() === expected.toLowerCase();
	}
	return false;
}

/** Main keys that are themselves modifiers, reported via `KeyboardEvent.key`. */
const MODIFIER_KEY_NAMES = new Set(["Control", "Alt", "Shift", "Meta"]);

/**
 * Reports whether a key event matches the trigger spec.
 *
 * Two shapes are supported:
 *
 *   - **bare modifier** (`"Alt"`): matches when that key is the one pressed and
 *     no *other* modifier is down. A bare modifier is never reported through the
 *     `*Key` flags in a way that could be compared exactly, so it needs its own
 *     branch -- evaluating `"Alt"` as "requires altKey === false" would mean it
 *     could never match at all.
 *   - **key + modifiers** (`"Ctrl+Shift+M"`): modifier state must match
 *     exactly, so `Ctrl+M` does not arm a `Ctrl+Shift+M` trigger.
 *
 * @param event - The key event.
 * @param spec - Parsed trigger.
 * @returns True when this event is the trigger.
 */
export function matchesTrigger(
	event: KeyboardEvent,
	spec: TriggerSpec
): boolean {
	if (MODIFIER_KEY_NAMES.has(spec.key)) {
		if (!keysEqual(event.key, spec.key)) return false;
		const pressed: Array<[string, boolean]> = [
			["Control", event.ctrlKey],
			["Alt", event.altKey],
			["Shift", event.shiftKey],
			["Meta", event.metaKey],
		];
		// The key itself is allowed to be down; anything else is not.
		return pressed.every(
			([name, isDown]) => !isDown || keysEqual(spec.key, name)
		);
	}

	for (const [flag, property] of Object.entries(MODIFIER_FLAGS)) {
		const required = spec[flag as keyof typeof MODIFIER_FLAGS];
		if (event[property] !== required) return false;
	}
	return keysEqual(event.key, spec.key);
}

/**
 * Reports whether the trigger key has a default action worth suppressing.
 *
 * Only Tab (and Space) do. For those, leaving the default alone means the focus
 * ricochets through the UI for as long as the key is held, which makes the
 * hold gesture unusable.
 *
 * @param spec - Parsed trigger.
 * @returns True when `preventDefault()` should be called.
 */
export function hasDefaultAction(spec: TriggerSpec): boolean {
	return KEYS_WITH_DEFAULT_ACTION.has(spec.key);
}

/**
 * Reports whether a value is a recognised trigger mode.
 *
 * @param value - Candidate value.
 * @returns True for `"hold"` or `"toggle"`.
 */
export function isTriggerMode(value: unknown): value is TriggerMode {
	return value === "hold" || value === "toggle";
}
