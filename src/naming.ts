/**
 * Drawing-name derivation and vault-safe file sanitising.
 *
 * Ported from the `canvas-to-excalidraw` plugin so both plugins name their
 * output identically. The two plugins are installed independently and share no
 * runtime module, so the small amount of duplication is deliberate -- keeping a
 * second copy beats inventing a shared library for a handful of pure functions.
 *
 * A text card can contain characters that are illegal in a file name
 * (`/ \ : * ? " < > |`), so sanitising is not cosmetic: without it the drawing
 * simply fails to be created. Every illegal character becomes `_`, which keeps
 * the name's original length and stays predictable.
 *
 * A second class of character is legal on disk yet still ruins the result:
 * Obsidian itself warns that "Links will not work with file names containing
 * any of these characters: # ^ [ ] |". This plugin names its output after a
 * source *file*, so the trigger here is a file that is itself named with one of
 * them (`# 计划.md`) -- rarer than the text-card case that motivated the fix in
 * `canvas-to-excalidraw`, but the same defect and the same cure.
 */

/** Illegal in a vault file name on at least one supported platform. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/gu;

/**
 * Characters Obsidian calls unsafe: they break wikilinks pointing at the file.
 *
 * Taken verbatim from Obsidian's own character set (`# ^ [ ] |`). `|` is
 * already covered by {@link ILLEGAL_FILENAME_CHARS}; the rest are legal on
 * disk, which is exactly why they are worth handling -- nothing else will
 * reject them, and the damage only shows up later as a dead link.
 */
