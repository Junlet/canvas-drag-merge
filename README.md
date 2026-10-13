# Canvas Drag Merge

按住一个触发键拖动画布节点，与另一个节点重合时，把内容**合并**过去。

Hold a trigger key, drag a Canvas node onto another, and the two are merged on release.

---

## 中文

### 功能

按住（或按一下切换）触发键，拖动节点与目标重合，松手即合并：

| 拖动 ↓ / 目标 → | **文本卡片** | **图片** | **md 笔记** | **Excalidraw 图纸** |
|---|---|---|---|---|
| **文本卡片** | 文本合并进卡片 | 不处理 | 追加到笔记结尾 | 加入图纸画布 |
| **图片** | 图片嵌入卡片 | 两张图合并为一个 Excalidraw 文件 | 追加到笔记结尾 | 加入图纸画布 |
| **md 笔记** | 以链接插入卡片 | 不处理 | 正文追加到目标笔记 | 加入图纸画布（以图像形式） |
| **Excalidraw 图纸** | 以链接插入卡片 | 不处理 | **不处理** | 加入图纸画布（以图像形式） |

拖拽过程中，**能被融合的目标会高亮**，并浮出一个标签说明将要发生什么；按规则不会做任何事的目标不会高亮。

### 依赖

| 依赖 | 说明 |
|---|---|
| Obsidian | ≥ 1.8.7（**桌面端专属**，因为触发方式是按键） |
| **画布**核心插件 | 必须启用 |
| **Excalidraw** 社区插件 | 只在「图片 → 图片」「加入图纸」这些规则上需要 |

### 使用

1. 按一下触发键（默认 `Ctrl + Shift + M`），左下角状态栏会出现提示
2. 拖动节点到目标上，松手
3. 合并完成后模式**自动关闭**（防止误操作）

`Esc` 随时退出模式。

### 设置

| 设置 | 默认 | 说明 |
|---|---|---|
| 界面语言 | 中文 | 「自动（跟随 Obsidian）」/ 中文 / English |
| 触发键 | `Ctrl + Shift + M` | 也支持 `Ctrl+Alt+M`、`Alt+Shift+M`、单键 Alt / Ctrl / Shift、CapsLock、Tab |
| 触发方式 | 按一下切换 | 或「按住不放」 |
| 只在画布中生效 | 开 | 其它页面按触发键完全无反应 |
| 新建图纸的保存路径 | `Z附件库/Excalidraw` | 「图片→图片」生成的图纸存这里 |
| 按月分文件夹 | 开 | |
| 卡片里的文件链接带不带叹号 | 带 | `![[文件]]`（嵌入）或 `[[文件]]`（普通链接） |
| 笔记 / 图纸 加入图纸时的形式 | 以图像形式 | 或「以交互形式」（可滚动的活嵌入） |
| 合并后删除源节点 | 开 | |
| 笔记→笔记 时删除源笔记文件 | **关** | 删文件会打断指向它的链接，默认保守 |

### 怎么检测拖拽（技术说明）

Canvas **没有公开的拖拽事件**。有一个已装插件是靠猴子补丁内部 `setDragging()` 实现的，本插件没那么做——**打补丁会和那个插件抢同一个方法**。

本插件用**几何快照 + 差分**：

- 指针按下时记录所有节点的坐标
- 指针抬起时再读一次，**位置变了的**就是被拖动的
- 平移、缩放、框选都不改节点坐标，所以不会误触发

### 已知限制

- 「加入图纸画布」通过 Excalidraw 的模板拼接机制实现（已存在的图纸没有公开写入 API）。若目标图纸**正在打开**，改动需要重新打开才能看到，插件会在提示里说明。

---

## English

### What it does

Arm a mode with a key, drag a Canvas node onto another, and they merge on release. A table of every rule is in the Chinese section above; in short:

- **text → text card**: text is copied in
- **image → text card**: the image is embedded in the card
- **note / drawing → text card**: inserted as a link (with or without `!`, your choice)
- **anything → note**: appended to the end of the note
- **note / drawing → drawing**: added to that drawing's canvas
- **image → image**: both become one new Excalidraw file
- **a drawing is never appended into a note as text** — that would inject compressed scene JSON as prose

Mergeable targets are **highlighted during the drag**, with a label naming the action that will run.

### Requirements

- Obsidian ≥ 1.8.7 — **desktop only**, the trigger is a keyboard hold/toggle
- The **Canvas** core plugin enabled
- The **Excalidraw** community plugin, needed only for the image/drawing rules

### Language

The interface is available in Chinese and English. The setting has three values — **Automatic** (follow Obsidian's own language), **中文**, and **English** — and ships defaulting to Chinese.

Detection reads `localStorage["language"]` (the key Obsidian itself uses) and falls back to `window.moment.locale()`, then to the OS locale. Any non-Chinese language resolves to English.

### How the drag is detected

Canvas exposes no drag event. This plugin deliberately avoids monkey-patching the internal `setDragging()` (another installed plugin already patches it, and two patches would fight). Instead it snapshots node positions on pointer-down and diffs them on pointer-up: whatever moved was dragged. Panning, zooming and rubber-band selection do not change node coordinates, so nothing misfires.

---

## 开发 / Development

```bash
npm install
npm run build && npm run deploy
```

## 许可 / License

MIT
