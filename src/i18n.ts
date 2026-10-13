/**
 * Two-language string table.
 *
 * The plugin ships Chinese and English. The setting has three values:
 *
 *   - `"auto"` follows whatever language Obsidian itself is using;
 *   - `"zh"` / `"en"` pin it.
 *
 * The factory default is `"zh"`, so an existing install keeps the exact wording
 * it had before this module existed.
 *
 * HOW THE APP LANGUAGE IS DETECTED
 * --------------------------------
 * Both signals below were verified against Obsidian's own bundle rather than
 * guessed:
 *
 *   1. `localStorage.getItem("language")` -- Obsidian stores the UI language
 *      under that key (its bundle literally has `ta = "language"` feeding
 *      `localStorage.getItem(ta)` / `setItem(ta, ...)`).
 *   2. `window.moment.locale()` -- Obsidian calls `window.moment.locale(<app
 *      language>)` right after loading a language pack, so moment's locale
 *      mirrors the app language.
 *
 * Anything that is not Chinese resolves to English, which is the sensible
 * fallback for a German or Japanese Obsidian.
 */

/** What the user picked in settings. */
export type LanguageSetting = "auto" | "zh" | "en";

/** What that resolves to at runtime. */
export type ResolvedLanguage = "zh" | "en";

/**
 * Chinese strings.
 *
 * This table is the source of truth for the key set: `MessageKey` is derived
 * from it, and the English table is typed as `Record<MessageKey, string>`, so a
 * key added here and forgotten there is a compile error.
 */
