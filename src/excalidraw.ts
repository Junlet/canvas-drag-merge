/**
 * Bridge into the Excalidraw plugin, for the image-onto-image rule.
 *
 * Ported (and trimmed to pictures only) from the `canvas-to-excalidraw` plugin.
 * Access path, documented by Excalidraw as the supported route for *other
 * plugins*:
 *
 *   app.plugins.plugins["obsidian-excalidraw-plugin"].ea.getAPI()
 *
 * `getAPI()` returns a fresh, dedicated `ExcalidrawAutomate`, and building a
 * drawing happens entirely on its in-memory workbench -- so this works with no
 * Excalidraw view open, which is the normal case when triggered from a Canvas.
 */

import type { App, TFile } from "obsidian";
import type { CanvasNodeData } from "./types";

/** Folder/id of the Excalidraw plugin in Obsidian's plugin registry. */
export const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";

/** How long to wait for the drawing file to appear on disk. */
const FILE_WAIT_TIMEOUT_MS = 5000;

/** Interval between existence checks while waiting for the drawing file. */
const FILE_WAIT_INTERVAL_MS = 50;

/** How a vault file is represented when it is added to a drawing. */
export type DrawingEmbedMode = "image" | "interactive";

/** The subset of ExcalidrawAutomate this plugin calls. */
export interface ExcalidrawAutomateLike {
	clear(): void;
	/**
	 * The view ExcalidrawAutomate treats as current.
	 *
	 * Public on the real class. `addEmbeddable()` needs it, and only reads two
	 * fields from it (see {@link addEmbeddableWithStubView}).
	 */
	targetView: unknown;
	addImage(
		topX: number,
		topY: number,
		imageFile: unknown,
		scale?: boolean,
		anchor?: boolean
	): Promise<string>;
	addText(
		topX: number,
		topY: number,
		text: string,
		formatting?: Record<string, unknown>,
		id?: string
	): string;
	/** Stages an interactive embeddable element. Returns its id, or null. */
	addEmbeddable(
		topX: number,
		topY: number,
		width: number,
		height: number,
		url?: string,
		file?: TFile
	): string | null;
	getElement(id: string): { width: number; height: number } | undefined;
	/** Reads an existing drawing's scene, for placing appended content. */
	getSceneFromFile(file: TFile): Promise<{
		elements?: Array<{
			x?: number;
			y?: number;
			width?: number;
			height?: number;
		}>;
	}>;
	create(params?: {
		filename?: string;
		foldername?: string;
		templatePath?: string;
		silent?: boolean;
	}): Promise<string>;
}

/** The Excalidraw plugin instance. */
interface ExcalidrawPluginLike {
	ea?: { getAPI(view?: unknown): ExcalidrawAutomateLike };
	settings?: { folder?: string };
	/**
	 * Excalidraw's own drawing test.
	 *
	 * Checks the `.excalidraw` extension, then the `excalidraw-plugin`
	 * frontmatter key, then its internal file cache -- so it already survives a
	 * rename, which a filename check cannot.
	 */
	isExcalidrawFile?(file: TFile): boolean;
}

/**
 * Reaches the Excalidraw plugin instance, or null when it is unavailable.
 *
 * @param app - The Obsidian app.
 * @returns The plugin, or null.
 */
export function getExcalidrawPlugin(app: App): ExcalidrawPluginLike | null {
	const registry = app as unknown as {
		plugins?: { plugins?: Record<string, unknown> };
	};
	return (registry.plugins?.plugins?.[EXCALIDRAW_PLUGIN_ID] as
		| ExcalidrawPluginLike
		| undefined) ?? null;
}

/** A live ExcalidrawAutomate plus the plugin that issued it. */
export interface ExcalidrawBridge {
	ea: ExcalidrawAutomateLike;
	plugin: ExcalidrawPluginLike;
}

/** Raised when the Excalidraw plugin is absent or too old. */
export class ExcalidrawUnavailableError extends Error {}

/** Raised when a drawing cannot be assembled from the given nodes. */
export class DrawingFailedError extends Error {}

