/**
 * Drag detection and geometric overlap.
 *
 * Canvas exposes no drag event. The `advanced-canvas` plugin obtains one by
 * monkey-patching the internal `canvas.setDragging()` method, but patching
 * shared internals risks conflicting with that very plugin, so this module
 * takes a different route:
 *
 *   * on pointer-down, snapshot every node's position;
 *   * on pointer-up, snapshot again and **diff**: whatever moved is what the
 *     user dragged.
 *
 * The diff approach has a useful property -- panning, zooming and rubber-band
 * selection move the *viewport*, not node coordinates, so the diff comes back
 * empty and nothing fires. It also needs no coordinate conversion.
 *
 * Everything here is pure so the rules can be tested without Obsidian.
 */

import type { CanvasNodeData } from "./types";

/** Positions of every node, keyed by node id. */
export type PositionSnapshot = Map<string, { x: number; y: number }>;

/** How far a node must move before it counts as dragged. */
const MOVEMENT_EPSILON = 0.5;

/** One node overlapping another. */
export interface OverlapCandidate {
	/** The node that was dragged. */
	moved: CanvasNodeData;
	/** The node it overlaps. */
	target: CanvasNodeData;
	/** Area of the intersection rectangle, in Canvas units squared. */
	area: number;
}

/**
 * Records every node's position.
 *
 * @param nodes - Node data from `canvas.getData()`.
 * @returns A snapshot suitable for {@link findMovedNodes}.
 */
export function snapshotPositions(nodes: CanvasNodeData[]): PositionSnapshot {
	const snapshot: PositionSnapshot = new Map();
	for (const node of nodes) {
		snapshot.set(node.id, { x: node.x, y: node.y });
	}
	return snapshot;
}

/**
 * Finds the nodes whose position changed since the snapshot.
 *
 * @param before - Snapshot taken on pointer-down.
 * @param nodes - Current node data.
 * @returns The nodes that moved, in document order.
 */
export function findMovedNodes(
	before: PositionSnapshot,
	nodes: CanvasNodeData[]
): CanvasNodeData[] {
	const moved: CanvasNodeData[] = [];
	for (const node of nodes) {
		const previous = before.get(node.id);
		// A node with no snapshot entry is newly created, not dragged.
		if (!previous) continue;
		if (
			Math.abs(node.x - previous.x) > MOVEMENT_EPSILON ||
			Math.abs(node.y - previous.y) > MOVEMENT_EPSILON
		) {
			moved.push(node);
		}
	}
	return moved;
}

/**
 * Area of the intersection of two node rectangles.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns The overlap area; 0 when the rectangles do not intersect.
 */
export function intersectionArea(
	a: CanvasNodeData,
	b: CanvasNodeData
): number {
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	if (right <= left || bottom <= top) return 0;
	return (right - left) * (bottom - top);
}

/**
 * Pairs each moved node with the single node it overlaps most.
 *
 * The requirement is to merge into exactly one target -- the one with the
 * largest overlapping area -- so ties are broken by document order to keep the
 * outcome deterministic.
 *
 * @param moved - Nodes detected as dragged.
 * @param all - Every node on the Canvas.
 * @returns One candidate per moved node that overlaps something.
 */
export function findBestOverlaps(
	moved: CanvasNodeData[],
	all: CanvasNodeData[]
): OverlapCandidate[] {
	const movedIds = new Set(moved.map((node) => node.id));
	const results: OverlapCandidate[] = [];

	for (const source of moved) {
		let best: OverlapCandidate | null = null;
		for (const target of all) {
			if (target.id === source.id) continue;
			// Two nodes dragged together are not targets for each other.
			if (movedIds.has(target.id)) continue;

			const area = intersectionArea(source, target);
			if (area <= 0) continue;
			if (!best || area > best.area) {
				best = { moved: source, target, area };
			}
		}
		if (best) results.push(best);
	}

	return results;
}

/** Tolerance used when comparing node rows, to absorb float noise. */
const ROW_EPSILON = 1;

/**
 * Picks the topmost, then leftmost, node.
 *
 * Used to name a drawing produced from several pictures, matching how the
 * `canvas-to-excalidraw` plugin names one built from a multi-selection.
 *
 * @param nodes - Candidate nodes.
 * @returns The winning node, or null when `nodes` is empty.
 */
export function pickTopLeftNode(
	nodes: CanvasNodeData[]
): CanvasNodeData | null {
	let best: CanvasNodeData | null = null;
	for (const node of nodes) {
		if (!best) {
			best = node;
			continue;
		}
		const rowDelta = node.y - best.y;
		if (rowDelta < -ROW_EPSILON) {
			best = node;
		} else if (Math.abs(rowDelta) <= ROW_EPSILON && node.x < best.x) {
			best = node;
		}
	}
	return best;
}
