/**
 * Drag-time "this can be merged" highlight.
 *
 * While the pointer is down and the dragged node overlaps a node the rules can
 * actually consume, the target gets an outline, a glow and a small label naming
 * the action that will run. This turns a blind gesture into one the user can
 * aim.
 *
 * Implementation notes:
 *   - classes are applied to the node's own element, so nothing is drawn over
 *     the Canvas and no layout is touched;
 *   - the update is a **diff**: only elements entering or leaving the target set
 *     have their class toggled, so a per-frame pointermove does not thrash the
 *     DOM;
 *   - every element the highlighter touched is remembered, so `clear()` can put
 *     the UI back even if the node list changed underneath.
 */

import { findNodeElement } from "./live";
import type { CanvasLike } from "./types";

/** Class applied to a node that can be merged into. */
const HIGHLIGHT_CLASS = "canvas-drag-merge-target";

/** Attribute carrying the label rendered by the class's `::after`. */
const HINT_ATTRIBUTE = "data-drag-merge-hint";

/** One node to highlight, with the label to show. */
export interface HighlightTarget {
	/** Canvas node id. */
	id: string;
	/** Short description of the action, shown as a floating label. */
	hint: string;
}

/** Applies and clears the merge-target highlight on Canvas nodes. */
export class MergeHighlighter {
	/** Elements currently highlighted, mapped to the label they show. */
	private readonly active = new Map<HTMLElement, string>();

	/**
	 * Brings the highlight in line with `targets`.
	 *
	 * @param canvas - The Canvas instance.
	 * @param targets - Nodes that should be highlighted right now.
	 */
	apply(canvas: CanvasLike, targets: HighlightTarget[]): void {
		const next = new Map<HTMLElement, string>();
		for (const target of targets) {
			const element = findNodeElement(canvas, target.id);
			if (element) next.set(element, target.hint);
		}

		// Drop anything no longer targeted.
		for (const element of this.active.keys()) {
			if (!next.has(element)) this.clearElement(element);
		}

		// Add or relabel what remains.
		for (const [element, hint] of next) {
			if (this.active.get(element) === hint) continue;
			element.classList.add(HIGHLIGHT_CLASS);
			element.setAttribute(HINT_ATTRIBUTE, hint);
		}

		this.active.clear();
		for (const [element, hint] of next) this.active.set(element, hint);
	}

	/** Removes every highlight this instance applied. */
	clear(): void {
		for (const element of this.active.keys()) this.clearElement(element);
		this.active.clear();
	}

	/** Removes the highlight classes from one element. */
	private clearElement(element: HTMLElement): void {
		element.classList.remove(HIGHLIGHT_CLASS);
		element.removeAttribute(HINT_ATTRIBUTE);
	}
}
