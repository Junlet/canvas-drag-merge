/**
 * Executing a merge.
 *
 * Two different worlds get written to, depending on the target:
 *
 *   - a **text card** lives inside the `.canvas` document, so merging into it
 *     means editing `node.text` and writing the document back;
 *   - an **md note** lives as a vault file, so merging into it means
 *     `vault.append()`.
 *
 * Ordering rule: **files are written before the Canvas**. If a file write
 * fails, the Canvas is left untouched and the user still has their nodes. The
 * reverse order could destroy a node whose content never made it anywhere.
 */

import type { App, TFile } from "obsidian";
import type { CanvasData, CanvasNodeData } from "./types";
import { kindLabel, type MergeAction, type NodeKind } from "./nodes";
import { stripFrontmatter, trimLeadingBlankLines } from "./frontmatter";
import { pickTopLeftNode } from "./drag";
import {
	buildDrawingPath,
	deriveNameFromFilePath,
	prepareDrawingBaseName,
	resolveUniqueBaseName,
} from "./naming";
import {
	addEmbeddableWithStubView,
	appendToDrawing,
	createDrawingFromImages,
	DrawingFailedError,
	resolveVaultFile,
	type DrawingEmbedMode,
	type ExcalidrawBridge,
} from "./excalidraw";

/** Blank line inserted between existing content and appended content. */
const APPEND_SEPARATOR = "\n\n";

/** Narrow text elements stay readable instead of wrapping one glyph per line. */
const MIN_TEXT_WIDTH = 120;

/**
 * Minimum footprint of the node that replaces two merged pictures.
 * Keeps the resulting drawing node readable.
 */
const MIN_REPLACEMENT_DIMENSION = 300;

/** Outcome of one merge, for user feedback. */
export interface MergeOutcome {
	/** The rule that fired. */
	action: MergeAction;
	/** Short description of what actually happened. */
	detail: string;
	/** True when the vault or the Canvas was actually modified. */
	changed: boolean;
	/**
	 * True when the **Canvas document** was modified and must be written back.
	 *
	 * Merges into a note only touch a vault file, so rewriting the Canvas for
	 * them would be a pointless re-render. Omitted means false.
	 */
	canvasChanged?: boolean;
	/**
	 * True when the caller should still delete the dragged node.
	 *
	 * Rules that consume the target as well (two pictures becoming one drawing)
	 * do their own removal and set this to false. Omitted means true.
	 */
	consumesSource?: boolean;
}

/**
 * Stages one Canvas node as Excalidraw elements on the workbench.
 *
 * Text becomes a text element. Pictures are inserted as pictures. Notes and
 * other drawings are handed to `addImage()` -- ExcalidrawAutomate rasterises
 * Markdown notes and Excalidraw files on the fly -- unless the user asked for
 * the interactive form, in which case an `embeddable` element is staged so the
 * content stays live and scrollable inside the drawing.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param source - The node to stage.
 * @param kind - Its classified kind.
 * @param offsetX - X position for the staged element.
 * @param offsetY - Y position for the staged element.
 * @param embedMode - Image snapshot or interactive embed, for file sources.
 * @param targetPath - Vault path of the drawing being written to.
 * @returns How many elements were staged (0 or 1).
 */
async function stageNodeIntoDrawing(
	app: App,
	ea: ExcalidrawBridge["ea"],
	source: CanvasNodeData,
	kind: NodeKind,
	offsetX: number,
	offsetY: number,
	embedMode: DrawingEmbedMode,
	targetPath: string
): Promise<number> {
	if (kind === "text") {
		const text = typeof source.text === "string" ? source.text : "";
		if (text.trim().length === 0) return 0;
		const id = ea.addText(offsetX, offsetY, text, {
			width: Math.max(Math.round(source.width), MIN_TEXT_WIDTH),
		});
		return id ? 1 : 0;
	}

	const vaultPath = typeof source.file === "string" ? source.file : "";
	const file = vaultPath ? resolveVaultFile(app, vaultPath) : null;
	if (!file) {
		throw new DrawingFailedError(`找不到源文件：${vaultPath || "(空)"}`);
	}

	// Interactive form only makes sense for files the user can actually read
	// inside the drawing -- notes and other drawings. A picture is already
	// fully represented by an image element.
	const wantsEmbed =
		embedMode === "interactive" && (kind === "note" || kind === "drawing");

	console.log(
		`[canvas-drag-merge] 正在把 ${kind} 以${
			wantsEmbed ? "交互" : "图像"
		}形式加入图纸：${file.path}`
	);

	if (wantsEmbed) {
		const embedId = addEmbeddableWithStubView(
			ea,
			targetPath,
			offsetX,
			offsetY,
			Math.round(source.width),
			Math.round(source.height),
			file
		);
		if (embedId) return 1;
		console.warn(
			"[canvas-drag-merge] 交互形式失败，回退为图像形式：",
			file.path
		);
	}

	// `anchor` mirrors the plugin's own insertMarkdownImage(): a rasterised
	// note or drawing already has the size its render settings asked for, so it
	// needs no `|100%` annotation.
	const anchor = kind === "image";
	const elementId = await ea.addImage(offsetX, offsetY, file, false, anchor);
	if (!elementId) {
		throw new DrawingFailedError(
			`Excalidraw 无法把「${file.name}」渲染成图片`
		);
	}
	return 1;
}