const UNSAFE_LINK_CHARS = /[#^\[\]]/gu;

/**
 * A Markdown heading marker at the very start of a name: `#` to `######`
 * followed by the space that Markdown requires.
 *
 * Kept identical to the rule in `canvas-to-excalidraw` so both plugins name
 * their output the same way. Here it fires on a source file literally called
 * `# 计划.md`, which is named `计划` rather than `_ 计划`.
 */
const LEADING_HEADING_MARKER = /^#{1,6}[ \t]+/u;

/** Names Windows refuses to create, with or without an extension. */
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/** Trailing dots and spaces are stripped by Windows; strip them ourselves. */
const TRAILING_DOT_OR_SPACE = /[. ]+$/u;

/** Runs of whitespace collapse to one space. */
const WHITESPACE_RUN = /\s+/gu;

/** A name made only of underscores and spaces carries no information. */
const MEANINGLESS_NAME = /^[_\s]+$/u;

/** How many characters of a text card are used when it names the drawing. */
export const TEXT_NAME_LENGTH = 10;

/** Replacement for every character that cannot appear in a file name. */
export const ILLEGAL_CHAR_REPLACEMENT = "_";

/** Used when a derived name sanitises down to nothing usable. */
export const FALLBACK_NAME = "未命名 Excalidraw";

/**
 * Extension the Excalidraw plugin gives a drawing.
 *
 * `ExcalidrawAutomate.create()` appends `.excalidraw.md` only if the requested
 * name does not already end in `.md`, so any such suffix is stripped first.
 */
export const DRAWING_EXTENSION = ".excalidraw.md";

/** Trailing `.md` that would suppress Excalidraw's own extension. */
const MARKDOWN_SUFFIX = /\.md$/iu;

/** Cap on collision suffixes before falling back to a timestamp. */
const MAX_COLLISION_ATTEMPTS = 200;

/**
 * Collapses all whitespace runs to single spaces and trims the ends.
 *
 * @param raw - Any user-supplied text.
 * @returns Single-line, trimmed text.
 */
export function normalizeWhitespace(raw: string): string {
	return raw.replace(WHITESPACE_RUN, " ").trim();
}

/**
 * Drops a leading Markdown heading marker, if the text has one.
 *
 * @param text - Single-line text, already whitespace-collapsed.
 * @returns The text without its leading `#`…`######` marker.
 */
export function stripLeadingHeadingMarker(text: string): string {
	return text.replace(LEADING_HEADING_MARKER, "");
}

/**
 * Reports whether a candidate is non-empty and not a Windows reserved name.
 *
 * @param name - Candidate name.
 * @returns True when the name may be used as-is.
 */
export function isUsableBaseName(name: string): boolean {
	if (name.length === 0) return false;
	if (name === "." || name === "..") return false;
	return !WINDOWS_RESERVED_NAME.test(name);
}

/**
 * Turns arbitrary text into a file name that is safe on every platform.
 *
 * Whitespace is collapsed **first**: newline and tab are themselves control
 * characters in the illegal range, so replacing them before collapsing would
 * turn a blank card into a row of underscores instead of an empty string. The
 * heading marker is dropped next, so it counts as formatting rather than as a
 * character to replace.
 *
 * @param raw - Candidate name, already trimmed of any extension.
 * @returns A safe, meaningful name, or {@link FALLBACK_NAME} otherwise.
 */
export function sanitizeBaseName(raw: string): string {
	const collapsed = normalizeWhitespace(raw);
	const withoutMarker = stripLeadingHeadingMarker(collapsed);
	const replaced = withoutMarker
		.replace(ILLEGAL_FILENAME_CHARS, ILLEGAL_CHAR_REPLACEMENT)
		.replace(UNSAFE_LINK_CHARS, ILLEGAL_CHAR_REPLACEMENT);
	const trimmed = replaced.replace(TRAILING_DOT_OR_SPACE, "");
	if (!isUsableBaseName(trimmed) || MEANINGLESS_NAME.test(trimmed)) {
		return FALLBACK_NAME;
	}
	return trimmed;
}

/**
 * Derives a drawing name from a file node's vault path.
 *
 * @param vaultPath - Vault-relative path as stored on the Canvas node.
 * @returns The bare file name without its extension.
 */
export function deriveNameFromFilePath(vaultPath: string): string {
	const lastSegment = vaultPath.split("/").pop() ?? vaultPath;
	const lastDot = lastSegment.lastIndexOf(".");
	return lastDot > 0 ? lastSegment.slice(0, lastDot) : lastSegment;
}

/**
 * Produces the final base name to hand to ExcalidrawAutomate's `create()`.
 *
 * @param raw - Unprocessed candidate name.
 * @returns A safe base name without an extension.
 */
export function prepareDrawingBaseName(raw: string): string {
	const sanitized = sanitizeBaseName(raw);
	const withoutMarkdown = sanitized.replace(MARKDOWN_SUFFIX, "");
	return isUsableBaseName(withoutMarkdown) ? withoutMarkdown : FALLBACK_NAME;
}

/**
 * Builds the vault path a base name will occupy once Excalidraw creates it.
 *
 * @param folder - Destination folder, or undefined for the vault root.
 * @param baseName - Extensionless base name.
 * @returns The vault-relative path the drawing would take.
 */
export function buildDrawingPath(
	folder: string | undefined,
	baseName: string
): string {
	const fileName = `${baseName}${DRAWING_EXTENSION}`;
	return folder ? `${folder}/${fileName}` : fileName;
}

/**
 * Appends ` 1`, ` 2`, ... until the name is free.
 *
 * @param baseName - Sanitised base name.
 * @param isTaken - Predicate probing the vault for an existing path.
 * @returns A name for which `isTaken` returns false, or a timestamped fallback.
 */
export function resolveUniqueBaseName(
	baseName: string,
	isTaken: (candidate: string) => boolean
): string {
	if (!isTaken(baseName)) return baseName;
	for (let suffix = 1; suffix <= MAX_COLLISION_ATTEMPTS; suffix += 1) {
		const candidate = `${baseName} ${suffix}`;
		if (!isTaken(candidate)) return candidate;
	}
	return `${baseName} ${Date.now()}`;
}
