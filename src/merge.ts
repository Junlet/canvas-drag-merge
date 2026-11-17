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
	fitElementToBox,
	isPictureFile,
	resolveVaultFile,
	type DrawingEmbedMode,
	type ExcalidrawBridge,
} from "./excalidraw";
import { t } from "./i18n";
import { extractCardEmbeds } from "./cardcontent";
import {
	buildStickyFormat,
	resolveStickyBackground,
	type StickyNoteOptions,
} from "./sticky";

/** Blank line inserted between existing content and appended content. */
const APPEND_SEPARATOR = "\n\n";

/** Narrow text elements stay readable instead of wrapping one glyph per line. */
const MIN_TEXT_WIDTH = 120;

/** Vertical gap between a text card and the pictures pulled out of it. */
const CARD_EMBED_GAP = 20;

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

/** Warned once per session; `addStickyNote()` is missing on older Excalidraw. */
let warnedNoSticky = false;

/**
 * Writes a text card's body into the drawing.
 *
 * A sticky note is the default wish, but it is only used when the user enabled
 * it *and* the installed Excalidraw has `addStickyNote()`; otherwise the body
 * becomes a plain text element, so a merge never fails over a missing API.
 *
 * The workbench style is shared across every staged element, so the fill it
 * needs for a note is restored immediately after the note is staged.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param text - The card's body, with embeds already handled.
 * @param source - The node being staged, for its size and colour.
 * @param offsetX - X position.
 * @param offsetY - Y position.
 * @param width - Text width, when a note is not used.
 * @param sticky - Sticky-note settings, or null to always use plain text.
 * @returns 1 when something was staged, 0 otherwise.
 */
function stageTextCard(
	ea: ExcalidrawBridge["ea"],
	text: string,
	source: CanvasNodeData,
	offsetX: number,
	offsetY: number,
	width: number,
	sticky: StickyNoteOptions | null
): number {
	if (sticky && typeof ea.addStickyNote === "function") {
		const format = buildStickyFormat(sticky, source.width, source.height);
		const fill = resolveStickyBackground(sticky, source.color);
		const style = ea.style;
		const previousBackground = style.backgroundColor;
		const previousFill = style.fillStyle;
		try {
			if (fill) {
				style.backgroundColor = fill;
				// A sticky note is only filled when the style is `solid`;
				// Excalidraw's default is hachure, which would hatch it.
				style.fillStyle = "solid";
			}
			const id = ea.addStickyNote(offsetX, offsetY, text, format);
			if (id) return 1;
		} catch (error) {
			console.error(
				"[canvas-drag-merge] addStickyNote() failed; falling back to a text element",
				error
			);
		} finally {
			style.backgroundColor = previousBackground;
			style.fillStyle = previousFill;
		}
	} else if (sticky && !warnedNoSticky) {
		warnedNoSticky = true;
		console.warn(
			"[canvas-drag-merge] this Excalidraw build has no addStickyNote(); " +
				"text cards are written as plain text."
		);
	}

	const id = ea.addText(offsetX, offsetY, text, { width });
	return id ? 1 : 0;
}

/**
 * Places one picture embedded in a text card.
 *
 * Only real pictures are placed. An unresolvable or non-picture target is
 * reported and skipped: a text element cannot render the marker anyway, so
 * leaving `![[file]]` behind would be the worse outcome.
 *
 * @param app - The Obsidian app.
 * @param ea - The ExcalidrawAutomate instance.
 * @param target - Embed target as written in the card.
 * @param x - Left edge.
 * @param y - Top edge.
 * @param width - The card's width, also the fitting box.
 * @returns The placed height, or null when nothing was placed.
 */
async function stageEmbeddedPicture(
	app: App,
	ea: ExcalidrawBridge["ea"],
	target: string,
	x: number,
	y: number,
	width: number
): Promise<{ height: number } | null> {
	const file = resolveVaultFile(app, target);
	if (!file || !isPictureFile(file)) {
		console.warn(`[canvas-drag-merge] ${t("log.embedSkipped", { path: target })}`);
		return null;
	}

	let elementId: string;
	try {
		elementId = await ea.addImage(x, y, file, false, false);
	} catch (error) {
		console.error(
			"[canvas-drag-merge] addImage() failed for an embedded picture",
			file.path,
			error
		);
		return null;
	}
	if (!elementId) return null;

	fitElementToBox(ea, elementId, width, width, 1);
	const height = Number(ea.getElement(elementId)?.height);
	return {
		height: Number.isFinite(height) && height > 0 ? height : width,
	};
}

