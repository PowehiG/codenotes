/**
 * 存储层：决定笔记数据落在哪里。
 *
 * 两种模式：
 * - workspace（默认）：`<workspace>/.codenotes/` —— 用户把 .codenotes 加进 .gitignore 即可
 * - global：`<os 用户数据>/codenotes/<workspace 名>-<hash8>/` —— 工程目录零写入，git 完全无感
 *
 * global 模式的可移植性：因为笔记正文 + store.json 都相对仓库根目录的路径存放，
 * 换机器/换路径后只要 workspace 名一致（或手动复制目录）即可继续使用。
 */
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

export type StorageMode = 'workspace' | 'global';

export interface StorageLocation {
  /** .codenotes 根目录（模式解析后的最终目录） */
  root: string;
  /** store.json 完整路径 */
  storePath: string;
  /** 笔记正文 md 目录 */
  mdDir: string;
  /** 是否为 workspace 模式（工程内） */
  inWorkspace: boolean;
}

/** 用户级笔记根目录 */
export function globalRoot(): string {
  return path.join(os.homedir(), '.codenotes');
}

/** 根据 workspace 根目录与模式解析存储位置 */
export function resolveStorage(
  workspaceFolder: string,
  mode: StorageMode
): StorageLocation {
  if (mode === 'workspace') {
    const root = path.join(workspaceFolder, '.codenotes');
    return {
      root,
      storePath: path.join(root, 'store.json'),
      mdDir: path.join(root, 'md'),
      inWorkspace: true,
    };
  }
  // global 模式：用 workspace 的名称+路径哈希做子目录，避免同名工程冲突
  const workspaceName = path.basename(workspaceFolder).trim() || 'workspace';
  const u = cryptoHash(workspaceFolder).slice(0, 8);
  const root = path.join(globalRoot(), `${workspaceName}-${u}`);
  return {
    root,
    storePath: path.join(root, 'store.json'),
    mdDir: path.join(root, 'md'),
    inWorkspace: false,
  };
}

/** 是否位于工程内部（规范化路径前缀匹配） */
export function isInsideWorkspace(candidate: string, workspaceFolder: string): boolean {
  const a = path.resolve(candidate);
  const b = path.resolve(workspaceFolder);
  return a === b || a.startsWith(b + path.sep);
}

function cryptoHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}