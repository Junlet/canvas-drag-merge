/**
 * Plugin settings.
 *
 * Two decisions dominate the UX and both are explained where they are used:
 *   - which key arms the mode, and whether it is held or toggled
 *     (see `trigger.ts` for why single modifiers were dropped);
 *   - how destructive a merge is allowed to be.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type CanvasDragMergePlugin from "./main";
import {
	DEFAULT_TRIGGER_KEY,
	triggerKeyOptions,
	isKnownTriggerKey,
	isTriggerMode,
	type TriggerMode,
} from "./trigger";
import { isDrawingEmbedMode, type DrawingEmbedMode } from "./excalidraw";
import {
	DEFAULT_DRAWING_FOLDER,
	isFolderSetting,
	normalizeVaultFolder,
	resolveDrawingFolder,
} from "./folders";
import {
	isLanguageSetting,
	setLanguage,
	t,
	type LanguageSetting,
	type MessageKey,
} from "./i18n";

export { triggerKeyOptions } from "./trigger";
export type { TriggerMode } from "./trigger";
export type { TriggerOption } from "./trigger";

/**
 * The language dropdown rows, in display order.
 *
 * Written out rather than derived from the setting values so the keys stay
 * checked: a typo here is a compile error, not a missing string at runtime.
 */
const LANGUAGE_ROWS: ReadonlyArray<{
	value: LanguageSetting;
	key: MessageKey;
}> = [
	{ value: "auto", key: "settings.language.auto" },
	{ value: "zh", key: "settings.language.zh" },
	{ value: "en", key: "settings.language.en" },
];

/** Persisted plugin settings. */
export interface CanvasDragMergeSettings {
	/** Key combination that arms the merge mode. */
	triggerKey: string;
	/** Whether the trigger is held down or pressed to toggle. */
	triggerMode: TriggerMode;
	/**
	 * Whether the trigger only works while a Canvas is the active view.
	 *
	 * On by default: arming from a note or the settings tab does nothing useful
	 * and only produces a Notice, which is pure noise.
	 */
	canvasOnly: boolean;
	/** Whether the dragged node is removed from the Canvas after merging. */
	deleteSourceNode: boolean;
	/** Whether a source note whose body was consumed is trashed. */
	deleteSourceNoteFile: boolean;
	/** Whether mergeable targets are highlighted during a drag. */
	highlightTargets: boolean;
	/** Whether image-onto-image produces an Excalidraw drawing. */
	imagesToExcalidraw: boolean;
	/**
	 * How notes and drawings are represented when added to a drawing:
	 * a rendered picture, or a live interactive embed.
	 *
	 * Mirrors Excalidraw's own "从仓库中嵌入文件" dialog, which offers
	 * **以图像形式** and **以交互形式** side by side.
	 */
	drawingEmbedMode: DrawingEmbedMode;
	/**
	 * Vault folder new drawings are written into.
	 *
	 * Empty means "inherit the Excalidraw plugin's own folder setting".
	 */
	drawingFolder: string;
	/** Whether a `YYYY-MM` sub-folder is appended to {@link drawingFolder}. */
	monthSubfolders: boolean;
	/**
	 * Whether a note or drawing dropped on a text card is written as a
	 * transclusion (`![[file]]`) rather than a plain link (`[[file]]`).
	 */
	cardLinkEmbedded: boolean;
	/** Interface language: follow Obsidian, or pin Chinese / English. */
	language: LanguageSetting;
}

/**
 * Toggle by default.
 *
 * Holding a three-key combination while also dragging with the mouse is
 * awkward, and a toggle removes every problem a held key brings: no auto-repeat
 * to filter, no need to keep a modifier down mid-gesture, and no risk of the
 * mode being stuck because a keyup was swallowed.
 */
const DEFAULT_TRIGGER_MODE: TriggerMode = "toggle";

/** Arming outside a Canvas is noise; keep it scoped to Canvas by default. */
const DEFAULT_CANVAS_ONLY = true;

/**
 * The dragged node is removed by default: the gesture reads as "drag it onto
 * that one to merge it in", and leaving the source behind would leave two
 * overlapping cards holding the same content.
 */
const DEFAULT_DELETE_SOURCE_NODE = true;

/**
 * The source *note file* is deliberately **not** deleted by default.
 *
 * Removing a node is undoable by re-dragging; deleting a file is a vault
 * mutation that also breaks any links pointing at it. The note's body has been
 * copied to the target either way, so the safe default is to leave the file
 * alone.
 */
const DEFAULT_DELETE_SOURCE_NOTE_FILE = false;

/** Drag-time highlighting is a core part of the interaction, so it is on. */
const DEFAULT_HIGHLIGHT_TARGETS = true;

/** Asked for explicitly, so on. Degrades to a Notice when Excalidraw is absent. */
const DEFAULT_IMAGES_TO_EXCALIDRAW = true;