/**
 * Stages one Canvas node as Excalidraw elements on the workbench.
 *
 * A text card is Markdown, so two things happen before it can be written:
 *
 *   - its picture embeds are handled by `cardcontent.ts` -- placed as pictures,
 *     reduced to file names, or left as raw markers, per the setting;
 *   - when the user asked for it, the body becomes a **sticky note** instead of
 *     a bare text element (a `stickynote` container with a fitted label).
 *
 * Pictures are inserted as pictures. Notes and other drawings are handed to
 * `addImage()` -- ExcalidrawAutomate rasterises Markdown notes and Excalidraw
 * files on the fly -- unless the user asked for the interactive form, in which
 * case an `embeddable` element is staged so the content stays live inside the
 * drawing.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param source - The node to stage.
 * @param kind - Its classified kind.
 * @param offsetX - X position for the staged element.
 * @param offsetY - Y position for the staged element.
 * @param embedMode - Image snapshot or interactive embed, for file sources.
 * @param targetPath - Vault path of the drawing being written to.
 * @param textOptions - Sticky-note settings and the embed rule for text cards.
 * @returns How many elements were staged.
 */
async function stageNodeIntoDrawing(
	app: App,
	ea: ExcalidrawBridge["ea"],
	source: CanvasNodeData,
	kind: NodeKind,
	offsetX: number,
	offsetY: number,
	embedMode: DrawingEmbedMode,
	targetPath: string,
	textOptions: {
		stickyNotes: StickyNoteOptions | null;
		textCardEmbedMode: string;
	}
): Promise<number> {
	if (kind === "text") {
		const raw = typeof source.text === "string" ? source.text : "";
		if (raw.trim().length === 0) return 0;

		const content = extractCardEmbeds(raw, textOptions.textCardEmbedMode);
		const width = Math.max(Math.round(source.width), MIN_TEXT_WIDTH);
		let staged = 0;

		if (content.text.trim().length > 0) {
			staged += stageTextCard(
				ea,
				content.text,
				source,
				offsetX,
				offsetY,
				width,
				textOptions.stickyNotes
			);
		}

		// Pictures pulled out of the card go directly below it.
		let cursor =
			staged > 0
				? offsetY +
					Math.max(Math.round(source.height), 0) +
					CARD_EMBED_GAP
				: offsetY;
		for (const target of content.targets) {
			const picture = await stageEmbeddedPicture(
				app,
				ea,
				target,
				offsetX,
				cursor,
				width
			);
			if (!picture) continue;
			cursor += picture.height + CARD_EMBED_GAP;
			staged += 1;
		}

		return staged;
	}

	const vaultPath = typeof source.file === "string" ? source.file : "";
	const file = vaultPath ? resolveVaultFile(app, vaultPath) : null;
	if (!file) {
		throw new DrawingFailedError(
			t("error.sourceFileNotFound", {
				path: vaultPath || t("value.empty"),
			})
		);
	}

	// Interactive form only makes sense for files the user can actually read
	// inside the drawing -- notes and other drawings. A picture is already
	// fully represented by an image element.
	const wantsEmbed =
		embedMode === "interactive" && (kind === "note" || kind === "drawing");

	console.log(
		`[canvas-drag-merge] ${t("log.stagingIntoDrawing", {
			// The raw kind identifier is kept in the log, exactly as before.
			kind,
			form: t(wantsEmbed ? "form.interactive" : "form.image"),
			path: file.path,
		})}`
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
			`[canvas-drag-merge] ${t("log.embedFailedFallback")}`,
			file.path
		);
	}

	// `anchor` must stay FALSE. It used to be true for plain images, mirroring
	// the Excalidraw plugin's insert dialog; that made Excalidraw append
	// `|100%` to the stored file reference, which marks the element
	// `customData.isAnchored` -- documented in the Excalidraw plugin itself as
	// "used by the Excalidraw component to disable resizing of anchored
	// images". Its `scaleLoadedImage()` also resets an anchored element to the
	// image's natural pixel size on every load.
	const elementId = await ea.addImage(offsetX, offsetY, file, false, false);
	if (!elementId) {
		throw new DrawingFailedError(
			t("error.cannotRenderImage", { name: file.name })
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
	/** Insertion size for images in a newly created drawing, in percent. */
	imageScalePercent: number;
	/** Image snapshot or interactive embed, when adding files to a drawing. */
	drawingEmbedMode: DrawingEmbedMode;
	/**
	 * Sticky-note settings for text cards written into a drawing.
	 *
	 * Null keeps the old behaviour: a plain text element.
	 */
	stickyNotes: StickyNoteOptions | null;
	/** How picture embeds inside a text card are handled; see `cardcontent.ts`. */
	textCardEmbedMode: string;
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
			`[canvas-drag-merge] ${t("log.fileToLinktextFailed")}`,
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
				return {
					action,
					detail: t("detail.emptySourceCard"),
					changed: false,
				};
			}
			appendToCardText(target, markdown);
			return {
				action,
				detail: t("detail.textAppendedToCard"),
				changed: true,
				canvasChanged: true,
			};
		}

		case "insert-image-into-card": {
			const markdown = markdownFromNode(source, sourceKind);
			if (!markdown) {
				return { action, detail: t("detail.imageHasNoPath"), changed: false };
			}
			appendToCardText(target, markdown);
			return {
				action,
				detail: t("detail.imageEmbeddedInCard"),
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
				return {
					action,
					detail: t("detail.fileNotFound", {
						path: vaultPath || t("value.empty"),
					}),
					changed: false,
				};
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
				detail: t("detail.linkWrittenToCard", {
					kind: kindLabel(sourceKind),
					form: t(context.cardLinkEmbedded ? "form.embed" : "form.link"),
					link,
				}),
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
				return {
					action,
					detail: t("detail.targetNoteNotFound", { path: targetPath }),
					changed: false,
				};
			}
			const markdown = markdownFromNode(source, sourceKind);
			if (!markdown) {
				return {
					action,
					detail: t("detail.sourceHasNoContent"),
					changed: false,
				};
			}
			await appendToNote(context.app, noteFile, markdown);
			return {
				action,
				detail: t("detail.appendedToNote", { name: noteFile.name }),
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
				return {
					action,
					detail: t("detail.sourceNoteNotFound", { path: sourcePath }),
					changed: false,
				};
			}
			if (!targetFile) {
				return {
					action,
					detail: t("detail.targetNoteNotFound", { path: targetPath }),
					changed: false,
				};
			}
			if (sourceFile.path === targetFile.path) {
				return { action, detail: t("detail.sameNote"), changed: false };
			}

			const raw = await context.app.vault.read(sourceFile);
			const body = trimLeadingBlankLines(stripFrontmatter(raw));
			if (body.trim().length === 0) {
				return {
					action,
					detail: t("detail.sourceBodyEmpty"),
					changed: false,
				};
			}

			await appendToNote(context.app, targetFile, body);

			// Only the *file* deletion is optional here; removing the node is
			// handled by the caller like every other merge.
			let detail = t("detail.noteBodyAppended", {
				source: sourceFile.name,
				target: targetFile.name,
			});
			if (context.deleteSourceNoteFile) {
				await context.app.fileManager.trashFile(sourceFile);
				detail += t("detail.andTrashed");
			}
			return { action, detail, changed: true };
		}

		case "append-to-drawing": {
			if (!context.excalidraw) {
				return {
					action,
					detail: t("detail.excalidrawMissingForAppend"),
					changed: false,
				};
			}
			const targetPath = typeof target.file === "string" ? target.file : "";
			const drawingFile = targetPath
				? resolveVaultFile(context.app, targetPath)
				: null;
			if (!drawingFile) {
				return {
					action,
					detail: t("detail.drawingNotFound", { path: targetPath }),
					changed: false,
				};
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
						drawingFile.path,
						{
							stickyNotes: context.stickyNotes,
							textCardEmbedMode: context.textCardEmbedMode,
						}
					)
			);

			return {
				action,
				detail: t("detail.addedToDrawing", {
					kind: kindLabel(sourceKind),
					form: t(
						context.drawingEmbedMode === "interactive" &&
							(sourceKind === "note" || sourceKind === "drawing")
							? "form.interactive"
							: "form.image"
					),
					name: drawingFile.name,
					note,
				}),
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
					detail: t("detail.excalidrawMissingForMerge"),
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
				context.drawingFolder,
				context.imageScalePercent
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
				detail: t("detail.imagesMerged", { path: drawingPath }),
				changed: true,
				canvasChanged: true,
				// Both nodes are gone already -- the caller must not also remove
				// the dragged one, which would be a pointless second pass.
				consumesSource: false,
			};
		}

		default:
			return {
				action: "nothing",
				detail: t("detail.nothing"),
				changed: false,
			};
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