/** Everything a merge needs to act. */
export interface MergeContext {
	app: App;
	/** The Canvas document being edited in memory. */
	data: CanvasData;
	/** Whether the dragged node is removed from the Canvas afterwards. */
	deleteSourceNode: boolean;
	/** Whether a consumed source note file is trashed. */
	deleteSourceNoteFile: boolean;
	/** Whether card links are transclusions (`![[..]]`) or plain links. */
	cardLinkEmbedded: boolean;
	/** Vault path of the Canvas, so inserted links resolve like Obsidian's own. */
	sourcePath: string;
	/** Live Excalidraw bridge, or null when the plugin is unavailable. */
	excalidraw: ExcalidrawBridge | null;
	/** Destination folder for newly created drawings. */
	drawingFolder: string | undefined;
	/** Image snapshot or interactive embed, when adding files to a drawing. */
	drawingEmbedMode: DrawingEmbedMode;
	/** Mints an id for a node inserted back into the Canvas. */
	createNodeId: (taken: Set<string>) => string;
}

/**
 * Builds the link text Obsidian itself would insert for a file.
 *
 * `metadataCache.fileToLinktext()` is the same machinery behind typing `[[`:
 * it returns the shortest form that still resolves from `sourcePath`, so two
 * notes with the same basename in different folders get the path they need and
 * unique names stay short.
 *
 * The `.md` extension is kept (`omitMdExtension = false`) to match Excalidraw's
 * own `addEmbeddable()`, whose links look like `[[图.excalidraw.md]]`.
 *
 * @param app - The Obsidian app.
 * @param file - The file being linked.
 * @param sourcePath - Vault path of the Canvas the link is written into.
 * @returns Link text, falling back to the full path if resolution fails.
 */
function buildLinkText(app: App, file: TFile, sourcePath: string): string {
	try {
		const text = app.metadataCache.fileToLinktext(file, sourcePath, false);
		if (typeof text === "string" && text.length > 0) return text;
	} catch (error) {
		console.error(
			"[canvas-drag-merge] fileToLinktext() 失败，回退到完整路径",
			error
		);
	}
	return file.path;
}

/**
 * Builds the markdown a source node contributes when appended to a note.
 *
 * @param source - The dragged node.
 * @param kind - Its classified kind.
 * @returns Markdown to append, or null when the node has nothing to give.
 */
function markdownFromNode(
	node: CanvasNodeData,
	kind: NodeKind
): string | null {
	if (kind === "text") {
		const text = typeof node.text === "string" ? node.text : "";
		return text.trim().length > 0 ? text : null;
	}
	if (kind === "image") {
		const path = typeof node.file === "string" ? node.file : "";
		// An Obsidian embed, so the picture renders inside the note.
		return path ? `![[${path}]]` : null;
	}
	return null;
}

/**
 * Mutable holder for the text a merge wants to add to the target card.
 *
 * A text card can only receive text, so both text->text and image->text funnel
 * through here.
 *
 * @param target - The target node, mutated in place.
 * @param addition - Markdown to append.
 */
function appendToCardText(target: CanvasNodeData, addition: string): void {
	const existing = typeof target.text === "string" ? target.text : "";
	const body = trimLeadingBlankLines(addition);
	target.text = existing.trim().length > 0
		? `${existing}${APPEND_SEPARATOR}${body}`
		: body;
}

/**
 * Appends text to a vault note.
 *
 * @param app - The Obsidian app.
 * @param file - Target note.
 * @param addition - Markdown to append.
 */
async function appendToNote(
	app: App,
	file: TFile,
	addition: string
): Promise<void> {
	await app.vault.append(file, `${APPEND_SEPARATOR}${trimLeadingBlankLines(addition)}`);
}

