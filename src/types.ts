/**
 * Shared shapes for Obsidian's undocumented Canvas internals.
 *
 * Canvas has no public API contract (`obsidian.d.ts` does not mention it), so
 * only the fields actually read are modelled, and every call site probes with
 * `typeof === "function"` before use.
 */

import { t } from "./i18n";

/** Node kinds Obsidian's Canvas can hold. */
export type CanvasNodeType = "text" | "file" | "link" | "group";

/** One Canvas node, as returned by `canvas.getData()`. */
export interface CanvasNodeData {
	id: string;
	type: CanvasNodeType;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Present on `text` nodes: the card's markdown body. */
	text?: string;
	/** Present on `file` nodes: vault-relative path of the referenced file. */
	file?: string;
	/** Present on `link` nodes: the external URL. */
	url?: string;
	[key: string]: unknown;
}

/** One Canvas edge. */
export interface CanvasEdgeData {
	id: string;
	fromNode: string;
	toNode: string;
	[key: string]: unknown;
}

/** The whole Canvas document, same shape as a `.canvas` file on disk. */
export interface CanvasData {
	nodes: CanvasNodeData[];
	edges: CanvasEdgeData[];
}

/** The subset of the internal Canvas object this plugin depends on. */
export interface CanvasLike {
	selection?: unknown;
	nodes?: Map<string, unknown>;
	readonly?: boolean;
	wrapperEl?: HTMLElement;
	getData?(): CanvasData;
	setData?(data: CanvasData): Promise<void> | void;
	requestSave?(): Promise<void> | void;
	getSelectionData?(): CanvasData;
}

/** Raised when the Canvas internals we need are missing. */
export class CanvasUnavailableError extends Error {}

/**
 * Reports whether an unknown value looks like Canvas node data.
 *
 * @param value - Candidate.
 * @returns True when the mandatory geometric fields are present.
 */
export function isNodeData(value: unknown): value is CanvasNodeData {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<CanvasNodeData>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.type === "string" &&
		typeof candidate.x === "number" &&
		typeof candidate.y === "number"
	);
}

/**
 * Reads the full Canvas document.
 *
 * @param canvas - The Canvas instance.
 * @returns The Canvas document.
 * @throws {CanvasUnavailableError} When the read API is missing or unusable.
 */
export function readCanvasData(canvas: CanvasLike): CanvasData {
	if (typeof canvas.getData !== "function") {
		throw new CanvasUnavailableError(t("error.canvasNoGetData"));
	}
	const data = canvas.getData();
	if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
		throw new CanvasUnavailableError(t("error.canvasUnreadable"));
	}
	return data;
}

/** The parts of a node *instance* used by the editing guard. */
interface CanvasNodeEditingLike {
	isEditing?: boolean;
	nodeEl?: HTMLElement | null;
}

/**
 * Selectors indicating a node has an active text editor.
 * Mirrors the guard used by the canvas-loom plugin.
 */
const EDITOR_FOCUS_SELECTOR = [
	".cm-focused",
	"textarea:focus",
	"[contenteditable='true']:focus",
].join(", ");

/**
 * Reports whether a single node instance is mid-edit.
 *
 * @param node - Node instance from `canvas.nodes`.
 * @returns True when the node has an active text editor.
 */
function isNodeInstanceEditing(node: CanvasNodeEditingLike): boolean {
	if (!node) return false;
	if (node.isEditing === true) return true;
	const element = node.nodeEl;
	if (!element) return false;
	if (element.classList?.contains("is-editing")) return true;
	return Boolean(element.querySelector?.(EDITOR_FOCUS_SELECTOR));
}

/**
 * Reports whether any node on the Canvas is currently being edited.
 *
 * Used for two things: refusing to write Canvas data while an edit is in
 * progress (that would discard the user's typing), and letting the text editor
 * keep the Tab key instead of the trigger key stealing it for indentation.
 *
 * @param canvas - The Canvas instance.
 * @returns True when at least one node is being edited.
 */
export function hasEditingNode(canvas: CanvasLike): boolean {
	const nodes = canvas.nodes;
	if (!(nodes instanceof Map)) return false;
	for (const node of nodes.values()) {
		if (isNodeInstanceEditing(node as CanvasNodeEditingLike)) return true;
	}
	return false;
}
