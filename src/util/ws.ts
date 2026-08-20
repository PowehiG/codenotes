/**
 * 工作区路径工具：workspace 相对路径 ↔ 绝对 Uri。
 * 锚点在 store.json 里一律存 workspace 相对路径（多机稳定），需要读取文件时换算回绝对路径。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { workspace } from 'vscode';

/** 相对路径 → 绝对 Uri（跨多个 workspace folder 时按文件实际位置匹配） */
export function absUriOf(rel: string): vscode.Uri | undefined {
  const folders = workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  if (folders.length === 1) return vscode.Uri.joinPath(folders[0].uri, rel);
  // 多 root：按文件是否存在选择（stat 是同步 API，返回 FileStat 而非 Promise）
  for (const f of folders) {
    const u = vscode.Uri.joinPath(f.uri, rel);
    try {
      workspace.fs.stat(u);
      return u;
    } catch {
      /* 尝试下一个 root */
    }
  }
  return vscode.Uri.joinPath(folders[0].uri, rel);
}

/** 绝对路径 → workspace 相对路径（vscode 内置换算，容忍跨 root） */
export function relOf(uri: vscode.Uri): string {
  const rel = workspace.asRelativePath(uri, false);
  return rel.split(path.sep).join('/');
}

/** 判断某绝对路径是否在工作区任一 root 内 */
export function isInWorkspace(uri: vscode.Uri): boolean {
  return workspace.getWorkspaceFolder(uri) !== undefined;
}