const zh = {
	// -- console (the "[canvas-drag-merge] " prefix stays literal in code) --
	"log.loaded": "已加载，触发键 = {key}，方式 = {mode}",
	"log.modeArmed": "模式已开启",
	"log.modeDisarmed": "模式已关闭",
	"log.snapshotFailed": "快照失败",
	"log.mergeFailed": "合并失败",
	"log.singleMergeFailed": "单条合并失败",
	"log.mergeDone": "合并完成",
	"log.isExcalidrawFileFailed": "isExcalidrawFile() 抛错，回退到元数据判定",
	"log.readMetadataFailed": "读取元数据失败",
	"log.keydown":
		'按键按下 key="{key}" ctrl={ctrl} alt={alt} shift={shift} ' +
		"meta={meta} repeat={repeat}",
	"log.keyup": '按键松开 key="{key}" code="{code}"',
	"log.stagingIntoDrawing": "正在把 {kind} 以{form}形式加入图纸：{path}",
	"log.embedFailedFallback": "交互形式失败，回退为图像形式：",
	"log.fileToLinktextFailed": "fileToLinktext() 失败，回退到完整路径",
	"log.addEmbeddableFailed":
		"addEmbeddable() 失败，将回退为图像形式",
	"log.getApiFailed": "ExcalidrawAutomate.getAPI() 调用失败",
	"log.getSceneFailed": "getSceneFromFile() 失败，改在原点追加",
	"log.createFolderFailed": "创建文件夹时出错（可能已存在）：",
	"log.stageContentFailed": "暂存内容失败",
	"log.createTempDrawingFailed": "创建临时图纸失败",
	"log.writeBackDrawingFailed": "写回原图纸失败",
	"log.deleteTempDrawingFailed": "临时图纸删除失败，请手动清理：",

	// -- notices ----------------------------------------------------------
	"notice.keyDiagnosticsOn":
		"按键诊断已开启。现在按任意键，看 Ctrl+Shift+I 控制台。",
	"notice.keyDiagnosticsOff": "按键诊断已关闭。",
	"notice.modeClosed": "合并模式已关闭。",
	"notice.modeArmedToggle":
		"✅ 合并模式已开启，把节点拖到目标上再松手；再按一次 {key} 或 Esc 可关闭。",
	"notice.modeArmedHold":
		"✅ 合并模式已开启（按住 {key}）——把节点拖到目标上再松手。",
	"notice.canvasReadonly": "这个画布是只读的，无法合并。",
	"notice.noOverlap": "合并模式：移动了 {count} 个节点，但没有和目标重合。",
	"notice.mergeFailed": "合并失败：{error}",

	// -- commands ---------------------------------------------------------
	"command.toggleKeyDiagnostics": "切换按键诊断（把每次按键打到控制台）",
	"command.armMergeMode": "开启合并模式",

	// -- status bar -------------------------------------------------------
	"status.armed": "🖱 合并模式：拖动节点以合并",

	// -- settings ---------------------------------------------------------
	// Deliberately identical in both tables: someone who switched to a
	// language they cannot read must still be able to find this one row.
	"settings.language.name": "界面语言 / Interface language",
	"settings.language.desc":
		"本插件的命令、通知与设置界面使用的语言。「自动」跟随 Obsidian 自身的语言设置。",
	"settings.language.auto": "自动（跟随 Obsidian）",
	"settings.language.zh": "中文",
	"settings.language.en": "English",

	"settings.folder.name": "新建图纸的保存路径",
	"settings.folder.desc":
		"「图片 → 图片」合并生成的图纸会保存到这里：{path}。" +
		"留空表示沿用 Excalidraw 插件设置里的目录；文件夹不存在时会自动创建。",
	"settings.folder.previewInherited": "（沿用 Excalidraw 插件设置里的目录）",

	"settings.month.name": "按月分文件夹",
	"settings.month.desc":
		"开启后，会在上面的路径下再建一个 `YYYY-MM` 文件夹，" +
		"让每个月的图纸归到一起。" +
		"当前将会保存到：{path}",

	"settings.triggerKey.name": "触发键",
	"settings.triggerKey.desc":
		"用来开启合并模式的按键组合。默认推荐 Ctrl+Shift+M：" +
		"不会和任何现有快捷键冲突，输入法也不会占用它。" +
		"（Alt / Ctrl / Shift 单独作为触发键已被移除——它们在画布里" +
		"本来就有拖拽修饰的用途，会互相打架。）",
	"settings.triggerKey.option.ctrlShiftM": "Ctrl + Shift + M（推荐，无冲突）",
	"settings.triggerKey.option.ctrlAltM": "Ctrl + Alt + M",
	"settings.triggerKey.option.altShiftM": "Alt + Shift + M",
	"settings.triggerKey.option.alt": "Alt（可能和画布拖拽修饰冲突）",
	"settings.triggerKey.option.control": "Ctrl（可能和画布拖拽修饰冲突）",
	"settings.triggerKey.option.shift": "Shift（可能和画布/输入法冲突）",
	"settings.triggerKey.option.capsLock": "CapsLock（可能被输入法占用）",
	"settings.triggerKey.option.tab": "Tab（会占用画布里的 Tab 导航）",

	"settings.triggerMode.name": "触发方式",
	"settings.triggerMode.desc":
		"「按一下切换」：按一次开启，再按一次关闭；合并成功后自动关闭。" +
		"开启时左下角状态栏会显示提示，按 Esc 也能关闭。" +
		"「按住不放」：只在按住期间生效，适合单键（如 CapsLock）。",
	"settings.triggerMode.toggle": "按一下切换（推荐）",
	"settings.triggerMode.hold": "按住不放",

	"settings.canvasOnly.name": "只在画布中生效",
	"settings.canvasOnly.desc":
		"开启后，触发键只在当前视图是 Canvas 时才起作用，" +
		"在笔记、设置等其它页面按它不会有任何反应、也不会弹通知。" +
		"建议保持开启。",

	"settings.highlight.name": "拖拽时高亮可融合的目标",
	"settings.highlight.desc":
		"拖拽过程中，如果当前重合的目标确实可以被融合，该目标会出现一圈高亮和一个说明标签。" +
		"按规则不会做任何事的目标不会高亮。",

	"settings.imagesToExcalidraw.name": "图片 → 图片：合并为 Excalidraw 文件",
	"settings.imagesToExcalidraw.desc":
		"把一张图片拖到另一张图片上时，两张图会被放进一个新建的 .excalidraw 文件，" +
		"画布上的两个图片节点被替换为指向该图纸的一个节点。" +
		"命名规则与 canvas-to-excalidraw 插件一致（取最左上那张图的名字）。" +
		"需要已安装并启用 Excalidraw 插件；未安装时会提示且不做任何改动。",

	"settings.embedMode.name": "笔记 / 图纸 加入图纸时的形式",
	"settings.embedMode.desc":
		"当 md 笔记或另一个 Excalidraw 图纸被加入某则图纸时，用哪种形式。" +
		"「以图像形式」= 渲染成一张图片（固定快照，不会被改动）。" +
		"「以交互形式」= 嵌入可交互的元素，和 Excalidraw 自己的" +
		"「从仓库中嵌入文件」对话框里的两个按钮一致。" +
		"注意：交互形式需要 Excalidraw 提供的一个内部接口，" +
		"若失败会自动回退为图像形式并在控制台记录。",
	"settings.embedMode.image": "以图像形式（快照）",
	"settings.embedMode.interactive": "以交互形式（可交互嵌入）",

	"settings.cardLink.name": "卡片里的文件链接带不带叹号",
	"settings.cardLink.desc":
		"把 md 笔记或 Excalidraw 图纸拖到**文本卡片**上时，写进卡片的链接形式。" +
		"「带叹号 `![[文件]]`」= 嵌入/引用，笔记内容或图纸会直接显示在卡片里；" +
		"「不带叹号 `[[文件]]`」= 普通链接，只显示可点击的文字。" +
		"（拖到笔记或图纸上时不受这个设置影响。）",

	"settings.deleteSourceNode.name": "合并后删除源节点",
	"settings.deleteSourceNode.desc":
		"合并完成后，把被拖动的那个节点从画布上删掉。" +
		"关闭后会留下两个重叠的节点、内容重复。" +
		"（注意：图片文件本身永远不会被删除；「图片→图片」规则本来就会替换掉两个节点。）",

	"settings.deleteSourceNoteFile.name": "笔记→笔记 时删除源笔记文件",
	"settings.deleteSourceNoteFile.desc":
		"开启后，源笔记的正文被追加到目标笔记之后，源笔记文件会被移入回收站。" +
		"默认关闭：删文件会同时打断指向它的链接，而正文已经复制过去了。",

	"settings.diagnostics.name": "按键诊断",
	"settings.diagnostics.desc":
		"打开后，每次按键都会在控制台打印 key/code/修饰键状态，" +
		"用来确认触发键是否被接收。也可以用命令面板的「切换按键诊断」。",

	// -- node kinds -------------------------------------------------------
	"kind.text": "文本卡片",
	"kind.image": "图片",
	"kind.note": "md 笔记",
	"kind.drawing": "Excalidraw 图纸",
	"kind.other": "其他节点",

	// -- merge actions (highlight labels and summaries) -------------------
	"action.copy-text-to-card": "把文本合并进这张卡片",
	"action.insert-image-into-card": "把图片插入这张卡片",
	"action.insert-card-link": "把文件以链接插入这张卡片",
	"action.append-to-note": "把内容追加到这则笔记",
	"action.append-note-to-note": "把这则笔记的正文追加过去",
	"action.merge-images-into-excalidraw": "两张图片合并为一个 Excalidraw 文件",
	"action.append-to-drawing": "把内容加入这则图纸的画布",
	"action.nothing": "什么都不做",

	// -- forms a file can take when written somewhere ---------------------
	"form.image": "图像",
	"form.interactive": "交互",
	"form.embed": "嵌入",
	"form.link": "链接",

	// -- merge summaries --------------------------------------------------
	"summary.pairDetail": "{pair}：{detail}",
	"summary.pairFailed": "{pair}：失败 —— {error}",
	"summary.imagesToExcalidrawDisabled":
		"{pair}：设置里关闭了「图片→图片合并为图纸」",
	"summary.removedNodes": "已从画布移除源节点 {count} 个",
	"summary.removedEdges": "、相关连线 {count} 条",
	"summary.sourceKept": "（设置里关闭了「合并后删除源节点」，源节点保留）",
	"summary.separator": "；",

	// -- merge details ----------------------------------------------------
	"detail.emptySourceCard": "源卡片是空的，没有可复制的内容",
	"detail.textAppendedToCard": "已把源卡片的文本追加到目标卡片",
	"detail.imageHasNoPath": "图片节点没有文件路径",
	"detail.imageEmbeddedInCard": "已把图片作为嵌入插入目标卡片",
	"detail.fileNotFound": "找不到文件：{path}",
	"detail.linkWrittenToCard": "已把{kind}以{form}形式写入目标卡片：{link}",
	"detail.targetNoteNotFound": "找不到目标笔记：{path}",
	"detail.sourceHasNoContent": "源节点没有可插入的内容",
	"detail.appendedToNote": "已把内容追加到笔记 {name} 的结尾",
	"detail.sourceNoteNotFound": "找不到源笔记：{path}",
	"detail.sameNote": "源笔记和目标笔记是同一个文件",
	"detail.sourceBodyEmpty": "源笔记去掉属性后没有正文，未追加",
	"detail.noteBodyAppended":
		"已把笔记 {source} 的正文追加到 {target} 结尾（已去掉属性）",
	"detail.andTrashed": "，并把源笔记移入回收站",
	"detail.excalidrawMissingForAppend":
		"未找到已启用的 Excalidraw 插件，无法加入图纸",
	"detail.drawingNotFound": "找不到图纸：{path}",
	"detail.addedToDrawing": "已把{kind}以{form}形式加入图纸「{name}」{note}",
	"detail.excalidrawMissingForMerge":
		"未找到已启用的 Excalidraw 插件，无法合并为图纸",
	"detail.imagesMerged": "已把两张图片合并为图纸「{path}」",
	"detail.nothing": "该组合不做任何操作",
	"detail.nothingToAppend": "没有可加入图纸的内容。",
	"detail.drawingOpenHint":
		"（该图纸当前处于打开状态，请重新打开它以看到改动）",
	"value.empty": "（空）",

	// -- errors -----------------------------------------------------------
	"error.canvasNoGetData":
		"当前 Obsidian 版本的 Canvas 缺少 getData()，无法读取画布。",
	"error.canvasNoSetData":
		"当前 Obsidian 版本的 Canvas 缺少 setData()，无法写回画布。",
	"error.canvasUnreadable": "Canvas 返回的数据结构无法识别。",
	"error.sourceFileNotFound": "找不到源文件：{path}",
	"error.cannotRenderImage": "Excalidraw 无法把「{name}」渲染成图片",
	"error.appendStep": "{step}：{detail}",
	"error.stageStepFailed":
		"无法把源内容渲染成图纸元素（该文件可能不是有效的 Excalidraw 图纸或笔记）",
	"error.createTempDrawingStep": "创建临时图纸失败",
	"error.noTempDrawingPath": "Excalidraw 未返回临时图纸路径。",
	"error.tempDrawingMissing": "临时图纸未生成：{path}",
	"error.writeBackStepFailed":
		"写回原图纸失败（临时文件 {path} 已保留，可手动检查）",
	"error.noImagePlaced": "没有任何图片能被放入图纸。",
	"error.drawingNotCreated": "Excalidraw 未能在预期时间内创建文件：{path}",
} as const;