/**
 * Performs one merge.
 *
 * @param context - Canvas document, app, and settings.
 * @param source - The dragged node.
 * @param target - The node it overlapped most.
 * @param action - The rule to apply.
 * @param sourceKind - Classified kind of the dragged node.
 * @param targetKind - Classified kind of the target node.
 * @returns What was done.
 */
export async function executeMerge(
	context: MergeContext,
	source: CanvasNodeData,
	target: CanvasNodeData,
	action: MergeAction,
	sourceKind: NodeKind,
	targetKind: NodeKind
): Promise<MergeOutcome> {
	switch (action) {
		case "copy-text-to-card": {
			const markdown = markdownFromNode(source, sourceKind);
			if (!markdown) {
				return { action, detail: "源卡片是空的，没有可复制的内容", changed: false };
			}
			appendToCardText(target, markdown);
			return {
				action,
				detail: "已把源卡片的文本追加到目标卡片",
				changed: true,
				canvasChanged: true,
			};
		}

		case "insert-image-into-card": {
			const markdown = markdownFromNode(source, sourceKind);
			if (!markdown) {
				return { action, detail: "图片节点没有文件路径", changed: false };
			}
			appendToCardText(target, markdown);
			return {
				action,
				detail: "已把图片作为嵌入插入目标卡片",
				changed: true,
				canvasChanged: true,
			};
		}

		case "insert-card-link": {
			const vaultPath = typeof source.file === "string" ? source.file : "";
			const file = vaultPath
				? resolveVaultFile(context.app, vaultPath, context.sourcePath)
				: null;
			if (!file) {
				return { action, detail: `找不到文件：${vaultPath || "(空)"}`, changed: false };
			}

			// A Canvas text card holds Markdown, so both forms render natively:
			// `[[x]]` is a link, `![[x]]` pulls the content in.
			const bang = context.cardLinkEmbedded ? "!" : "";
			const link = `${bang}[[${buildLinkText(
				context.app,
				file,
				context.sourcePath
			)}]]`;
			appendToCardText(target, link);

			return {
				action,
				detail: `已把${kindLabel(sourceKind)}以${
					context.cardLinkEmbedded ? "嵌入" : "链接"
				}形式写入目标卡片：${link}`,
				changed: true,
				canvasChanged: true,
			};
		}

		case "append-to-note": {
			const targetPath = typeof target.file === "string" ? target.file : "";
			const noteFile = targetPath
				? resolveVaultFile(context.app, targetPath)
				: null;
			if (!noteFile) {
				return { action, detail: `找不到目标笔记：${targetPath}`, changed: false };
			}
			const markdown = markdownFromNode(source, sourceKind);
			if (!markdown) {
				return { action, detail: "源节点没有可插入的内容", changed: false };
			}
			await appendToNote(context.app, noteFile, markdown);
			return {
				action,
				detail: `已把内容追加到笔记 ${noteFile.name} 的结尾`,
				changed: true,
			};
		}

		case "append-note-to-note": {
			const sourcePath = typeof source.file === "string" ? source.file : "";
			const targetPath = typeof target.file === "string" ? target.file : "";
			const sourceFile = sourcePath
				? resolveVaultFile(context.app, sourcePath)
				: null;
			const targetFile = targetPath
				? resolveVaultFile(context.app, targetPath)
				: null;
			if (!sourceFile) {
				return { action, detail: `找不到源笔记：${sourcePath}`, changed: false };
			}
			if (!targetFile) {
				return { action, detail: `找不到目标笔记：${targetPath}`, changed: false };
			}
			if (sourceFile.path === targetFile.path) {
				return { action, detail: "源笔记和目标笔记是同一个文件", changed: false };
			}

			const raw = await context.app.vault.read(sourceFile);
			const body = trimLeadingBlankLines(stripFrontmatter(raw));
			if (body.trim().length === 0) {
				return {
					action,
					detail: "源笔记去掉属性后没有正文，未追加",
					changed: false,
				};
			}

			await appendToNote(context.app, targetFile, body);

			// Only the *file* deletion is optional here; removing the node is
			// handled by the caller like every other merge.
			let detail = `已把笔记 ${sourceFile.name} 的正文追加到 ${targetFile.name} 结尾（已去掉属性）`;
			if (context.deleteSourceNoteFile) {
				await context.app.fileManager.trashFile(sourceFile);
				detail += "，并把源笔记移入回收站";
			}
			return { action, detail, changed: true };
		}

		case "append-to-drawing": {
			if (!context.excalidraw) {
				return {
					action,
					detail: "未找到已启用的 Excalidraw 插件，无法加入图纸",
					changed: false,
				};
			}
			const targetPath = typeof target.file === "string" ? target.file : "";
			const drawingFile = targetPath
				? resolveVaultFile(context.app, targetPath)
				: null;
			if (!drawingFile) {
				return { action, detail: `找不到图纸：${targetPath}`, changed: false };
			}

			const note = await appendToDrawing(
				context.app,
				context.excalidraw,
				drawingFile,
				(offsetX, offsetY) =>
					stageNodeIntoDrawing(
						context.app,
						context.excalidraw!.ea,
						source,
						sourceKind,
						offsetX,
						offsetY,
						context.drawingEmbedMode,
						drawingFile.path
					)
			);

			return {
				action,
				detail:
					`已把${kindLabel(sourceKind)}以` +
					`${
						context.drawingEmbedMode === "interactive" &&
						(sourceKind === "note" || sourceKind === "drawing")
							? "交互"
							: "图像"
					}形式加入图纸「${drawingFile.name}」${note}`,
				changed: true,
				// Only the drawing file changed; the Canvas itself is untouched
				// apart from the source node the caller removes.
				canvasChanged: false,
			};
		}

		case "merge-images-into-excalidraw": {
			if (!context.excalidraw) {
				return {
					action,
					detail: "未找到已启用的 Excalidraw 插件，无法合并为图纸",
					changed: false,
				};
			}

			const pair = [source, target];
			// Named after the topmost-leftmost of the pair, matching how the
			// canvas-to-excalidraw plugin names a multi-selection drawing.
			const namingNode = pickTopLeftNode(pair) ?? target;
			const baseName = prepareDrawingBaseName(
				deriveNameFromFilePath(
					typeof namingNode.file === "string" ? namingNode.file : ""
				)
			);
			const uniqueName = resolveUniqueBaseName(
				baseName,
				(candidate) =>
					context.app.vault.getAbstractFileByPath(
						buildDrawingPath(context.drawingFolder, candidate)
					) !== null
			);

			const drawingPath = await createDrawingFromImages(
				context.app,
				context.excalidraw,
				pair,
				uniqueName,
				context.drawingFolder
			);

			// Both pictures are replaced by a single node pointing at the drawing.
			const removed = new Set([source.id, target.id]);
			const bounds = {
				minX: Math.min(source.x, target.x),
				minY: Math.min(source.y, target.y),
				maxX: Math.max(source.x + source.width, target.x + target.width),
				maxY: Math.max(source.y + source.height, target.y + target.height),
			};
			context.data.nodes = context.data.nodes.filter(
				(node) => !removed.has(node.id)
			);
			context.data.edges = context.data.edges.filter(
				(edge) =>
					!removed.has(edge.fromNode) && !removed.has(edge.toNode)
			);
			context.data.nodes.push({
				id: context.createNodeId(
					new Set(context.data.nodes.map((node) => node.id))
				),
				type: "file",
				file: drawingPath,
				x: Math.round(bounds.minX),
				y: Math.round(bounds.minY),
				width: Math.max(
					MIN_REPLACEMENT_DIMENSION,
					Math.round(bounds.maxX - bounds.minX)
				),
				height: Math.max(
					MIN_REPLACEMENT_DIMENSION,
					Math.round(bounds.maxY - bounds.minY)
				),
			});

			return {
				action,
				detail: `已把两张图片合并为图纸「${drawingPath}」`,
				changed: true,
				canvasChanged: true,
				// Both nodes are gone already -- the caller must not also remove
				// the dragged one, which would be a pointless second pass.
				consumesSource: false,
			};
		}

		default:
			return { action: "nothing", detail: "该组合不做任何操作", changed: false };
	}
}

/**
 * Removes nodes from a Canvas document, along with any edges touching them.
 *
 * Edges are dropped rather than repointed: the merge consumed the source, so a
 * dangling reference would be invalid.
 *
 * @param data - The Canvas document, mutated in place.
 * @param removedIds - Ids of the nodes to remove.
 * @returns How many nodes and edges were removed.
 */
export function removeNodes(
	data: CanvasData,
	removedIds: Set<string>
): { nodes: number; edges: number } {
	if (removedIds.size === 0) return { nodes: 0, edges: 0 };

	const nodesBefore = data.nodes.length;
	const edgesBefore = data.edges.length;
	data.nodes = data.nodes.filter((node) => !removedIds.has(node.id));
	data.edges = data.edges.filter(
		(edge) =>
			!removedIds.has(edge.fromNode) && !removedIds.has(edge.toNode)
	);
	return {
		nodes: nodesBefore - data.nodes.length,
		edges: edgesBefore - data.edges.length,
	};
}
