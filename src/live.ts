/**
 * Reading *live* node geometry.
 *
 * The merge itself only needs node positions at drop time, which
 * `canvas.getData()` provides. The drag-time highlight needs them **while the
 * pointer is still down**, and whether `getData()` reflects an in-progress drag
 * is not contracted.
 *
 * Node *instances* (`canvas.nodes`) each expose their own `getData()`, which
 * reads that node's current state directly and is therefore the better source
 * mid-drag. This module prefers instances and silently falls back to the
 * document, so the highlight degrades to "appears on drop" rather than breaking
 * if the instance API is unavailable.
 */

import { isNodeData, readCanvasData } from "./types";
import type { CanvasLike, CanvasNodeData } from "./types";

/** The part of a node instance this module reads. */
interface CanvasNodeInstanceLike {
	getData?: () => unknown;
	nodeEl?: HTMLElement | null;
}

/**
 * Reads every node's current geometry, preferring live instances.
 *
 * @param canvas - The Canvas instance.
 * @returns Node data, or an empty array when nothing could be read.
 */
export function readLiveNodes(canvas: CanvasLike): CanvasNodeData[] {
	const instances = canvas.nodes;
	if (instances instanceof Map && instances.size > 0) {
		const live: CanvasNodeData[] = [];
		for (const instance of instances.values()) {
			const candidate = (instance as CanvasNodeInstanceLike)?.getData?.();
			if (isNodeData(candidate)) live.push(candidate);
		}
		if (live.length > 0) return live;
	}

	try {
		return readCanvasData(canvas).nodes;
	} catch {
		return [];
	}
}

/**
 * Finds the DOM element backing a node, for highlighting.
 *
 * @param canvas - The Canvas instance.
 * @param nodeId - The node to locate.
 * @returns The node's element, or null when it cannot be resolved.
 */
export function findNodeElement(
	canvas: CanvasLike,
	nodeId: string
): HTMLElement | null {
	const instance = canvas.nodes?.get?.(nodeId) as
		| CanvasNodeInstanceLike
		| undefined;
	return instance?.nodeEl ?? null;
}