/** Every valid key. Derived from the Chinese table. */
export type MessageKey = keyof typeof zh;

/** English strings. Must cover every key in `zh`. */
const en: Record<MessageKey, string> = {
	// -- console ----------------------------------------------------------
	"log.loaded": "loaded, trigger key = {key}, mode = {mode}",
	"log.modeArmed": "mode armed",
	"log.modeDisarmed": "mode disarmed",
	"log.snapshotFailed": "could not snapshot node positions",
	"log.mergeFailed": "merge failed",
	"log.singleMergeFailed": "one merge failed",
	"log.mergeDone": "merge finished",
	"log.isExcalidrawFileFailed":
		"isExcalidrawFile() threw; falling back to the metadata check",
	"log.readMetadataFailed": "could not read the file's metadata",
	"log.keydown":
		'keydown key="{key}" ctrl={ctrl} alt={alt} shift={shift} ' +
		"meta={meta} repeat={repeat}",
	"log.keyup": 'keyup key="{key}" code="{code}"',
	"log.stagingIntoDrawing":
		"staging {kind} into the drawing as {form}: {path}",
	"log.embedFailedFallback":
		"the interactive form failed; falling back to the image form:",
	"log.fileToLinktextFailed":
		"fileToLinktext() failed; falling back to the full path",
	"log.addEmbeddableFailed":
		"addEmbeddable() failed; falling back to the image form",
	"log.getApiFailed": "ExcalidrawAutomate.getAPI() failed",
	"log.getSceneFailed": "getSceneFromFile() failed; appending at the origin",
	"log.createFolderFailed":
		"could not create the folder (it may already exist):",
	"log.stageContentFailed": "could not stage the content",
	"log.createTempDrawingFailed": "could not create the temporary drawing",
	"log.writeBackDrawingFailed": "could not write back to the drawing",
	"log.deleteTempDrawingFailed":
		"could not delete the temporary drawing; please clean it up manually:",

	// -- notices ----------------------------------------------------------
	"notice.keyDiagnosticsOn":
		"Key diagnostics is on. Press any key and watch the console (Ctrl+Shift+I).",
	"notice.keyDiagnosticsOff": "Key diagnostics is off.",
	"notice.modeClosed": "Merge mode is off.",
	"notice.modeArmedToggle":
		"✅ Merge mode is on: drag a node onto a target and release. Press {key} " +
		"again or Esc to turn it off.",
	"notice.modeArmedHold":
		"✅ Merge mode is on (holding {key}) -- drag a node onto a target and release.",
	"notice.canvasReadonly": "This canvas is read-only, so it cannot be merged.",
	"notice.noOverlap":
		"Merge mode: {count} node(s) moved, but none overlapped a target.",
	"notice.mergeFailed": "Merge failed: {error}",

	// -- commands ---------------------------------------------------------
	"command.toggleKeyDiagnostics":
		"Toggle key diagnostics (log every key press to the console)",
	"command.armMergeMode": "Arm merge mode",

	// -- status bar -------------------------------------------------------
	"status.armed": "🖱 Merge mode: drag a node to merge",

	// -- settings ---------------------------------------------------------
	"settings.language.name": "界面语言 / Interface language",
	"settings.language.desc":
		"Language used by this plugin's commands, notices and settings pane. " +
		'"Automatic" follows Obsidian\'s own language.',
	"settings.language.auto": "Automatic (follow Obsidian)",
	"settings.language.zh": "中文",
	"settings.language.en": "English",

	"settings.folder.name": "Where new drawings are saved",
	"settings.folder.desc":
		"Drawings produced by the image-onto-image merge are saved here: {path}. " +
		"Leave it empty to inherit the Excalidraw plugin's own folder setting; " +
		"the folder is created when it does not exist yet.",
	"settings.folder.previewInherited":
		"(inherits the Excalidraw plugin's own folder setting)",

	"settings.month.name": "Group by month in sub-folders",
	"settings.month.desc":
		"When on, a `YYYY-MM` folder is created inside the path above so each " +
		"month's drawings collect together. " +
		"They will currently be saved to: {path}",

	"settings.triggerKey.name": "Trigger key",
	"settings.triggerKey.desc":
		"The key combination that arms merge mode. Ctrl+Shift+M is recommended " +
		"by default: it conflicts with no existing shortcut and no IME claims " +
		"it. (Alt / Ctrl / Shift on their own were removed as triggers -- Canvas " +
		"already uses them to modify a drag, so the two would fight.)",
	"settings.triggerKey.option.ctrlShiftM":
		"Ctrl + Shift + M (recommended, no conflict)",
	"settings.triggerKey.option.ctrlAltM": "Ctrl + Alt + M (alternative)",
	"settings.triggerKey.option.altShiftM": "Alt + Shift + M (alternative)",
	"settings.triggerKey.option.alt":
		"Alt (may conflict with Canvas drag modifiers)",
	"settings.triggerKey.option.control":
		"Ctrl (may conflict with Canvas drag modifiers)",
	"settings.triggerKey.option.shift":
		"Shift (may conflict with Canvas or your IME)",
	"settings.triggerKey.option.capsLock": "CapsLock (an IME may claim it)",
	"settings.triggerKey.option.tab":
		"Tab (takes over Tab navigation inside a Canvas)",

	"settings.triggerMode.name": "How the trigger behaves",
	"settings.triggerMode.desc":
		'"Press to toggle": press once to arm, press again to disarm; a ' +
		"successful merge also disarms it. The status bar shows a hint while it " +
		"is armed, and Esc disarms it too. " +
		'"Hold down": only active while held, which suits a single key such as ' +
		"CapsLock.",
	"settings.triggerMode.toggle": "Press to toggle (recommended)",
	"settings.triggerMode.hold": "Hold down",

	"settings.canvasOnly.name": "Only inside a Canvas",
	"settings.canvasOnly.desc":
		"When on, the trigger key only works while a Canvas is the active view; " +
		"pressing it in a note, in settings or anywhere else does nothing and " +
		"shows no notice. Keeping it on is recommended.",

	"settings.highlight.name": "Highlight mergeable targets while dragging",
	"settings.highlight.desc":
		"While you drag, a target that can actually be merged into gets an " +
		"outline and an explanatory label. Targets the rules would do nothing " +
		"with are not highlighted.",

	"settings.imagesToExcalidraw.name":
		"Image → image: merge into an Excalidraw file",
	"settings.imagesToExcalidraw.desc":
		"When one image is dragged onto another, both are placed in a new " +
		".excalidraw file and the two image nodes on the Canvas are replaced by " +
		"one node pointing at that drawing. Naming matches the " +
		"canvas-to-excalidraw plugin (the name of the topmost-leftmost image is " +
		"used). Requires the Excalidraw plugin to be installed and enabled; " +
		"without it you get a notice and nothing changes.",

	"settings.embedMode.name": "How notes / drawings join a drawing",
	"settings.embedMode.desc":
		"Which form is used when an md note or another Excalidraw drawing is " +
		"added to a drawing. " +
		'"As an image" = rendered into a picture (a fixed snapshot that cannot ' +
		"be changed). " +
		'"As an interactive embed" = an element you can interact with, matching ' +
		'the two buttons in Excalidraw\'s own "Embed file from vault" dialog. ' +
		"Note: the interactive form needs an internal Excalidraw interface; if " +
		"it fails the plugin falls back to the image form and logs it to the " +
		"console.",
	"settings.embedMode.image": "As an image (a snapshot)",
	"settings.embedMode.interactive": "As an interactive embed",

	"settings.cardLink.name": "Whether file links in a card carry a !",
	"settings.cardLink.desc":
		"The link form written into a **text card** when an md note or an " +
		"Excalidraw drawing is dragged onto it. " +
		'"With the ! `![[file]]`" = an embed/transclusion, so the note content ' +
		"or the drawing shows up inside the card; " +
		'"without the ! `[[file]]`" = a plain link that only shows clickable ' +
		"text. (Not affected by this setting when you drag onto a note or a " +
		"drawing.)",

	"settings.deleteSourceNode.name": "Delete the source node after merging",
	"settings.deleteSourceNode.desc":
		"Removes the dragged node from the Canvas once the merge is done. " +
		"Turned off, two overlapping nodes with duplicated content are left " +
		"behind. (Note: image files are never deleted; the image-to-image rule " +
		"replaces both nodes anyway.)",

	"settings.deleteSourceNoteFile.name":
		"Delete the source note file on note → note",
	"settings.deleteSourceNoteFile.desc":
		"When on, the source note's body is appended to the target note and the " +
		"source note file is moved to the trash. Off by default: deleting a file " +
		"also breaks every link pointing at it, and the body has been copied over " +
		"already.",

	"settings.diagnostics.name": "Key diagnostics",
	"settings.diagnostics.desc":
		"When on, every key press prints its key/code/modifier state to the " +
		"console, which is how you confirm the trigger key is being received. " +
		'The command palette entry "Toggle key diagnostics" does the same.',

	// -- node kinds -------------------------------------------------------
	"kind.text": "text card",
	"kind.image": "image",
	"kind.note": "md note",
	"kind.drawing": "Excalidraw drawing",
	"kind.other": "other node",

	// -- merge actions (highlight labels and summaries) -------------------
	"action.copy-text-to-card": "Merge the text into this card",
	"action.insert-image-into-card": "Insert the image into this card",
	"action.insert-card-link": "Insert the file into this card as a link",
	"action.append-to-note": "Append the content to this note",
	"action.append-note-to-note": "Append this note's body to the target",
	"action.merge-images-into-excalidraw":
		"Merge both images into one Excalidraw file",
	"action.append-to-drawing": "Add the content to this drawing's canvas",
	"action.nothing": "Do nothing",

	// -- forms a file can take when written somewhere ---------------------
	"form.image": "an image",
	"form.interactive": "an interactive embed",
	"form.embed": "an embed",
	"form.link": "a link",

	// -- merge summaries --------------------------------------------------
	"summary.pairDetail": "{pair}: {detail}",
	"summary.pairFailed": "{pair}: failed -- {error}",
	"summary.imagesToExcalidrawDisabled":
		'{pair}: "image to image becomes a drawing" is turned off in settings',
	"summary.removedNodes": "Removed {count} source node(s) from the Canvas",
	"summary.removedEdges": ", plus {count} connected edge(s)",
	"summary.sourceKept":
		'(the source node is kept: "delete the source node after merging" is off)',
	"summary.separator": "; ",

	// -- merge details ----------------------------------------------------
	"detail.emptySourceCard": "the source card is empty, nothing to copy",
	"detail.textAppendedToCard": "appended the source card's text to the target card",
	"detail.imageHasNoPath": "the image node has no file path",
	"detail.imageEmbeddedInCard": "inserted the image into the target card as an embed",
	"detail.fileNotFound": "file not found: {path}",
	"detail.linkWrittenToCard":
		"wrote the {kind} into the target card as {form}: {link}",
	"detail.targetNoteNotFound": "target note not found: {path}",
	"detail.sourceHasNoContent": "the source node has no content to insert",
	"detail.appendedToNote": "appended the content to the end of note {name}",
	"detail.sourceNoteNotFound": "source note not found: {path}",
	"detail.sameNote": "the source and the target are the same file",
	"detail.sourceBodyEmpty":
		"the source note has no body once its properties are stripped, so nothing was appended",
	"detail.noteBodyAppended":
		"appended the body of note {source} to the end of {target} (properties stripped)",
	"detail.andTrashed": ", and moved the source note to the trash",
	"detail.excalidrawMissingForAppend":
		"the Excalidraw plugin is not enabled, so the content cannot join a drawing",
	"detail.drawingNotFound": "drawing not found: {path}",
	"detail.addedToDrawing":
		'added the {kind} to drawing "{name}" as {form}{note}',
	"detail.excalidrawMissingForMerge":
		"the Excalidraw plugin is not enabled, so the images cannot become a drawing",
	"detail.imagesMerged": 'merged both images into drawing "{path}"',
	"detail.nothing": "this combination does nothing",
	"detail.nothingToAppend": "there is no content to add to the drawing.",
	"detail.drawingOpenHint":
		"(this drawing is currently open; reopen it to see the changes)",
	"value.empty": "(empty)",

	// -- errors -----------------------------------------------------------
	"error.canvasNoGetData":
		"this Obsidian version's Canvas has no getData(), so the canvas cannot be read.",
	"error.canvasNoSetData":
		"this Obsidian version's Canvas has no setData(), so the canvas cannot be written back.",
	"error.canvasUnreadable": "the data Canvas returned is not recognisable.",
	"error.sourceFileNotFound": "source file not found: {path}",
	"error.cannotRenderImage": 'Excalidraw cannot render "{name}" as an image',
	"error.appendStep": "{step}: {detail}",
	"error.stageStepFailed":
		"could not render the source content into drawing elements (the file may not be a valid Excalidraw drawing or note)",
	"error.createTempDrawingStep": "could not create the temporary drawing",
	"error.noTempDrawingPath": "Excalidraw returned no path for the temporary drawing.",
	"error.tempDrawingMissing": "the temporary drawing was not created: {path}",
	"error.writeBackStepFailed":
		"could not write back to the drawing (the temporary file {path} was kept for manual inspection)",
	"error.noImagePlaced": "no image could be placed in the drawing.",
	"error.drawingNotCreated":
		"Excalidraw did not create the file in time: {path}",
};