/**
 * Raised when one labelled step of an append fails.
 *
 * The raw failures coming out of Excalidraw's renderer are things like
 * "Cannot read properties of null (reading 'path')", which say nothing about
 * what the plugin was doing. Naming the step turns that into something
 * actionable.
 */
export class AppendStepError extends Error {
	constructor(step: string, cause: unknown) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`${step}：${detail}`);
		this.name = "AppendStepError";
	}
}

/** Prefix for the throwaway drawing used to graft new content in. */
const TEMP_DRAWING_PREFIX = "canvas-drag-merge-tmp-";

/** Default size for an interactive embed when the source gives none. */
const EMBED_FALLBACK_SIZE = 400;

/**
 * Reports whether a value is a recognised embed mode.
 *
 * @param value - Candidate value.
 * @returns True for `"image"` or `"interactive"`.
 */
export function isDrawingEmbedMode(
	value: unknown
): value is DrawingEmbedMode {
	return value === "image" || value === "interactive";
}

/**
 * Stages an **interactive** embeddable element without an open Excalidraw view.
 *
 * The obstacle: `addEmbeddable()` bails out unless `ea.targetView._loaded` is
 * true, and it uses `targetView.file.path` to compute the link text. Both are
 * exactly satisfiable with a stub -- its body touches `targetView` nowhere else
 * -- and `setView()` cannot be used because it demands a real
 * `instanceof ExcalidrawView`.
 *
 * So `targetView` is assigned directly for the duration of the call and
 * restored afterwards. This is deliberately confined to one function: if a
 * future Excalidraw version starts reading more of `targetView` here, only this
 * helper needs revisiting, and the caller falls back to the image form.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param targetPath - Vault path of the drawing being written to.
 * @param topX - X position for the element.
 * @param topY - Y position for the element.
 * @param width - Element width.
 * @param height - Element height.
 * @param file - The vault file to embed.
 * @returns The element id, or null when staging failed.
 */
export function addEmbeddableWithStubView(
	ea: ExcalidrawAutomateLike,
	targetPath: string,
	topX: number,
	topY: number,
	width: number,
	height: number,
	file: TFile
): string | null {
	const previous = ea.targetView;
	ea.targetView = { _loaded: true, file: { path: targetPath } };
	try {
		return ea.addEmbeddable(
			topX,
			topY,
			width > 0 ? width : EMBED_FALLBACK_SIZE,
			height > 0 ? height : EMBED_FALLBACK_SIZE,
			undefined,
			file
		);
	} catch (error) {
		console.error(
			"[canvas-drag-merge] addEmbeddable() 失败，将回退为图像形式",
			error
		);
		return null;
	} finally {
		ea.targetView = previous;
	}
}

/**
 * Reports whether the Excalidraw plugin is installed and enabled.
 *
 * A cheap registry lookup with no instantiation, so it is safe to call from the
 * drag-time highlight on every throttled pointermove.
 *
 * @param app - The Obsidian app.
 * @returns True when the plugin is present.
 */
export function isExcalidrawEnabled(app: App): boolean {
	return getExcalidrawPlugin(app) !== null;
}

/**
 * Reaches the Excalidraw plugin and mints a dedicated ExcalidrawAutomate.
 *
 * @param app - The Obsidian app.
 * @returns The bridge, or null when Excalidraw is missing/disabled/incompatible.
 */
export function acquireExcalidraw(app: App): ExcalidrawBridge | null {
	const registry = app as unknown as {
		plugins?: { plugins?: Record<string, unknown> };
	};
	const plugin = registry.plugins?.plugins?.[EXCALIDRAW_PLUGIN_ID] as
		| ExcalidrawPluginLike
		| undefined;
	if (!plugin) return null;

	const factory = plugin.ea;
	if (!factory || typeof factory.getAPI !== "function") return null;

	try {
		const ea = factory.getAPI();
		if (!ea || typeof ea.create !== "function") return null;
		return { ea, plugin };
	} catch (error) {
		console.error("[canvas-drag-merge] ExcalidrawAutomate.getAPI() failed", error);
		return null;
	}
}