/**
 * Image form by default: it matches what the plugin did before this option
 * existed, and an interactive embed pulls the whole note into the drawing,
 * which is a bigger visual change to make silently.
 */
const DEFAULT_DRAWING_EMBED_MODE: DrawingEmbedMode = "image";

/**
 * Monthly sub-folders are on by default.
 *
 * A drawing per drag adds up quickly, and grouping by month keeps one folder
 * from growing without bound.
 */
const DEFAULT_MONTH_SUBFOLDERS = true;

/**
 * Card links are transclusions by default.
 *
 * The gesture reads as "drop this into the card", and `![[x]]` is what actually
 * shows the content there -- a drawing renders inline, a note is pulled in. The
 * plain `[[x]]` form is one click away for anyone who only wants a link.
 */
const DEFAULT_CARD_LINK_EMBEDDED = true;

/**
 * Chinese by default, not `"auto"`.
 *
 * `"auto"` would be the friendlier first run for a new install, but it would
 * also change the wording of every existing install the moment it updated. The
 * default keeps that wording byte-for-byte, and the language row is one click
 * away for anyone who wants English.
 */
const DEFAULT_LANGUAGE: LanguageSetting = "zh";

/** Settings used on first install and for any missing key. */
export const DEFAULT_SETTINGS: CanvasDragMergeSettings = {
	triggerKey: DEFAULT_TRIGGER_KEY,
	triggerMode: DEFAULT_TRIGGER_MODE,
	canvasOnly: DEFAULT_CANVAS_ONLY,
	deleteSourceNode: DEFAULT_DELETE_SOURCE_NODE,
	deleteSourceNoteFile: DEFAULT_DELETE_SOURCE_NOTE_FILE,
	highlightTargets: DEFAULT_HIGHLIGHT_TARGETS,
	imagesToExcalidraw: DEFAULT_IMAGES_TO_EXCALIDRAW,
	drawingEmbedMode: DEFAULT_DRAWING_EMBED_MODE,
	drawingFolder: DEFAULT_DRAWING_FOLDER,
	monthSubfolders: DEFAULT_MONTH_SUBFOLDERS,
	cardLinkEmbedded: DEFAULT_CARD_LINK_EMBEDDED,
	language: DEFAULT_LANGUAGE,
};

/**
 * Merges stored data over the defaults, rejecting unusable values.
 *
 * @param stored - Raw value from `loadData()`.
 * @returns Valid settings.
 */
export function normalizeSettings(
	stored: Partial<CanvasDragMergeSettings> | null
): CanvasDragMergeSettings {
	const merged = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	if (!isKnownTriggerKey(merged.triggerKey)) {
		merged.triggerKey = DEFAULT_SETTINGS.triggerKey;
	}
	if (!isTriggerMode(merged.triggerMode)) {
		merged.triggerMode = DEFAULT_SETTINGS.triggerMode;
	}
	if (typeof merged.canvasOnly !== "boolean") {
		merged.canvasOnly = DEFAULT_SETTINGS.canvasOnly;
	}
	if (typeof merged.deleteSourceNode !== "boolean") {
		merged.deleteSourceNode = DEFAULT_SETTINGS.deleteSourceNode;
	}
	if (typeof merged.deleteSourceNoteFile !== "boolean") {
		merged.deleteSourceNoteFile = DEFAULT_SETTINGS.deleteSourceNoteFile;
	}
	if (typeof merged.highlightTargets !== "boolean") {
		merged.highlightTargets = DEFAULT_SETTINGS.highlightTargets;
	}
	if (typeof merged.imagesToExcalidraw !== "boolean") {
		merged.imagesToExcalidraw = DEFAULT_SETTINGS.imagesToExcalidraw;
	}
	if (!isDrawingEmbedMode(merged.drawingEmbedMode)) {
		merged.drawingEmbedMode = DEFAULT_SETTINGS.drawingEmbedMode;
	}
	if (!isFolderSetting(merged.drawingFolder)) {
		merged.drawingFolder = DEFAULT_SETTINGS.drawingFolder;
	}
	if (typeof merged.monthSubfolders !== "boolean") {
		merged.monthSubfolders = DEFAULT_SETTINGS.monthSubfolders;
	}
	if (typeof merged.cardLinkEmbedded !== "boolean") {
		merged.cardLinkEmbedded = DEFAULT_SETTINGS.cardLinkEmbedded;
	}
	if (!isLanguageSetting(merged.language)) {
		merged.language = DEFAULT_SETTINGS.language;
	}
	return merged;
}

/** Settings tab shown under Settings -> Community plugins -> this plugin. */
export class CanvasDragMergeSettingTab extends PluginSettingTab {
	private readonly plugin: CanvasDragMergePlugin;

