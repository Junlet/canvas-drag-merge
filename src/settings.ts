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
	DEFAULT_IMAGE_SCALE,
	IMAGE_SCALE_MAX,
	IMAGE_SCALE_MIN,
	IMAGE_SCALE_STEP,
	normalizeImageScale,
} from "./sizing";
import {
	isStickyBackgroundMode,
	isStickySizeMode,
	isStickyTextAlign,
	MIN_STICKY_HEIGHT,
	MIN_STICKY_WIDTH,
} from "./sticky";
import { isEmbedMode } from "./cardcontent";
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
	 * Insertion size for images in a newly created drawing, in percent.
	 *
	 * `100` keeps each image at the size of the Canvas node it came from. Only
	 * applies when a drawing is created -- appending into an existing drawing
	 * uses the source node's own size.
	 */
	imageScale: number;

	/**
	 * Turn a text card into an Excalidraw sticky note when it is merged into a
	 * drawing.
	 *
	 * Off by default: a sticky note is a visibly different object (a coloured
	 * container with a fitted label) from the plain text element this plugin has
	 * always written, so switching it on is a deliberate choice.
	 */
	stickyNoteEnabled: boolean;
	/** `card` (follow the Canvas card's box) | `fixed`. */
	stickyNoteSizeMode: string;
	/** Note width, used when {@link stickyNoteSizeMode} is `fixed`. */
	stickyNoteWidth: number;
	/** Note height, used when {@link stickyNoteSizeMode} is `fixed`. */
	stickyNoteHeight: number;
	/** Maximum label font size; Excalidraw shrinks it further to fit. */
	stickyNoteFontSize: number;
	/** `left` | `center` | `right`. */
	stickyNoteTextAlign: string;
	/** `follow` (card colour, lightened) | `custom` | `keep`. */
	stickyNoteBackgroundMode: string;
	/** Fill used when {@link stickyNoteBackgroundMode} is `custom`. */
	stickyNoteBackgroundColor: string;
	/**
	 * What to do with Markdown picture embeds inside a text card.
	 *
	 * `keep` copies the marker verbatim, `text` reduces it to the file name,
	 * `image` places the picture below the card.
	 */
	textCardEmbedMode: string;
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
	imageScale: DEFAULT_IMAGE_SCALE,
	stickyNoteEnabled: false,
	stickyNoteSizeMode: "card",
	stickyNoteWidth: 240,
	stickyNoteHeight: 160,
	stickyNoteFontSize: 20,
	stickyNoteTextAlign: "left",
	stickyNoteBackgroundMode: "follow",
	stickyNoteBackgroundColor: "#ffec99",
	textCardEmbedMode: "image",
	cardLinkEmbedded: DEFAULT_CARD_LINK_EMBEDDED,
	language: DEFAULT_LANGUAGE,
};

/** Highest accepted note dimension, in pixels. */
const STICKY_NOTE_SIZE_MAX = 600;

/** Range accepted for a note width, in pixels. */
const STICKY_NOTE_WIDTH_RANGE: readonly [number, number] = [
	MIN_STICKY_WIDTH,
	STICKY_NOTE_SIZE_MAX,
];

/** Range accepted for a note height, in pixels. */
const STICKY_NOTE_HEIGHT_RANGE: readonly [number, number] = [
	MIN_STICKY_HEIGHT,
	STICKY_NOTE_SIZE_MAX,
];

/** Range accepted for the note's label font size. */
const STICKY_NOTE_FONT_RANGE: readonly [number, number] = [8, 48];

/**
 * Coerces a stored number into a range.
 *
 * @param value - Raw stored value.
 * @param range - Lowest and highest accepted values.
 * @param fallback - Value used when the input is not a number.
 * @returns A whole number inside the range.
 */
