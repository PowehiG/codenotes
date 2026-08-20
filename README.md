# CodeNotes 代码笔记

把个人笔记与 AI 问答对话「贴」在代码上：**不污染 git、不修改工程代码**。在大型工程里读代码时，把疑问、AI 讨论记录成笔记，锚定到具体代码行/块，随时回看、搜索、导出。

> 数据存于工程内 `.codenotes/` 隐藏目录（一键加入 `.gitignore`），或切换到用户全局目录（工程零写入）。代码文件本身**永远不被改动**。

## 核心价值

| 痛点 | CodeNotes 的解法 |
| --- | --- |
| 笔记/注释被 git 识别为变更 | 笔记不写入源码文件，只存在 `.codenotes/`，git 完全无感 |
| 注释污染代码可读性 | 代码上只有**行号旁星标**（按类型着色），详情在侧边栏/悬停里看 |
| AI 对话散落在聊天窗口 | **AI 对话捕捉**：一键把剪贴板里的对话存成笔记，锚定到当前代码 |
| 代码改动了，笔记错位 | 锚点自动重定位算法，代码变动后在窗口内重找位置；也可手动重新锚定 |
| 疑问无法沉淀、搜索 | 全局搜索 / 按文件树浏览 / 导出 Markdown 报告 / 复制代码引用链接分享 |

## 功能快照

- **锚定任意内容到代码**：选中代码 → 右键 → 「CodeNotes: 添加笔记」或「添加 AI 对话笔记（粘贴对话）」；也能锚定文件、HTTP 链接等任何文本
- **两种显示模式**：星标（默认，行号旁按类型着色）／行内幽灵注释（纯渲染浮在行尾，不落盘、不改 git）
- **侧边栏视图**：`CodeNotes` 活动栏 → 按「文件 → 笔记」两级浏览，⚠️ 标记未定位的笔记
- **悬停预览**：鼠标悬停锚定代码块即可浏览全部笔记正文（支持 Markdown、命令按钮）
- **智能锚点**：代码改动后自动在 200 行窗口内重搜旧文本找回锚点；对不上就标记「未定位」并一键手动重锚
- **安全设计**：要求直接从零开始的（零）写入工程源码，笔记正文与索引原子写入
- **可扩展**：内置 5 种笔记类型（note/chat/question/todo/file），提供编程 API 可注册新类型与展示样式

## 安装

1. 下载 `codenotes-0.1.0.vsix`
2. VSCode → 扩展面板（`Ctrl+Shift+X`）→ 右上角 `...` → 「从 VSIX 安装…」
3. 打开任意工程，右键代码即可体验

## 快速上手

```bash
# 1. 打开工程
code /path/to/your/project

# 2. 选中一段代码 → 右键 → 添加笔记 或 添加 AI 对话笔记（自动读取剪贴板）
# 3. 悬停星标看全文；点侧边栏文件节点跳回代码
# 4. 可选：命令面板执行「CodeNotes: 将 .codenotes 加入 .gitignore」
```

### 主要命令（命令面板搜索 `CodeNotes`）

| 命令 | 说明 |
| --- | --- |
| CodeNotes: 添加笔记（选中代码关联） | 选中代码，输入标题即建笔记（剪贴板内容自动作为正文） |
| CodeNotes: 添加 AI 对话笔记（粘贴对话） | 剪贴板对话入库，自动打 `AI` 标签 |
| CodeNotes: 重新锚定到当前选中代码 | 笔记挂到/挪到当前选中区域 |
| CodeNotes: 切换显示模式（星标/行内幽灵注释） | 每条笔记独立切换 star / inline / both |
| CodeNotes: 全局搜索笔记 | 全部笔记快速过滤，回车跳转 |
| CodeNotes: 复制代码引用链接 | 复制 `file:line` 引用，分享给同学/贴进聊天 |
| CodeNotes: 对当前文件解析未定位笔记 | 手动触发锚点重扫（含漂移修复） |
| CodeNotes: 将 .codenotes 加入 .gitignore | 推荐：笔记不进版本管理 |
| CodeNotes: 切换存储模式（工程内/全局） | 一键迁移数据 |

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `codenotes.storage.mode` | `workspace` | 笔记存储：`workspace`=工程内 `.codenotes/`（推荐）／`global`=用户全局目录（工程零写入） |
| `codenotes.display.inlinePreview` | `false` | 当前是否渲染行内幽灵注释（纯预览，不落盘） |
| `codenotes.display.inlineMaxLength` | `40` | 行内幽灵注释最大字符数 |
| `codenotes.display.showGutterStar` | `true` | 显示行号旁星标 |
| `codenotes.display.highlightAnchoredLines` | `true` | 浅色高亮锚定行 |
| `codenotes.anchor.searchWindow` | `200` | 锚点自动重定位的搜索窗口（行） |
| `codenotes.quote.enabled` | `true` | 笔记/导出中附带锚定代码引用片段 |

## 数据格式

```
.codenotes/
├── store.json        # 笔记元数据（标题/类型/锚点/标签/模式/时间戳）
└── notes/            # 每条笔记正文（Markdown 文件：<id>.md）
```

存储零依赖、纯 JSON+Markdown，直接 gitignore 或打包带走都行。切换 `global` 模式后工程完全无痕。

## 开发

```bash
npm install      # 安装依赖
npm run compile  # 编译 TS → out/
npm test         # 编译 + 单测（锚点算法 & 存储层，14 用例）
npm run package  # 打包 → codenotes-0.1.0.vsix
```

- `src/extensions.ts`：激活入口（缓存、装饰、悬停等注册）
- `src/commands.ts`：全部命令编排
- `src/core/notesCore.ts`：领域核心（内存为唯一真源 + 原子落盘）
- `src/anchor/anchorResolver.ts`：锚点自动重定位
- 单测：`test/anchorResolver.test.ts` / `test/noteStore.test.ts`

## 许可

MIT
