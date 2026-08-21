<div align="center">

<table>
  <tbody>
    <tr>
      <td align="center" width="110">
        <img src="media/logo.png" width="80" alt="CodeNotes"/>
      </td>
      <td align="left">
        <h1 style="margin:0">CodeNotes 代码笔记</h1>
        <p><strong>把个人笔记与 AI 问答对话「贴」在代码上</strong></p>
      </td>
    </tr>
  </tbody>
</table>

零写入源码 · 锚点自动跟随 · 一键搜索 ／ 导出 ／ 分享

![version](https://img.shields.io/badge/version-0.1.1-2f6f66?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-yellowgreen?style=flat-square)
![vscode](https://img.shields.io/badge/VSCode-%5E1.85.0-0078D4?style=flat-square)
![typescript](https://img.shields.io/badge/TypeScript-5-brightgreen?style=flat-square)
![git](https://img.shields.io/badge/git-%E6%97%A0%E6%84%9F-orange?style=flat-square)

</div>

在大型工程（如 SGLang）里读代码时，把疑问、AI 讨论当场记录成笔记，锚定到具体的代码行/块，随时回看、搜索、导出。

- 笔记存于工程内 `.codenotes/` 隐藏目录（一键加入 `.gitignore`），也可切换到用户全局目录（工程零写入）
- 代码文件本身**永远不被改动**，git 完全无感
- 存储零依赖：纯 JSON + Markdown，可直接删除、打包、迁移

## 目录

1. [核心价值](#核心价值)
2. [快速上手](#快速上手)
3. [安装](#安装)
4. [功能一览](#功能一览)
5. [主要命令](#主要命令)
6. [默认快捷键](#默认快捷键)
7. [配置项](#配置项)
8. [数据格式](#数据格式)
9. [开发](#开发)
10. [更新日志](#更新日志)
11. [许可](#许可)

---

## 核心价值

| 痛点 | CodeNotes 的解法 |
| --- | --- |
| 笔记/注释被 git 识别为变更 | 笔记不写入源码文件，只存在 `.codenotes/`，git 完全无感 |
| 注释污染代码可读性 | 代码上只有**行号旁星标**（按类型着色），详情在侧边栏/悬停里看 |
| AI 对话散落在聊天窗口 | **AI 对话捕捉**：一键把剪贴板里的对话存成笔记，锚定到当前代码 |
| 代码改动了，笔记错位 | 锚点自动重定位算法，代码变动后在窗口内重找位置；也可手动重新锚定 |
| 疑问无法沉淀、搜索 | 全局搜索 / 按文件树浏览 / 导出 Markdown 报告 / 复制代码引用链接分享 |

## 快速上手

```bash
# 1. 打开工程
code /path/to/your/project

# 2. 选中一段代码 → 右键 → CodeNotes → 添加笔记（或添加 AI 对话笔记，自动读取剪贴板）
# 3. 将鼠标悬停在锚定行上查看笔记全文，点击操作按钮（编辑/跳转代码/删除等）
# 4. 可选：命令面板执行「CodeNotes: 将 .codenotes 加入 .gitignore」
```

常用快捷键（可自定义，见[默认快捷键](#默认快捷键)）：

- <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>Q</kbd> —— 添加笔记（Mac 为 <kbd>Cmd</kbd>）
- <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>R</kbd> —— 重新锚定到当前选中代码

## 安装

1. 下载 `codenotes-0.1.1.vsix`
2. VSCode → 扩展面板（`Ctrl+Shift+X`）→ 右上角 `...` → 「从 VSIX 安装…」
3. 打开任意工程，右键代码即可体验

## 功能一览

- **锚定任意内容到代码**：选中代码 → 右键 → 「CodeNotes: 添加笔记」或「添加 AI 对话笔记（读取剪贴板）」；也能锚定文件、HTTP 链接等任何内容
- **两种显示模式**：星标（默认，行号旁按类型着色）／行内幽灵注释（纯渲染浮在行尾，不落盘、不改 git）
- **侧边栏视图**：`CodeNotes` 活动栏 → 按「文件 → 笔记」两级浏览，⚠️ 标记未定位的笔记
- **悬停预览**：鼠标悬停锚定代码块即可浏览全部笔记正文（支持 Markdown 渲染、命令按钮），打开笔记默认分栏渲染 MD 预览
- **智能锚点**：代码改动后自动在 200 行窗口内重搜旧文本找回锚点；找不到则标记「未定位」并可一键手动重锚
- **安全设计**：零写入工程源码，笔记正文与索引原子写入
- **可扩展**：内置 5 种笔记类型（note/chat/question/todo/file），提供编程 API 可注册新类型与展示样式

### 右键菜单

在编辑器内右键，选择 **CodeNotes** 子菜单，即可集中访问全部功能（添加笔记 / AI 对话 / 重新锚定 / 复制引用链接）。

## 主要命令

命令面板搜索 `CodeNotes` 可快速找到所有命令。

| 分类 | 命令 | 说明 |
| --- | --- | --- |
| 创建 | CodeNotes: 添加笔记（选中代码关联） | 选中代码后输入标题即建笔记（剪贴板内容自动作为正文） |
| 创建 | CodeNotes: 添加 AI 对话笔记（粘贴对话） | 剪贴板对话入库，自动打 `AI` 标签 |
| 创建 | CodeNotes: 从 Markdown 文件导入笔记 | 把外部 md 导为 kind=file 笔记 |
| 锚点 | CodeNotes: 重新锚定到当前选中代码 | 把笔记挂到/挪到当前选中区域 |
| 锚点 | CodeNotes: 解析当前文件中未定位的笔记 | 手动触发锚点重扫（含漂移修复） |
| 查看 | CodeNotes: 打开笔记 | 打开笔记对应的 MD 渲染预览（分栏） |
| 查看 | CodeNotes: 跳转到锚点代码 | 定位到笔记关联的源码位置 |
| 查看 | CodeNotes: 切换显示模式（星标/行内幽灵注释） | 每条笔记独立切换 star / inline / both |
| 查看 | CodeNotes: 聚焦代码笔记侧边栏 | 快速打开 `CodeNotes` 活动栏视图 |
| 搜索 | CodeNotes: 全局搜索笔记 | 全部笔记快速过滤，回车打开 |
| 搜索 | CodeNotes: 复制代码引用链接 | 复制 `file:line` 引用，分享给同学/贴进聊天 |
| 导出 | CodeNotes: 导出全部笔记为 Markdown 报告 | 一键导出全部笔记 |
| 存储 | CodeNotes: 将 .codenotes 加入 .gitignore | 推荐：笔记不进版本管理 |
| 存储 | CodeNotes: 切换存储模式（工程内/全局） | 一键迁移数据 |

## 默认快捷键

快捷键导入默认按键，可在「首选项 → 键盘快捷方式」中搜索 `CodeNotes` 自定义绑定。

| 按键 (Win/Linux / Mac) | 功能 |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>Q</kbd> / <kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>Q</kbd> | 添加笔记 |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>C</kbd> / <kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>C</kbd> | 添加 AI 对话笔记 |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>R</kbd> / <kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>R</kbd> | 重新锚定 |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>S</kbd> / <kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>N</kbd> <kbd>S</kbd> | 全局搜索笔记 |

## 配置项

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
├── store.json      # 笔记元数据（标题/类型/锚点/标签/模式/时间戳）
└── md/             # 每条笔记正文（Markdown 文件：<id>.md）
```

存储零依赖、纯 JSON + Markdown，直接 gitignore 或打包带走都行。切换 `global` 模式后工程完全无痕。

## 开发

```bash
npm install      # 安装依赖
npm run compile  # 编译 TS → out/
npm test         # 编译 + 单测（锚点算法 & 存储层，14 用例）
npm run package  # 打包 → codenotes-<version>.vsix
```

- `src/extension.ts`：激活入口（缓存、装饰、悬停等注册）
- `src/commands.ts`：全部命令编排
- `src/core/notesCore.ts`：领域核心（内存为唯一真源 + 原子落盘）
- `src/anchor/anchorResolver.ts`：锚点自动重定位
- 单测：`test/anchorResolver.test.ts` / `test/noteStore.test.ts`

## 更新日志

### v0.1.1（2026-08-21）

- 修复：悬停浮窗重复渲染相同笔记内容的问题
- 修复：「打开笔记」从打开当前源码文件改为**分栏打开 Markdown 渲染预览**（不占用当前源码栏）
- 修复：编辑界面「删除」无响应（改用主进程二次确认，兼容 WebView 安全限制）
- 新增：保存成功提示、删除二次确认
- 新增：右键菜单集中到 **CodeNotes** 子菜单（编辑区右键可见）
- 新增：浮窗内可直接删除/跳转/编辑等操作
- 新增：常用命令默认快捷键（`Ctrl/Cmd+K N Q/C/R/S`，可自定义）

### v0.1.0（2026-08-20）

- 首个版本：代码笔记「贴」在代码上，锚点自动重定位、两种显示模式、侧边栏浏览、全局搜索、MD 报告导出、可扩展笔记类型

## 许可

MIT