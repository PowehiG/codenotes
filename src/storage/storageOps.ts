/**
 * 存储运维：StorageService（当前存储位置的访问入口）+ 迁移（workspace ⇄ global）。
 * 迁移只复制不删除——旧数据保留，用户确认无误后可手动清理，保证可回退。
 */
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveStorage, StorageLocation, StorageMode } from './storage';
import { NotesCore } from '../core/notesCore';

export class StorageService {
  readonly loc: StorageLocation;

  constructor(workspaceFolder: string, mode: StorageMode) {
    this.loc = resolveStorage(workspaceFolder, mode);
  }

  get root(): string {
    return this.loc.root;
  }
}

/** 将当前存储从 from 迁移到 to（仅复制，保留旧数据），并让 core 平滑切换到新位置 */
export async function migrateStorage(
  core: NotesCore,
  from: StorageMode,
  to: StorageMode
): Promise<void> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) throw new Error('未打开工作区');
  const src = core.loc;
  const dst = resolveStorage(wsFolder, to);
  if (src.root === dst.root) return;
  await copyTree(src.root, dst.root);
  await core.relocate(dst);
}

/** 递归复制目录树（跳过 .tmp 与 .git 等内部产物） */
async function copyTree(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.endsWith('.tmp')) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyTree(s, d);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}