	constructor(app: App, plugin: CanvasDragMergePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Renders the two folder settings, keeping the example path live.
	 *
	 * A typed folder path is easy to get subtly wrong, so both descriptions show
	 * exactly where the next drawing would land and update as the controls
	 * change.
	 */
	private renderFolderSettings(containerEl: HTMLElement): void {
		const preview = (): string => {
			if (normalizeVaultFolder(this.plugin.settings.drawingFolder).length === 0) {
				return t("settings.folder.previewInherited");
			}
			const resolved = resolveDrawingFolder(
				this.plugin.settings.drawingFolder,
				this.plugin.settings.monthSubfolders
			);
			return `${resolved}/`;
		};

		let folderSetting: Setting;
		let monthSetting: Setting;

		const refresh = (): void => {
			folderSetting.setDesc(
				t("settings.folder.desc", { path: preview() })
			);
			monthSetting.setDesc(t("settings.month.desc", { path: preview() }));
		};

		folderSetting = new Setting(containerEl)
			.setName(t("settings.folder.name"))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_DRAWING_FOLDER)
					.setValue(this.plugin.settings.drawingFolder)
					.onChange(async (value) => {
						this.plugin.settings.drawingFolder = value;
						await this.plugin.saveSettings();
						refresh();
					})
			);

		monthSetting = new Setting(containerEl)
			.setName(t("settings.month.name"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.monthSubfolders)
					.onChange(async (value) => {
						this.plugin.settings.monthSubfolders = value;
						await this.plugin.saveSettings();
						refresh();
					})
			);

		refresh();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// The language row comes first so it is reachable even when the rest of
		// the pane is in a language the user cannot read.
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dropdown) => {
				for (const row of LANGUAGE_ROWS) {
					dropdown.addOption(row.value, t(row.key));
				}
				dropdown
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = isLanguageSetting(value)
							? value
							: DEFAULT_SETTINGS.language;
						await this.plugin.saveSettings();
						setLanguage(this.plugin.settings.language);
						// Re-render so the rest of the pane follows immediately.
						this.display();
					});
			});

		this.renderFolderSettings(containerEl);

		new Setting(containerEl)
			.setName(t("settings.triggerKey.name"))
			.setDesc(t("settings.triggerKey.desc"))
			.addDropdown((dropdown) => {
				for (const option of triggerKeyOptions()) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown
					.setValue(this.plugin.settings.triggerKey)
					.onChange(async (value) => {
						this.plugin.settings.triggerKey = isKnownTriggerKey(value)
							? value
							: DEFAULT_SETTINGS.triggerKey;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.triggerMode.name"))
			.setDesc(t("settings.triggerMode.desc"))
			.addDropdown((dropdown) => {
				// The values are matched against settings, so they stay as they
				// are; only the labels are translated.
				dropdown.addOption("toggle", t("settings.triggerMode.toggle"));
				dropdown.addOption("hold", t("settings.triggerMode.hold"));
				dropdown
					.setValue(this.plugin.settings.triggerMode)
					.onChange(async (value) => {
						this.plugin.settings.triggerMode = isTriggerMode(value)
							? value
							: DEFAULT_SETTINGS.triggerMode;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.canvasOnly.name"))
			.setDesc(t("settings.canvasOnly.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.canvasOnly)
					.onChange(async (value) => {
						this.plugin.settings.canvasOnly = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.highlight.name"))
			.setDesc(t("settings.highlight.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.highlightTargets)
					.onChange(async (value) => {
						this.plugin.settings.highlightTargets = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.imagesToExcalidraw.name"))
			.setDesc(t("settings.imagesToExcalidraw.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.imagesToExcalidraw)
					.onChange(async (value) => {
						this.plugin.settings.imagesToExcalidraw = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.embedMode.name"))
			.setDesc(t("settings.embedMode.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("image", t("settings.embedMode.image"));
				dropdown.addOption(
					"interactive",
					t("settings.embedMode.interactive")
				);
				dropdown
					.setValue(this.plugin.settings.drawingEmbedMode)
					.onChange(async (value) => {
						this.plugin.settings.drawingEmbedMode = isDrawingEmbedMode(
							value
						)
							? value
							: DEFAULT_SETTINGS.drawingEmbedMode;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.cardLink.name"))
			.setDesc(t("settings.cardLink.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cardLinkEmbedded)
					.onChange(async (value) => {
						this.plugin.settings.cardLinkEmbedded = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.deleteSourceNode.name"))
			.setDesc(t("settings.deleteSourceNode.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deleteSourceNode)
					.onChange(async (value) => {
						this.plugin.settings.deleteSourceNode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.deleteSourceNoteFile.name"))
			.setDesc(t("settings.deleteSourceNoteFile.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deleteSourceNoteFile)
					.onChange(async (value) => {
						this.plugin.settings.deleteSourceNoteFile = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.diagnostics.name"))
			.setDesc(t("settings.diagnostics.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.keyDiagnostics).onChange((value) => {
					this.plugin.keyDiagnostics = value;
				})
			);
	}
}