function clampNumber(
	value: unknown,
	range: readonly [number, number],
	fallback: number
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(range[1], Math.max(range[0], Math.round(value)));
}

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
	merged.imageScale = normalizeImageScale(merged.imageScale);

	if (typeof merged.stickyNoteEnabled !== "boolean") {
		merged.stickyNoteEnabled = DEFAULT_SETTINGS.stickyNoteEnabled;
	}
	if (!isStickySizeMode(merged.stickyNoteSizeMode)) {
		merged.stickyNoteSizeMode = DEFAULT_SETTINGS.stickyNoteSizeMode;
	}
	if (!isStickyTextAlign(merged.stickyNoteTextAlign)) {
		merged.stickyNoteTextAlign = DEFAULT_SETTINGS.stickyNoteTextAlign;
	}
	if (!isStickyBackgroundMode(merged.stickyNoteBackgroundMode)) {
		merged.stickyNoteBackgroundMode =
			DEFAULT_SETTINGS.stickyNoteBackgroundMode;
	}
	merged.stickyNoteWidth = clampNumber(
		merged.stickyNoteWidth,
		STICKY_NOTE_WIDTH_RANGE,
		DEFAULT_SETTINGS.stickyNoteWidth
	);
	merged.stickyNoteHeight = clampNumber(
		merged.stickyNoteHeight,
		STICKY_NOTE_HEIGHT_RANGE,
		DEFAULT_SETTINGS.stickyNoteHeight
	);
	merged.stickyNoteFontSize = clampNumber(
		merged.stickyNoteFontSize,
		STICKY_NOTE_FONT_RANGE,
		DEFAULT_SETTINGS.stickyNoteFontSize
	);
	if (
		typeof merged.stickyNoteBackgroundColor !== "string" ||
		!/^#[0-9a-f]{6}$/iu.test(merged.stickyNoteBackgroundColor.trim())
	) {
		merged.stickyNoteBackgroundColor =
			DEFAULT_SETTINGS.stickyNoteBackgroundColor;
	}
	if (!isEmbedMode(merged.textCardEmbedMode)) {
		merged.textCardEmbedMode = DEFAULT_SETTINGS.textCardEmbedMode;
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

	/**
	 * Renders the sticky-note rows.
	 *
	 * Only the rows that currently matter are shown: the two size sliders appear
	 * for the "fixed" rule, and the colour picker for the "custom" fill, so the
	 * pane stays short and the interaction between the rows is obvious.
	 *
	 * @param containerEl - The settings pane.
	 */
	private renderStickySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("settings.sticky.sizeMode.name"))
			.setDesc(t("settings.sticky.sizeMode.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"card",
					t("settings.sticky.sizeMode.card")
				);
				dropdown.addOption(
					"fixed",
					t("settings.sticky.sizeMode.fixed")
				);
				dropdown
					.setValue(this.plugin.settings.stickyNoteSizeMode)
					.onChange(async (value) => {
						this.plugin.settings.stickyNoteSizeMode =
							isStickySizeMode(value)
								? value
								: DEFAULT_SETTINGS.stickyNoteSizeMode;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.stickyNoteSizeMode === "fixed") {
			this.renderStickySizeSlider(
				containerEl,
				t("settings.sticky.width.name"),
				t("settings.sticky.width.desc"),
				MIN_STICKY_WIDTH,
				() => this.plugin.settings.stickyNoteWidth,
				(value) => {
					this.plugin.settings.stickyNoteWidth = value;
				}
			);
			this.renderStickySizeSlider(
				containerEl,
				t("settings.sticky.height.name"),
				t("settings.sticky.height.desc"),
				MIN_STICKY_HEIGHT,
				() => this.plugin.settings.stickyNoteHeight,
				(value) => {
					this.plugin.settings.stickyNoteHeight = value;
				}
			);
		}

		new Setting(containerEl)
			.setName(t("settings.sticky.fontSize.name"))
			.setDesc(t("settings.sticky.fontSize.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(
						STICKY_NOTE_FONT_RANGE[0],
						STICKY_NOTE_FONT_RANGE[1],
						1
					)
					.setValue(this.plugin.settings.stickyNoteFontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.stickyNoteFontSize = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.sticky.align.name"))
			.addDropdown((dropdown) => {
				dropdown.addOption("left", t("settings.sticky.align.left"));
				dropdown.addOption("center", t("settings.sticky.align.center"));
				dropdown.addOption("right", t("settings.sticky.align.right"));
				dropdown
					.setValue(this.plugin.settings.stickyNoteTextAlign)
					.onChange(async (value) => {
						this.plugin.settings.stickyNoteTextAlign =
							isStickyTextAlign(value)
								? value
								: DEFAULT_SETTINGS.stickyNoteTextAlign;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.sticky.background.name"))
			.setDesc(t("settings.sticky.background.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"follow",
					t("settings.sticky.background.follow")
				);
				dropdown.addOption(
					"custom",
					t("settings.sticky.background.custom")
				);
				dropdown.addOption(
					"keep",
					t("settings.sticky.background.keep")
				);
				dropdown
					.setValue(this.plugin.settings.stickyNoteBackgroundMode)
					.onChange(async (value) => {
						this.plugin.settings.stickyNoteBackgroundMode =
							isStickyBackgroundMode(value)
								? value
								: DEFAULT_SETTINGS.stickyNoteBackgroundMode;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.stickyNoteBackgroundMode === "custom") {
			new Setting(containerEl)
				.setName(t("settings.sticky.color.name"))
				.addColorPicker((picker) =>
					picker
						.setValue(
							this.plugin.settings.stickyNoteBackgroundColor
						)
						.onChange(async (value) => {
							this.plugin.settings.stickyNoteBackgroundColor =
								value;
							await this.plugin.saveSettings();
						})
				);
		}
	}

	/**
	 * Renders one note-dimension slider.
	 *
	 * @param containerEl - The settings pane.
	 * @param name - Row label.
	 * @param desc - Row description.
	 * @param min - Lowest accepted value; also the slider's lower bound.
	 * @param read - Reads the current value.
	 * @param write - Stores the new value.
	 */
	private renderStickySizeSlider(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		min: number,
		read: () => number,
		write: (value: number) => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) =>
				slider
					.setLimits(min, STICKY_NOTE_SIZE_MAX, 10)
					.setValue(read())
					.setDynamicTooltip()
					.onChange(async (value) => {
						write(value);
						await this.plugin.saveSettings();
					})
			);
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
			.setName(t("settings.imageScale.name"))
			.setDesc(t("settings.imageScale.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(
						IMAGE_SCALE_MIN,
						IMAGE_SCALE_MAX,
						IMAGE_SCALE_STEP
					)
					.setValue(this.plugin.settings.imageScale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.imageScale =
							normalizeImageScale(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.sticky.name"))
			.setDesc(t("settings.sticky.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stickyNoteEnabled)
					.onChange(async (value) => {
						this.plugin.settings.stickyNoteEnabled = value;
						await this.plugin.saveSettings();
						// Re-render so the dependent rows follow immediately.
						this.display();
					})
			);

		if (this.plugin.settings.stickyNoteEnabled) {
			this.renderStickySettings(containerEl);
		}

		new Setting(containerEl)
			.setName(t("settings.cardEmbed.name"))
			.setDesc(t("settings.cardEmbed.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("image", t("settings.cardEmbed.image"));
				dropdown.addOption("text", t("settings.cardEmbed.text"));
				dropdown.addOption("keep", t("settings.cardEmbed.keep"));
				dropdown
					.setValue(this.plugin.settings.textCardEmbedMode)
					.onChange(async (value) => {
						this.plugin.settings.textCardEmbedMode = isEmbedMode(
							value
						)
							? value
							: DEFAULT_SETTINGS.textCardEmbedMode;
						await this.plugin.saveSettings();
					});
			});

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