/**
 * Reads the folder Excalidraw is configured to write drawings into.
 *
 * @param plugin - The Excalidraw plugin instance.
 * @returns The configured vault folder, or undefined to let Excalidraw decide.
 */
export function getDrawingFolder(
	plugin: ExcalidrawPluginLike
): string | undefined {
	const folder = plugin.settings?.folder;
	if (typeof folder !== "string") return undefined;
	const trimmed = folder.replace(/^\/+|\/+$/gu, "").trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Creates the destination folder when it does not exist yet.
 *
 * Excalidraw's own `createDrawing()` already does this, but relying on an
 * internal step of another plugin for something the user configured explicitly
 * is fragile: if it ever stops, `vault.create()` throws and they see a bare
 * failure. Doing it here is cheap and removes that failure mode.
 *
 * @param app - The Obsidian app.
 * @param folder - Vault-relative folder path; empty means "let Excalidraw decide".
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	try {
		if (app.vault.getFolderByPath(folder)) return;
		await app.vault.createFolder(folder);
	} catch (error) {
		// createFolder throws when the folder appeared in the meantime, which
		// is not a failure worth reporting.
		console.warn(
			"[canvas-drag-merge] 创建文件夹时出错（可能已存在）：",
			folder,
			error
		);
	}
}

/**
 * Resolves a Canvas file node's path to a vault file.
 *
 * Falls back to Obsidian's link resolution: a Canvas node normally stores an
 * exact vault path, but a short or aliased path (`图.png` instead of
 * `Z附件库/图片库/图.png`) only resolves through the metadata cache.
 *
 * @param app - The Obsidian app.
 * @param vaultPath - Path as stored on the node.
 * @param sourcePath - Path of the file the reference came from, for resolution.
 * @returns The file, or null when it cannot be resolved.
 */
export function resolveVaultFile(
	app: App,
	vaultPath: string,
	sourcePath = ""
): TFile | null {
	const direct = app.vault.getFileByPath(vaultPath);
	if (direct) return direct;
	return app.metadataCache.getFirstLinkpathDest(vaultPath, sourcePath);
}

/**
 * Rescales a staged image element to fit the Canvas node's box.
 *
 * `addImage(..., scale = false)` stages the image at natural pixel size, so the
 * element's current `width`/`height` *are* the natural dimensions. Fitting them
 * into the node's box preserves the aspect ratio rather than stretching.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param elementId - Id returned by `addImage`.
 * @param boxWidth - Target width, from the Canvas node.
 * @param boxHeight - Target height, from the Canvas node.
 */
function fitElementToBox(
	ea: ExcalidrawAutomateLike,
	elementId: string,
	boxWidth: number,
	boxHeight: number
): void {
	const element = ea.getElement(elementId);
	if (!element) return;
	const naturalWidth = Number(element.width);
	const naturalHeight = Number(element.height);
	if (!(naturalWidth > 0) || !(naturalHeight > 0)) return;
	if (!(boxWidth > 0) || !(boxHeight > 0)) return;

	const ratio = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
	if (!Number.isFinite(ratio) || ratio <= 0) return;
	element.width = naturalWidth * ratio;
	element.height = naturalHeight * ratio;
}

/** Vertical gap between existing content and appended content. */
const APPEND_GAP = 80;

/**
 * Finds an open Excalidraw view for a given file.
 *
 * Only used to warn: writing the file while a view also holds it can be
 * overwritten by that view's next save.
 *
 * @param app - The Obsidian app.
 * @param path - Vault path of the drawing.
 * @returns True when some leaf currently shows that drawing.
 */
export function isDrawingOpen(app: App, path: string): boolean {
	let found = false;
	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view as {
			getViewType?: () => string;
			file?: { path: string };
		};
		if (
			view?.getViewType?.() === "excalidraw" &&
			view.file?.path === path
		) {
			found = true;
		}
	});
	return found;
}

/**
 * Works out where appended content should start, so it lands clear of what is
 * already in the drawing rather than on top of it.
 *
 * @param ea - The ExcalidrawAutomate instance.
 * @param targetFile - The drawing being appended to.
 * @returns A vertical offset to add to every staged element.
 */
