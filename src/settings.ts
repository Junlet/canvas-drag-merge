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
	TRIGGER_KEY_OPTIONS,
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

export { TRIGGER_KEY_OPTIONS } from "./trigger";
export type { TriggerMode } from "./trigger";

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
				return "（沿用 Excalidraw 插件设置里的目录）";
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
				`「图片 → 图片」合并生成的图纸会保存到这里：${preview()}。` +
					"留空表示沿用 Excalidraw 插件设置里的目录；" +
					"文件夹不存在时会自动创建。"
			);
			monthSetting.setDesc(
				"开启后，会在上面的路径下再建一个 `YYYY-MM` 文件夹，" +
					"让每个月的图纸归到一起。" +
					`当前将会保存到：${preview()}`
			);
		};

		folderSetting = new Setting(containerEl)
			.setName("新建图纸的保存路径")
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
			.setName("按月分文件夹")
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

		this.renderFolderSettings(containerEl);

		new Setting(containerEl)
			.setName("触发键")
			.setDesc(
				"用来开启合并模式的按键组合。默认推荐 Ctrl+Shift+M：" +
					"不会和任何现有快捷键冲突，输入法也不会占用它。" +
					"（Alt / Ctrl / Shift 单独作为触发键已被移除——它们在画布里" +
					"本来就有拖拽修饰的用途，会互相打架。）"
			)
			.addDropdown((dropdown) => {
				for (const option of TRIGGER_KEY_OPTIONS) {
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
			.setName("触发方式")
			.setDesc(
				"「按一下切换」：按一次开启，再按一次关闭；合并成功后自动关闭。" +
					"开启时左下角状态栏会显示提示，按 Esc 也能关闭。" +
					"「按住不放」：只在按住期间生效，适合单键（如 CapsLock）。"
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("toggle", "按一下切换（推荐）");
				dropdown.addOption("hold", "按住不放");
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
			.setName("只在画布中生效")
			.setDesc(
				"开启后，触发键只在当前视图是 Canvas 时才起作用，" +
					"在笔记、设置等其它页面按它不会有任何反应、也不会弹通知。" +
					"建议保持开启。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.canvasOnly)
					.onChange(async (value) => {
						this.plugin.settings.canvasOnly = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("拖拽时高亮可融合的目标")
			.setDesc(
				"拖拽过程中，如果当前重合的目标确实可以被融合，该目标会出现一圈高亮和一个说明标签。" +
					"按规则不会做任何事的目标不会高亮。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.highlightTargets)
					.onChange(async (value) => {
						this.plugin.settings.highlightTargets = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("图片 → 图片：合并为 Excalidraw 文件")
			.setDesc(
				"把一张图片拖到另一张图片上时，两张图会被放进一个新建的 .excalidraw 文件，" +
					"画布上的两个图片节点被替换为指向该图纸的一个节点。" +
					"命名规则与 canvas-to-excalidraw 插件一致（取最左上那张图的名字）。" +
					"需要已安装并启用 Excalidraw 插件；未安装时会提示且不做任何改动。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.imagesToExcalidraw)
					.onChange(async (value) => {
						this.plugin.settings.imagesToExcalidraw = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("笔记 / 图纸 加入图纸时的形式")
			.setDesc(
				"当 md 笔记或另一个 Excalidraw 图纸被加入某则图纸时，用哪种形式。" +
					"「以图像形式」= 渲染成一张图片（固定快照，不会被改动）。" +
					"「以交互形式」= 嵌入可交互的元素，和 Excalidraw 自己的" +
					"「从仓库中嵌入文件」对话框里的两个按钮一致。" +
					"注意：交互形式需要 Excalidraw 提供的一个内部接口，" +
					"若失败会自动回退为图像形式并在控制台记录。"
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("image", "以图像形式（快照）");
				dropdown.addOption("interactive", "以交互形式（可交互嵌入）");
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
			.setName("卡片里的文件链接带不带叹号")
			.setDesc(
				"把 md 笔记或 Excalidraw 图纸拖到**文本卡片**上时，写进卡片的链接形式。" +
					"「带叹号 `![[文件]]`」= 嵌入/引用，笔记内容或图纸会直接显示在卡片里；" +
					"「不带叹号 `[[文件]]`」= 普通链接，只显示可点击的文字。" +
					"（拖到笔记或图纸上时不受这个设置影响。）"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cardLinkEmbedded)
					.onChange(async (value) => {
						this.plugin.settings.cardLinkEmbedded = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("合并后删除源节点")
			.setDesc(
				"合并完成后，把被拖动的那个节点从画布上删掉。" +
					"关闭后会留下两个重叠的节点、内容重复。" +
					"（注意：图片文件本身永远不会被删除；「图片→图片」规则本来就会替换掉两个节点。）"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deleteSourceNode)
					.onChange(async (value) => {
						this.plugin.settings.deleteSourceNode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("笔记→笔记 时删除源笔记文件")
			.setDesc(
				"开启后，源笔记的正文被追加到目标笔记之后，源笔记文件会被移入回收站。" +
					"默认关闭：删文件会同时打断指向它的链接，而正文已经复制过去了。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deleteSourceNoteFile)
					.onChange(async (value) => {
						this.plugin.settings.deleteSourceNoteFile = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("按键诊断")
			.setDesc(
				"打开后，每次按键都会在控制台打印 key/code/修饰键状态，" +
					"用来确认触发键是否被接收。也可以用命令面板的「切换按键诊断」。"
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.keyDiagnostics).onChange((value) => {
					this.plugin.keyDiagnostics = value;
				})
			);
	}
}
