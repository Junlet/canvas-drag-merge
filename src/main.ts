/**
 * Canvas Drag Merge
 * =================
 *
 * Arm a mode with a key combination, drag a Canvas node onto another, and the
 * two are merged on release.
 *
 * The rule table, as specified:
 *
 *   dragged \ target | text card            | image                  | md note
 *   -----------------+----------------------+------------------------+------------------
 *   text card        | copy text in         | nothing                | append to note
 *   image            | embed image in card  | both -> Excalidraw file| append to note
 *   md note          | nothing              | nothing                | append body to note
 *
 * Link and group nodes never participate in either role -- see
 * `resolveMergeAction`.
 *
 * SCOPE
 * -----
 * With `canvasOnly` on (the default) the trigger only does anything while a
 * Canvas is the active view, and it produces no Notice anywhere else. That also
 * means no other page's shortcuts are affected: the only key ever swallowed is
 * Tab, and only inside a Canvas.
 *
 * HOW A DRAG IS DETECTED
 * ----------------------
 * Canvas exposes no drag event, and the `advanced-canvas` plugin obtains one by
 * monkey-patching the internal `canvas.setDragging()`. Patching shared internals
 * would risk fighting that plugin over the same method, so this uses geometry:
 * snapshot every node's position on pointer-down, diff on pointer-up, and
 * whatever moved was dragged. Panning, zooming and rubber-band selection do not
 * change node coordinates, so the diff stays empty and nothing misfires.
 *
 * ORDER OF WRITES
 * ---------------
 * Vault files are written before the Canvas document. A failed file write
 * therefore leaves the Canvas untouched and the user still holding their nodes.
 */

import { Notice, Plugin, View } from "obsidian";
import {
	CanvasUnavailableError,
	hasEditingNode,
	readCanvasData,
	type CanvasLike,
	type CanvasNodeData,
	type CanvasData,
} from "./types";
import {
	findBestOverlaps,
	findMovedNodes,
	snapshotPositions,
	type PositionSnapshot,
} from "./drag";
import {
	hasDefaultAction,
	matchesTrigger,
	parseTrigger,
	type TriggerSpec,
} from "./trigger";
import {
	actionLabel,
	classifyNode as classifyNodePure,
	kindLabel,
	resolveMergeAction,
	type MergeAction,
	type NodeKind,
} from "./nodes";
import { executeMerge, removeNodes, type MergeContext } from "./merge";
import { readLiveNodes } from "./live";
import { MergeHighlighter, type HighlightTarget } from "./highlight";
import { normalizeVaultFolder, resolveDrawingFolder } from "./folders";
import {
	acquireExcalidraw,
	getDrawingFolder,
	getExcalidrawPlugin,
	isExcalidrawEnabled,
	type ExcalidrawBridge,
} from "./excalidraw";
import { classifyNode, marksDrawing, type DrawingProbe } from "./nodes";
import {
	CanvasDragMergeSettingTab,
	DEFAULT_SETTINGS,
	normalizeSettings,
	type CanvasDragMergeSettings,
} from "./settings";
import { setLanguage, t } from "./i18n";

/** How long to keep result Notices on screen. */
const NOTICE_DURATION_MS = 8000;

/** How long to wait after pointer-up before touching the Canvas. */
const POST_DRAG_DELAY_MS = 0;

/** Minimum gap between drag-time highlight updates, in milliseconds. */
const HIGHLIGHT_THROTTLE_MS = 60;

/** An in-flight drag, captured on pointer-down. */
interface DragSession {
	canvas: CanvasLike;
	positions: PositionSnapshot;
}

export default class CanvasDragMergePlugin extends Plugin {
	settings: CanvasDragMergeSettings = DEFAULT_SETTINGS;

	/** True while the mode is armed. */
	private modeActive = false;

	/** The drag currently being tracked, if any. */
	private drag: DragSession | null = null;

	/** True while a merge is running, to ignore re-entrant input. */
	private busy = false;

	/** When true, every key event is logged to the console. */
	keyDiagnostics = false;

	/** Parsed form of the configured trigger combination. */
	private trigger: TriggerSpec = parseTrigger(DEFAULT_SETTINGS.triggerKey);

	/** Applies and clears the drag-time merge-target highlight. */
	private readonly highlighter = new MergeHighlighter();

	/**
	 * Metadata-aware drawing test, built once at load.
	 *
	 * Only consulted when the filename does not already end in `.excalidraw`,
	 * so a renamed drawing is still recognised instead of being mistaken for a
	 * plain note -- which would append its scene JSON into a note as prose.
	 */
	private readonly drawingProbe: DrawingProbe = (vaultPath: string) =>
		this.probeDrawing(vaultPath);

