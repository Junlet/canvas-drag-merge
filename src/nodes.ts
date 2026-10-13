/**
 * What a Canvas node actually *is*, for merge-rule dispatch.
 *
 * A Canvas node's `type` is only ever `text` / `file` / `link` / `group`. The
 * distinction the merge rules care about -- text card vs image vs Markdown note
 * -- is not in that field: images and notes are both `file` nodes and differ
 * only by the extension of the file they point at.
 */

import type { CanvasNodeData } from "./types";

/** The categories the merge rules dispatch on. */
export type NodeKind = "text" | "image" | "note" | "drawing" | "other";

/** Extensions treated as pictures. */
const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"bmp",
	"avif",
]);

/** Extensions treated as Markdown notes. */
const NOTE_EXTENSIONS = new Set(["md"]);

/** Human-readable labels, for Notices and logs. */
const KIND_LABELS: Record<NodeKind, string> = {
	text: "文本卡片",
	image: "图片",
	note: "md 笔记",
	drawing: "Excalidraw 图纸",
	other: "其他节点",
};

/**
 * Reports whether a vault path is an Excalidraw drawing *by its extension*.
 *
 * An `.excalidraw.md` file is a Markdown file, so it must be told apart from a
 * plain note before anything else -- otherwise a drawing dragged onto a note
 * would have its scene JSON appended as prose.
 *
 * The extension is only a fast path. A drawing the user renamed to a plain
 * `.md` still carries Excalidraw's frontmatter, so callers should combine this
 * with {@link marksDrawing} via a {@link DrawingProbe}.
 *
 * @param vaultPath - Vault-relative path.
 * @returns True for `.excalidraw.md` and the legacy `.excalidraw`.
 */
export function isDrawingPath(vaultPath: string): boolean {
	const lower = vaultPath.toLowerCase();
	return lower.endsWith(".excalidraw.md") || lower.endsWith(".excalidraw");
}

/** Frontmatter key Excalidraw writes into every drawing it creates. */
const EXCALIDRAW_FRONTMATTER_KEY = "excalidraw-plugin";

/** Tag Excalidraw adds to every drawing it creates. */
const EXCALIDRAW_TAG = "excalidraw";

/**
 * Normalises a tag to its bare form.
 *
 * Frontmatter tags arrive bare (`excalidraw`) while inline ones arrive with a
 * leading hash (`#excalidraw`), so both are reduced to the same string.
 *
 * @param value - Candidate tag.
 * @returns The bare tag, or null when it is not a usable string.
 */
function normalizeTag(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const bare = value.trim().replace(/^#/u, "").toLowerCase();
	return bare.length > 0 ? bare : null;
}

/**
 * Collects tag strings out of a frontmatter value.
 *
 * Obsidian accepts `tags: [a, b]`, `tags: a, b` and `tag: a`, so all three
 * shapes are handled.
 *
 * @param value - The `tags` or `tag` frontmatter value.
 * @returns Bare tag names.
 */
function collectFrontmatterTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map(normalizeTag)
			.filter((tag): tag is string => tag !== null);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map(normalizeTag)
			.filter((tag): tag is string => tag !== null);
	}
	return [];
}

/**
 * Reports whether note metadata marks a file as an Excalidraw drawing.
 *
 * This is the safety net for a drawing whose filename no longer says so: the
 * user may rename `图.excalidraw.md` to `图.md`, but the frontmatter and tag
 * Excalidraw wrote at creation time stay behind.
 *
 * Mirrors the two signals Excalidraw's own `isExcalidrawFile()` uses -- the
 * `excalidraw-plugin` frontmatter key and the `excalidraw` tag -- so the
 * fallback agrees with the plugin it is standing in for.
 *
 * @param frontmatter - `CachedMetadata.frontmatter`.
 * @param inlineTags - `CachedMetadata.tags`, for inline `#excalidraw`.
 * @returns True when the metadata identifies a drawing.
 */
export function marksDrawing(
	frontmatter: unknown,
	inlineTags?: unknown
): boolean {
	if (frontmatter && typeof frontmatter === "object") {
		const record = frontmatter as Record<string, unknown>;
		if (EXCALIDRAW_FRONTMATTER_KEY in record) return true;
		const tags = [
			...collectFrontmatterTags(record.tags),
			...collectFrontmatterTags(record.tag),
		];
		if (tags.includes(EXCALIDRAW_TAG)) return true;
	}

	if (Array.isArray(inlineTags)) {
		for (const entry of inlineTags) {
			const tag =
				entry && typeof entry === "object"
					? normalizeTag((entry as { tag?: unknown }).tag)
					: normalizeTag(entry);
			if (tag === EXCALIDRAW_TAG) return true;
		}
	}

	return false;
}

/**
 * Decides whether a file node is a drawing when its extension does not say so.
 *
 * Injected by the plugin, which can reach the vault and Obsidian's metadata
 * cache. Keeping it a parameter is what lets {@link classifyNode} stay pure.
 *
 * @param vaultPath - The node's `file` value.
 * @returns True when the file is an Excalidraw drawing.
 */
export type DrawingProbe = (vaultPath: string) => boolean;

/**
 * Extracts the lower-cased extension from a vault path.
 *
 * @param vaultPath - Vault-relative path.
 * @returns The extension without the dot, or an empty string.
 */
export function extensionOf(vaultPath: string): string {
	const lastSegment = vaultPath.split("/").pop() ?? vaultPath;
	const lastDot = lastSegment.lastIndexOf(".");
	return lastDot > 0 ? lastSegment.slice(lastDot + 1).toLowerCase() : "";
}

/**
 * Classifies a Canvas node into the category the merge rules dispatch on.
 *
 * @param node - Node data.
 * @returns The node kind.
 */
