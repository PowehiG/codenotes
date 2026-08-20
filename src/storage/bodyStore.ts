/**
 * BodyStore：笔记正文 .md 文件的读写。
 * 正文独立成文件的好处：
 * - AI 对话内容可能很长，不塞进 store.json（避免每次全量读写）
 * - 用户可直接在文件系统/VSCode 里编辑正文
 * - 未来可被其他工具（文档管线、同步）独立消费
 */
import * as path from 'path';
import * as fsp from 'fs/promises';
import { StorageLocation } from './storage';

export class BodyStore {
  constructor(private readonly loc: StorageLocation) {}

  /** 写正文（相对 .codenotes 的 md 路径，如 "md/a1b2.md"） */
  async writeBody(relPath: string, content: string): Promise<void> {
    const abs = this.absPath(relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  }

  /** 读正文；文件不存在返回空字符串 */
  async readBody(relPath: string): Promise<string> {
    try {
      return await fsp.readFile(this.absPath(relPath), 'utf8');
    } catch (e: any) {
      if (e && e.code === 'ENOENT') return '';
      throw e;
    }
  }

  /** 删除正文（不存在则静默成功） */
  async removeBody(relPath: string): Promise<void> {
    await fsp.rm(this.absPath(relPath), { force: true });
  }

  /** 把相对 .codenotes 的正文路径解析为绝对路径（防止路径穿越：仅取文件名） */
  absPath(relPath: string): string {
    const base = relPath.split('/').pop() ?? relPath;
    return `${this.loc.mdDir}/${base}`;
  }
}