	/** Timestamp of the last highlight update, for throttling pointermove. */
	private lastHighlightAt = 0;

	/** Status-bar element shown while the mode is armed. */
	private statusBarEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		// Before anything renders text: the language must be in effect for the
		// settings tab, the commands and every Notice below.
		setLanguage(this.settings.language);
		this.addSettingTab(new CanvasDragMergeSettingTab(this.app, this));

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("canvas-drag-merge-status");
		this.renderStatusBar();

		// Capture phase: Canvas may stop propagation, and capture runs first.
		this.registerDomEvent(document, "keydown", this.onKeyDown, true);
		this.registerDomEvent(document, "keyup", this.onKeyUp, true);

		// A missed keyup (window switch, OS interception) would otherwise leave
		// the mode stuck, so losing focus always disarms it.
		this.registerDomEvent(window, "blur", this.disarmMode);

		this.registerDomEvent(document, "pointerdown", this.onPointerDown, true);
		this.registerDomEvent(document, "pointermove", this.onPointerMove, true);
		this.registerDomEvent(document, "pointerup", this.onPointerUp, true);
		this.registerDomEvent(document, "pointercancel", this.onPointerUp, true);

		// Leaving a Canvas disarms the mode, so it can never be "on" somewhere
		// it does nothing.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.modeActive && !this.isCanvasActive()) {
					this.disarmMode();
				}
			})
		);

		this.addCommand({
			id: "toggle-key-diagnostics",
			name: t("command.toggleKeyDiagnostics"),
			callback: () => {
				this.keyDiagnostics = !this.keyDiagnostics;
				new Notice(
					this.keyDiagnostics
						? t("notice.keyDiagnosticsOn")
						: t("notice.keyDiagnosticsOff")
				);
			},
		});

		this.addCommand({
			id: "arm-merge-mode",
			name: t("command.armMergeMode"),
			checkCallback: (checking: boolean) => {
				if (!this.isCanvasActive()) return false;
				if (!checking) this.armMode();
				return true;
			},
		});

		console.log(
			`[canvas-drag-merge] ${t("log.loaded", {
				key: this.settings.triggerKey,
				mode: this.settings.triggerMode,
			})}`
		);
	}

	onunload(): void {
		this.highlighter.clear();
		this.drag = null;
		this.modeActive = false;
		this.statusBarEl = null;
	}

	// -- key handling ------------------------------------------------------

	/** Handles key-down. */
	private onKeyDown = (event: KeyboardEvent): void => {
		if (this.keyDiagnostics) {
			console.log(
				`[canvas-drag-merge] ${t("log.keydown", {
					key: event.key,
					ctrl: String(event.ctrlKey),
					alt: String(event.altKey),
					shift: String(event.shiftKey),
					meta: String(event.metaKey),
					repeat: String(event.repeat),
				})}`
			);
		}

		// Escape is always an escape hatch, whatever the trigger is.
		if (event.key === "Escape" && this.modeActive) {
			this.disarmMode();
			new Notice(t("notice.modeClosed"));
			return;
		}

		if (!matchesTrigger(event, this.trigger)) return;

		// Nothing happens outside a Canvas when scoped -- no arming, no Notice,
		// and no key swallowed, so other views keep every shortcut.
		if (this.settings.canvasOnly && !this.isCanvasActive()) return;

		// Tab has a default action (move focus) and auto-repeats while held.
		// Swallowing it is what makes Tab usable; the editor keeps it when a
		// node is being edited, so indentation still works.
		if (hasDefaultAction(this.trigger)) {
			const canvas = this.resolveActiveCanvas();
			if (canvas && !hasEditingNode(canvas)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}

		// Auto-repeat would otherwise re-fire this handler dozens of times.
		if (event.repeat) return;

		if (this.settings.triggerMode === "toggle") {
			if (this.modeActive) this.disarmMode();
			else this.armMode();
			return;
		}

		// Hold mode: keydown only arms; keyup disarms.
		if (!this.modeActive) this.armMode();
	};

	/** Handles key-up, which only matters in hold mode. */
	private onKeyUp = (event: KeyboardEvent): void => {
		if (this.keyDiagnostics) {
			console.log(
				`[canvas-drag-merge] ${t("log.keyup", {
					key: event.key,
					code: event.code,
				})}`
			);
		}
		if (this.settings.triggerMode !== "hold") return;
		if (!matchesTrigger(event, this.trigger)) return;
		this.disarmMode();
	};

	/** Arms the merge mode. */
	private armMode(): void {
		if (this.modeActive) return;
		this.modeActive = true;
		this.renderStatusBar();
		console.log(`[canvas-drag-merge] ${t("log.modeArmed")}`);
		new Notice(
			t(
				this.settings.triggerMode === "toggle"
					? "notice.modeArmedToggle"
					: "notice.modeArmedHold",
				{ key: this.settings.triggerKey }
			),
			NOTICE_DURATION_MS
		);
	}

	/** Disarms the merge mode. Safe to call when already disarmed. */
	private disarmMode = (): void => {
		this.drag = null;
		this.highlighter.clear();
		if (!this.modeActive) return;
		this.modeActive = false;
		this.renderStatusBar();
		console.log(`[canvas-drag-merge] ${t("log.modeDisarmed")}`);
	};

	/** Shows or hides the status-bar indicator. */
	private renderStatusBar(): void {
		if (!this.statusBarEl) return;
		this.statusBarEl.setText(this.modeActive ? t("status.armed") : "");
		this.statusBarEl.toggleClass("is-active", this.modeActive);
	}

	// -- drag handling -----------------------------------------------------

	/** Snapshots node positions when a drag may be starting. */
	private onPointerDown = (): void => {
		if (!this.modeActive || this.busy) return;

		const canvas = this.resolveActiveCanvas();
		if (!canvas) return;

		try {
			const data = readCanvasData(canvas);
			this.drag = { canvas, positions: snapshotPositions(data.nodes) };
		} catch (error) {
			console.error(`[canvas-drag-merge] ${t("log.snapshotFailed")}`, error);
			this.drag = null;
		}
	};

	/** Updates the merge-target highlight while a drag is in flight. */
	private onPointerMove = (): void => {
		if (!this.modeActive || !this.drag || this.busy) return;
		if (!this.settings.highlightTargets) return;

		const now = Date.now();
		if (now - this.lastHighlightAt < HIGHLIGHT_THROTTLE_MS) return;
		this.lastHighlightAt = now;

		const canvas = this.drag.canvas;
		const live = readLiveNodes(canvas);
		if (live.length === 0) return;

		const moving = findMovedNodes(this.drag.positions, live);
		if (moving.length === 0) {
			this.highlighter.clear();
			return;
		}

		this.highlighter.apply(canvas, this.mergeableTargets(moving, live));
	};

	/** On release, diffs the snapshot and performs the merge. */
	private onPointerUp = (): void => {
		const session = this.drag;
		this.drag = null;
		this.highlighter.clear();
		if (!this.modeActive || !session || this.busy) return;

		// Defer so Obsidian's own drag-end bookkeeping finishes first.
		window.setTimeout(() => {
			void this.handleDrag(session);
		}, POST_DRAG_DELAY_MS);
	};

	/**
	 * Decides whether a file is an Excalidraw drawing when its name says nothing.
	 *
	 * Asks the Excalidraw plugin first -- its `isExcalidrawFile()` is the
	 * authority and already handles renames -- then falls back to reading the
	 * frontmatter and tags directly, so a rename is still recognised even if
	 * the plugin's API changes.
	 *
	 * @param vaultPath - The Canvas node's `file` value.
	 * @returns True when the file is a drawing.
	 */
	private probeDrawing(vaultPath: string): boolean {
		if (!vaultPath) return false;
		const file = this.app.vault.getFileByPath(vaultPath);
		if (!file) return false;

		const plugin = getExcalidrawPlugin(this.app);
		if (typeof plugin?.isExcalidrawFile === "function") {
			try {
				if (plugin.isExcalidrawFile(file)) return true;
			} catch (error) {
				console.error(
					`[canvas-drag-merge] ${t("log.isExcalidrawFileFailed")}`,
					error
				);
			}
		}

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			return marksDrawing(cache?.frontmatter, cache?.tags);
		} catch (error) {
			console.error(
				`[canvas-drag-merge] ${t("log.readMetadataFailed")}`,
				error
			);
			return false;
		}
	}

	/**
	 * Classifies a node, with the metadata-aware drawing fallback applied.
	 *
	 * @param node - Node data.
	 * @returns The node kind.
	 */
	private classify(node: CanvasNodeData): NodeKind {
		return classifyNodePure(node, this.drawingProbe);
	}

	/**
	 * Builds the highlight list for the nodes currently being dragged.
	 *
	 * @param moving - Nodes detected as being dragged.
	 * @param live - Every node's current geometry.
	 * @returns Targets to highlight, with their action labels.
	 */
	private mergeableTargets(
		moving: CanvasNodeData[],
		live: CanvasNodeData[]
	): HighlightTarget[] {
		const targets: HighlightTarget[] = [];
		for (const overlap of findBestOverlaps(moving, live)) {
			const action = resolveMergeAction(
				this.classify(overlap.moved),
				this.classify(overlap.target)
			);
			if (!this.isActionAvailable(action)) continue;
			targets.push({
				id: overlap.target.id,
				hint: actionLabel(action),
			});
		}
		return targets;
	}

	/**
	 * Whether an action can actually run, given the current settings.
	 *
	 * The image rule silently degrades to "nothing" when it is switched off, so
	 * the highlight stays truthful.
	 *
	 * @param action - The resolved action.
	 * @returns True when the action would do something.
	 */
	private isActionAvailable(action: MergeAction): boolean {
		if (action === "nothing") return false;
		if (action === "merge-images-into-excalidraw") {
			return this.settings.imagesToExcalidraw && isExcalidrawEnabled(this.app);
		}
		if (action === "append-to-drawing") {
			return isExcalidrawEnabled(this.app);
		}
		return true;
	}

	/**
	 * Diffs the snapshot, resolves the rules, and applies the merges.
	 *
	 * @param session - The drag captured on pointer-down.
	 */
	private async handleDrag(session: DragSession): Promise<void> {
		this.busy = true;
		try {
			if (session.canvas.readonly) {
				new Notice(t("notice.canvasReadonly"), NOTICE_DURATION_MS);
				return;
			}

			const data = readCanvasData(session.canvas);
			const moved = findMovedNodes(session.positions, data.nodes);
			// Expected for panning, zooming and rubber-band selection.
			if (moved.length === 0) return;

			const overlaps = findBestOverlaps(moved, data.nodes);
			if (overlaps.length === 0) {
				new Notice(
					t("notice.noOverlap", { count: moved.length }),
					NOTICE_DURATION_MS
				);
				return;
			}

			await this.applyMerges(session.canvas, data, overlaps);
		} catch (error) {
			console.error(`[canvas-drag-merge] ${t("log.mergeFailed")}`, error);
			new Notice(
				t("notice.mergeFailed", {
					error:
						error instanceof CanvasUnavailableError
							? error.message
							: String(error),
				}),
				NOTICE_DURATION_MS
			);
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Runs every detected merge and writes the result back.
	 *
	 * @param canvas - The Canvas instance.
	 * @param data - A live Canvas document, mutated in place.
	 * @param overlaps - Detected (dragged, target, area) triples.
	 */
	private async applyMerges(
		canvas: CanvasLike,
		data: CanvasData,
		overlaps: ReturnType<typeof findBestOverlaps>
	): Promise<void> {
		const bridge = this.acquireBridge();
		const context: MergeContext = {
			app: this.app,
			data,
			deleteSourceNode: this.settings.deleteSourceNode,
			deleteSourceNoteFile: this.settings.deleteSourceNoteFile,
			cardLinkEmbedded: this.settings.cardLinkEmbedded,
			sourcePath: this.resolveActiveCanvasPath(),
			excalidraw: bridge,
			drawingFolder: bridge
				? resolveDrawingFolder(
						// An empty setting means "inherit the Excalidraw plugin's
						// own folder setting", not the vault root: a falsy
						// `foldername` is treated by ExcalidrawAutomate as "use
						// my configured folder", so "" could never mean the root.
						normalizeVaultFolder(this.settings.drawingFolder)
							.length > 0
							? normalizeVaultFolder(this.settings.drawingFolder)
							: (getDrawingFolder(bridge.plugin) ?? ""),
						this.settings.monthSubfolders
					)
				: undefined,
			drawingEmbedMode: this.settings.drawingEmbedMode,
			createNodeId: (taken) => createNodeId(taken),
		};

		const summaries: string[] = [];
		/** Sources whose content was consumed and which may now be removed. */
		const consumed = new Set<string>();
		let canvasChanged = false;

		for (const overlap of overlaps) {
			const sourceKind = this.classify(overlap.moved);
			const targetKind = this.classify(overlap.target);
			const action = resolveMergeAction(sourceKind, targetKind);
			const pair = `${kindLabel(sourceKind)} → ${kindLabel(targetKind)}`;

			if (!this.isActionAvailable(action)) {
				if (action === "merge-images-into-excalidraw") {
					summaries.push(
						t("summary.imagesToExcalidrawDisabled", { pair })
					);
				}
				continue;
			}

			try {
				const outcome = await executeMerge(
					context,
					overlap.moved,
					overlap.target,
					action,
					sourceKind,
					targetKind
				);
				summaries.push(
					t("summary.pairDetail", { pair, detail: outcome.detail })
				);
				if (outcome.changed && outcome.consumesSource !== false) {
					consumed.add(overlap.moved.id);
				}
				if (outcome.canvasChanged) canvasChanged = true;
			} catch (error) {
				console.error(
					`[canvas-drag-merge] ${t("log.singleMergeFailed")}`,
					error
				);
				summaries.push(
					t("summary.pairFailed", {
						pair,
						error:
							error instanceof Error ? error.message : String(error),
					})
				);
			}
		}

		if (summaries.length === 0) return;

		if (this.settings.deleteSourceNode && consumed.size > 0) {
			const removed = removeNodes(data, consumed);
			if (removed.nodes > 0) {
				canvasChanged = true;
				summaries.push(
					t("summary.removedNodes", { count: removed.nodes }) +
						(removed.edges > 0
							? t("summary.removedEdges", {
									count: removed.edges,
								})
							: "")
				);
			}
		} else if (consumed.size > 0) {
			summaries.push(t("summary.sourceKept"));
		}

		if (canvasChanged) await this.writeCanvas(canvas, data);

		const message = summaries.join(t("summary.separator"));
		console.log(`[canvas-drag-merge] ${t("log.mergeDone")}`, message);
		new Notice(`✅ ${message}`, NOTICE_DURATION_MS);

		// In toggle mode a completed gesture ends the session, so an accidental
		// second drag cannot silently merge something else.
		if (this.settings.triggerMode === "toggle") this.disarmMode();
	}

	/**
	 * Writes a Canvas document back and persists it.
	 *
	 * @param canvas - The Canvas instance.
	 * @param data - The document to write.
	 */
	private async writeCanvas(
		canvas: CanvasLike,
		data: CanvasData
	): Promise<void> {
		if (typeof canvas.setData !== "function") {
			throw new CanvasUnavailableError(t("error.canvasNoSetData"));
		}
		await canvas.setData(data);
		if (typeof canvas.requestSave === "function") {
			await canvas.requestSave();
		}
	}

	// -- helpers -----------------------------------------------------------

	/**
	 * Acquires the Excalidraw bridge only when the image rule could need it.
	 *
	 * @returns The bridge, or null when Excalidraw is unavailable.
	 */
	private acquireBridge(): ExcalidrawBridge | null {
		if (!this.settings.imagesToExcalidraw) return null;
		return acquireExcalidraw(this.app);
	}

	/**
	 * Reports whether a Canvas is the active view.
	 *
	 * @returns True when the active leaf holds a Canvas.
	 */
	private isCanvasActive(): boolean {
		return this.resolveActiveCanvas() !== null;
	}

	/**
	 * Finds the Canvas open in the active leaf.
	 *
	 * @returns The Canvas instance, or null when the active view is not one.
	 */
	private resolveActiveCanvas(): CanvasLike | null {
		const view = this.app.workspace.getActiveViewOfType(View);
		if (!view || view.getViewType() !== "canvas") return null;
		const internal = view as unknown as { canvas?: CanvasLike };
		return internal.canvas ?? null;
	}

	/**
	 * Vault path of the Canvas currently open, used as the base for link
	 * resolution so inserted `[[links]]` match what Obsidian itself would write.
	 *
	 * @returns The path, or an empty string when it cannot be determined.
	 */
	private resolveActiveCanvasPath(): string {
		const view = this.app.workspace.getActiveViewOfType(View);
		const file = (view as unknown as { file?: { path?: string } } | null)?.file;
		return typeof file?.path === "string" ? file.path : "";
	}

	/** Loads persisted settings, falling back to defaults. */
	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.trigger = parseTrigger(this.settings.triggerKey);
	}

	/** Persists the current settings. */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Keep the parsed trigger in step with the stored value.
		this.trigger = parseTrigger(this.settings.triggerKey);
	}
}

/**
 * Generates an id for a node inserted back into the Canvas.
 *
 * Canvas ids are 16 hex characters; uniqueness is checked against the ids
 * already present.
 *
 * @param taken - Ids already used in the Canvas document.
 * @returns A fresh, unused id.
 */
function createNodeId(taken: Set<string>): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const cryptoApi = globalThis.crypto as Crypto | undefined;
		const candidate =
			cryptoApi && typeof cryptoApi.randomUUID === "function"
				? cryptoApi.randomUUID().replace(/-/gu, "").slice(0, 16)
				: Math.random().toString(16).slice(2, 18);
		if (!taken.has(candidate)) return candidate;
	}
	return Math.random().toString(16).slice(2, 18);
}