/**
 * Classifies a Canvas node into the category the merge rules dispatch on.
 *
 * Drawing detection is three-layered, cheapest first: the `.excalidraw`
 * extension, then the injected {@link DrawingProbe} (which asks the Excalidraw
 * plugin and falls back to note metadata), then the ordinary note/image
 * extension checks.
 *
 * @param node - Node data.
 * @param probe - Optional metadata-aware drawing check.
 * @returns The node kind.
 */
export function classifyNode(
	node: CanvasNodeData,
	probe?: DrawingProbe
): NodeKind {
	if (node.type === "text") return "text";
	if (node.type === "file") {
		const vaultPath = typeof node.file === "string" ? node.file : "";
		// Drawings come first: a renamed drawing is still a `.md` file, and it
		// must never be treated as a plain note.
		if (isDrawingPath(vaultPath)) return "drawing";
		const extension = extensionOf(vaultPath);
		// The metadata fallback only applies to Markdown files. A drawing the
		// user renamed is still opened by Obsidian as a note, so that is the
		// only extension it can carry; restricting the probe this way also
		// means an image is never reclassified on a stray metadata hit.
		if (extension === "md" && probe?.(vaultPath)) return "drawing";
		if (NOTE_EXTENSIONS.has(extension)) return "note";
		if (IMAGE_EXTENSIONS.has(extension)) return "image";
	}
	return "other";
}

/**
 * Localised label for a node kind, for user-facing messages.
 *
 * @param kind - The node kind.
 * @returns A short Chinese label.
 */
export function kindLabel(kind: NodeKind): string {
	return KIND_LABELS[kind];
}

/**
 * The merge action for an ordered (dragged, target) pair.
 *
 * This is the rule table from the requirements, expressed as data so it can be
 * exhaustively tested rather than inferred from scattered `if`s.
 */
export type MergeAction =
	| "copy-text-to-card"
	| "insert-image-into-card"
	| "insert-card-link"
	| "append-to-note"
	| "append-note-to-note"
	| "merge-images-into-excalidraw"
	| "append-to-drawing"
	| "nothing";

/** User-facing description of each action, shared by Notices and highlights. */
export const ACTION_LABELS: Record<MergeAction, string> = {
	"copy-text-to-card": "把文本合并进这张卡片",
	"insert-image-into-card": "把图片插入这张卡片",
	"insert-card-link": "把文件以链接插入这张卡片",
	"append-to-note": "把内容追加到这则笔记",
	"append-note-to-note": "把这则笔记的正文追加过去",
	"merge-images-into-excalidraw": "两张图片合并为一个 Excalidraw 文件",
	"append-to-drawing": "把内容加入这则图纸的画布",
	nothing: "什么都不做",
};

/**
 * Actions that consume **both** nodes, not just the dragged one.
 *
 * The image-merge rule replaces both pictures with a single drawing node, so
 * the normal "remove the dragged node" step must not run on top of it.
 */
export function consumesTargetToo(action: MergeAction): boolean {
	return action === "merge-images-into-excalidraw";
}

/**
 * Decides what merging `dragged` into `target` should do.
 *
 * The full table (targets across, dragged down):
 *
 *   dragged \ target | text card          | image                  | note                | drawing
 *   -----------------+--------------------+------------------------+---------------------+-----------------------
 *   text card        | copy text in       | --                     | append to note      | append to drawing
 *   image            | embed image in card| both -> Excalidraw file| append to note      | append to drawing
 *   note             | **link in card**   | --                     | append body to note | append to drawing
 *   drawing          | **link in card**   | --                     | --                  | append to drawing
 *
 * A drawing is only ever a *target*, another drawing's source, or a link inside
 * a text card. Its markdown source must never be appended anywhere as prose.
 *
 * @param dragged - Kind of the node being dragged.
 * @param target - Kind of the node it overlaps.
 * @returns The action to perform.
 */
export function resolveMergeAction(
	dragged: NodeKind,
	target: NodeKind
): MergeAction {
	// Link and group nodes carry no mergeable content and cannot receive any,
	// so they never participate in either role. The requirements do not mention
	// them; doing nothing is the only safe reading.
	if (dragged === "other" || target === "other") return "nothing";

	// An Excalidraw drawing accepts text, pictures, notes and other drawings.
	// Notes and drawings both go in as *rendered images*, which is what
	// ExcalidrawAutomate's addImage() already does for those file types.
	if (target === "drawing") {
		return dragged === "note" ||
			dragged === "drawing" ||
			dragged === "image" ||
			dragged === "text"
			? "append-to-drawing"
			: "nothing";
	}

	// Two pictures become one Excalidraw drawing. Whether this is actually
	// allowed depends on the setting and on the Excalidraw plugin being
	// present; the caller filters it out, because this function is pure.
	if (target === "image") {
		return dragged === "image" ? "merge-images-into-excalidraw" : "nothing";
	}

	// A text card can absorb a note or a drawing as a link. A Canvas text card
	// is Markdown, so `[[file]]` / `![[file]]` both render natively.
	if (target === "text") {
		if (dragged === "text") return "copy-text-to-card";
		if (dragged === "image") return "insert-image-into-card";
		if (dragged === "note" || dragged === "drawing") {
			return "insert-card-link";
		}
		return "nothing";
	}

	if (target === "note") {
		// A drawing's markdown source must NEVER be appended as prose -- it is
		// a compressed scene, not text. This guard has to sit here, after the
		// drawing/text cases above, or a drawing would fall through into the
		// generic "append to note" branch.
		if (dragged === "drawing") return "nothing";
		return dragged === "note" ? "append-note-to-note" : "append-to-note";
	}

	return "nothing";
}