async function computeAppendOffset(
	ea: ExcalidrawAutomateLike,
	targetFile: TFile
): Promise<number> {
	try {
		const scene = await ea.getSceneFromFile(targetFile);
		let bottom = 0;
		for (const element of scene?.elements ?? []) {
			const y = Number(element.y);
			const height = Number(element.height);
			if (!Number.isFinite(y)) continue;
			bottom = Math.max(bottom, y + (Number.isFinite(height) ? height : 0));
		}
		return bottom > 0 ? bottom + APPEND_GAP : 0;
	} catch (error) {
		console.error(
			"[canvas-drag-merge] getSceneFromFile() failed; appending at origin",
			error
		);
		return 0;
	}
}

/**
 * Appends content to an **existing** Excalidraw drawing.
 *
 * Why this is not a one-liner: ExcalidrawAutomate can create a drawing, but its
 * file creation goes through `vault.create()`, which refuses to overwrite. There
 * is no public "write this scene into an existing drawing file" call.
 *
 * The route taken here leans on a documented behaviour of `create()`: given a
 * `templatePath`, it loads that drawing -- **including its embedded files**,
 * because `create()` passes `loadFiles = true` whenever `exactPath` is unset --
 * and concatenates the template's elements in front of the workbench's. So a
 * throwaway drawing can be produced that is the old content plus the new, and
 * its text moved over the original. The original path is preserved, so links
 * pointing at the drawing keep working.
 *
 * @param app - The Obsidian app.
 * @param bridge - Live Excalidraw bridge.
 * @param targetFile - The drawing to append to.
 * @param stage - Stages the new elements on the workbench at the given offset.
 * @returns A note to surface when the drawing is currently open.
 * @throws {DrawingFailedError} When nothing could be staged.
 * @throws {ExcalidrawUnavailableError} When the temp drawing never appears.
 */
export async function appendToDrawing(
	app: App,
	bridge: ExcalidrawBridge,
	targetFile: TFile,
	stage: (offsetX: number, offsetY: number) => Promise<number>
): Promise<string> {
	const { ea } = bridge;
	const wasOpen = isDrawingOpen(app, targetFile.path);
	const offsetY = await computeAppendOffset(ea, targetFile);

	ea.clear();
	try {
		// ---- 1. render the incoming content onto the workbench -------------
		// For a drawing source this makes Excalidraw rasterise that drawing,
		// which is the most fragile step: a file with an `.excalidraw`
		// extension but non-drawing contents fails here.
		let placed = 0;
		try {
			placed = await stage(0, offsetY);
		} catch (error) {
			console.error("[canvas-drag-merge] 暂存内容失败", error);
			throw new AppendStepError(
				"无法把源内容渲染成图纸元素（该文件可能不是有效的 Excalidraw 图纸或笔记）",
				error
			);
		}
		if (placed === 0) {
			throw new DrawingFailedError("没有可加入图纸的内容。");
		}

		// ---- 2. build a superset drawing from the target as template ------
		// The temp file is *not* hidden: Obsidian does not index dot-files, and
		// an unindexed file breaks the plugin's own `isExcalidrawFile()` check
		// as well as any linkpath lookup pointing at it.
		const folder = targetFile.parent?.path ?? "";
		let createdPath: string;
		try {
			createdPath = await ea.create({
				filename: `${TEMP_DRAWING_PREFIX}${Date.now()}`,
				foldername: folder,
				templatePath: targetFile.path,
				silent: true,
			});
		} catch (error) {
			console.error("[canvas-drag-merge] 创建临时图纸失败", error);
			throw new AppendStepError("创建临时图纸失败", error);
		}
		if (typeof createdPath !== "string" || createdPath.length === 0) {
			throw new ExcalidrawUnavailableError(
				"Excalidraw 未返回临时图纸路径。"
			);
		}

		// ---- 3. wait for it to land on disk -------------------------------
		const tempFile = await waitForVaultFile(app, createdPath);
		if (!tempFile) {
			throw new ExcalidrawUnavailableError(
				`临时图纸未生成：${createdPath}`
			);
		}

		// ---- 4. move its contents over the original, then clean up --------
		try {
			const content = await app.vault.read(tempFile);
			await app.vault.modify(targetFile, content);
		} catch (error) {
			console.error("[canvas-drag-merge] 写回原图纸失败", error);
			throw new AppendStepError(
				`写回原图纸失败（临时文件 ${tempFile.path} 已保留，可手动检查）`,
				error
			);
		} finally {
			try {
				await app.vault.delete(tempFile);
			} catch (error) {
				console.error(
					"[canvas-drag-merge] 临时图纸删除失败，请手动清理：",
					tempFile.path,
					error
				);
			}
		}
	} finally {
		ea.clear();
	}

	return wasOpen
		? "（该图纸当前处于打开状态，请重新打开它以看到改动）"
		: "";
}