/** All tables, keyed by resolved language. */
const TABLES: Record<ResolvedLanguage, Record<MessageKey, string>> = { zh, en };

/** The language currently in effect. Starts at the factory default. */
let resolved: ResolvedLanguage = "zh";

/** The shape of `window` we actually rely on. */
interface WindowWithMoment {
	moment?: { locale?: () => string };
}

/**
 * Reads the language Obsidian itself is running in.
 *
 * @returns `"zh"` for any Chinese locale, otherwise `"en"`.
 */
function detectObsidianLanguage(): ResolvedLanguage {
	// 1. Obsidian's own key for the UI language.
	try {
		const stored = window.localStorage.getItem("language");
		if (stored) return stored.toLowerCase().startsWith("zh") ? "zh" : "en";
	} catch {
		// localStorage can throw when storage is disabled; fall through.
	}

	// 2. Obsidian keeps moment's locale in step with the app language.
	try {
		const locale = (window as unknown as WindowWithMoment).moment?.locale?.();
		if (typeof locale === "string" && locale.length > 0) {
			return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
		}
	} catch {
		// Moment is not guaranteed to be loaded; fall through.
	}

	// 3. Last resort. In Electron this is usually the OS locale.
	const nav = typeof navigator === "undefined" ? "" : navigator.language;
	return nav && nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * Turns the stored setting into a concrete language.
 *
 * @param setting - The value from settings.
 * @returns The language to render in.
 */
export function resolveLanguage(setting: LanguageSetting): ResolvedLanguage {
	if (setting === "zh" || setting === "en") return setting;
	return detectObsidianLanguage();
}

/**
 * Applies a setting and remembers the result.
 *
 * @param setting - The value from settings.
 * @returns The language now in effect.
 */
export function setLanguage(setting: LanguageSetting): ResolvedLanguage {
	resolved = resolveLanguage(setting);
	return resolved;
}

/**
 * @returns The language now in effect.
 */
export function currentLanguage(): ResolvedLanguage {
	return resolved;
}

/**
 * Looks up a string, substituting `{name}` placeholders.
 *
 * @param key - Which string to fetch.
 * @param params - Values for any `{...}` placeholders in it.
 * @returns The string in the current language.
 */
export function t(
	key: MessageKey,
	params?: Record<string, string | number>
): string {
	const text = TABLES[resolved][key] ?? zh[key] ?? key;
	if (!params) return text;
	let out = text;
	for (const name of Object.keys(params)) {
		out = out.split(`{${name}}`).join(String(params[name]));
	}
	return out;
}

/**
 * Checks whether a stored value is a usable language setting.
 *
 * @param value - Raw value from `loadData()`.
 * @returns True when it is `"auto"`, `"zh"` or `"en"`.
 */
export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "auto" || value === "zh" || value === "en";
}