/**
 * Polls until a vault file appears.
 *
 * @param app - The Obsidian app.
 * @param path - Vault path to watch.
 * @returns The file once present, or null on timeout.
 */
async function waitForVaultFile(app: App, path: string): Promise<TFile | null> {
	const attempts = Math.ceil(FILE_WAIT_TIMEOUT_MS / FILE_WAIT_INTERVAL_MS);
	for (let attempt = 0; attempt <= attempts; attempt += 1) {
		const file = app.vault.getFileByPath(path);
		if (file) return file;
		await new Promise((resolve) =>
			window.setTimeout(resolve, FILE_WAIT_INTERVAL_MS)
		);
	}
	return null;
}

/**
 * Bounding box of a set of Canvas nodes.
 *
 * @param nodes - Nodes to measure.
 * @returns The union rectangle.
 */
function boundsOf(nodes: CanvasNodeData[]): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of nodes) {
		minX = Math.min(minX, node.x);
		minY = Math.min(minY, node.y);
		maxX = Math.max(maxX, node.x + node.width);
		maxY = Math.max(maxY, node.y + node.height);
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Writes a new drawing containing the given image nodes, laid out as on the
 * Canvas.
 *
 * The workbench is the only thing mutated: no scene and no vault file is
 * touched until `create()` succeeds, so a failure leaves everything as it was.
 *
 * @param app - The Obsidian app.
 * @param bridge - Live Excalidraw bridge.
 * @param nodes - Image nodes to place.
 * @param baseName - Collision-free base name (no extension).
 * @param folder - Destination folder, or undefined for Excalidraw's default.
 * @returns The created drawing's vault path.
 * @throws {DrawingFailedError} When no image could be placed.
 * @throws {ExcalidrawUnavailableError} When the file never materialises.
 */
export async function createDrawingFromImages(
	app: App,
	bridge: ExcalidrawBridge,
	nodes: CanvasNodeData[],
	baseName: string,
	folder: string | undefined
): Promise<string> {
	const { ea } = bridge;
	const bounds = boundsOf(nodes);
	let placed = 0;

	ea.clear();
	try {
		for (const node of nodes) {
			const vaultPath = typeof node.file === "string" ? node.file : "";
			const file = vaultPath ? resolveVaultFile(app, vaultPath) : null;
			if (!file) continue;

			const x = Math.round(node.x - bounds.minX);
			const y = Math.round(node.y - bounds.minY);
			const elementId = await ea.addImage(x, y, file, false, true);
			if (!elementId) continue;
			fitElementToBox(ea, elementId, node.width, node.height);
			placed += 1;
		}

		if (placed === 0) {
			throw new DrawingFailedError("没有任何图片能被放入图纸。");
		}

		await ensureFolder(app, folder ?? "");

		const createdPath = await ea.create({
			filename: baseName,
			foldername: folder,
			// `silent` writes the file without opening it or prompting.
			silent: true,
		});

		const file = await waitForVaultFile(app, createdPath);
		if (!file) {
			throw new ExcalidrawUnavailableError(
				`Excalidraw 未能在预期时间内创建文件：${createdPath}`
			);
		}
		return file.path;
	} finally {
		// Always discard the workbench, including on the error paths above.
		ea.clear();
	}
}
