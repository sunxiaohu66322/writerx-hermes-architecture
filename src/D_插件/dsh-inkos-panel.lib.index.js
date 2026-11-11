/**
 * @local/dsh-inkos-panel — Host 侧：书架数据 + 加载自证。
 *
 * 界面在 ./client.js（浏览器半）。这里只做一件事：
 *   把 WriterX 自己的作品库（作品\*）读成书架卡片数据，暴露在 /inkos-panel/books。
 *
 * 为什么不让前端直接调 /novel-shelf/tree：那条路由要 token，我的面板拿不到。
 * 直接读磁盘更稳，而且和书架看的是同一个目录 —— 这就是"书库直接对接书架"。
 *
 * @module @local/dsh-inkos-panel
 */
import { appendFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "local-inkos-panel";
export const inject = ["webServer"];

/** WriterX 作品库（与 novel-shelf 的默认位置一致：<文档>\WriterX\作品）。 */
const LIBRARY_ROOT = "F:\\Users\\Administrator\\Documents\\WriterX\\作品";

/** 发一段 JSON。 */
function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

/**
 * 读作品库：一本一个文件夹，`book.yml` 给书名与篇幅形态，`正文/` 给章节。
 * 同章的多份 `第NNN章 (2).md` 是历史版本，单独计数、不计入正本。
 * @returns {Promise<Array<{dir:string,title:string,form:string,chapters:number,dup:number,words:number,updatedAt:number|null}>>}
 */
async function readShelf() {
  let entries;
  try {
    entries = await readdir(LIBRARY_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const books = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(LIBRARY_ROOT, entry.name);
    let title = entry.name;
    let form = "";
    try {
      const yml = await readFile(join(dir, "book.yml"), "utf8");
      const t = /^title:\s*(.+)$/m.exec(yml);
      if (t) title = t[1].trim();
      const f = /^form:\s*(.+)$/m.exec(yml);
      if (f) form = f[1].trim();
    } catch { /* 没有 book.yml 就用文件夹名 */ }
    let chapters = 0;
    let dup = 0;
    let bytes = 0;
    let updatedAt = null;
    let latestChapter = "";
    try {
      const files = await readdir(join(dir, "正文"));
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (/\(\d+\)\.md$/.test(file)) {
          dup += 1;
          continue;
        }
        chapters += 1;
        try {
          const info = await stat(join(dir, "正文", file));
          bytes += info.size;
          if (updatedAt === null || info.mtimeMs > updatedAt) {
            updatedAt = info.mtimeMs;
            latestChapter = file.replace(/\.md$/, "");
          }
        } catch { /* 单个文件读不到就跳过 */ }
      }
    } catch { /* 没有 正文/ 就是空书 */ }
    books.push({
      dir: entry.name,
      title,
      form,
      chapters,
      dup,
      words: Math.round(bytes / 3),
      updatedAt,
      latestChapter
    });
  }
  books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return books;
}

export function apply(ctx) {
  try {
    appendFileSync(fileURLToPath(new URL("../host-loaded.log", import.meta.url)),
      new Date().toISOString() + " apply() entered\n");
  } catch { /* 写日志失败不影响插件 */ }

  if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== "function") return;
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/inkos-panel",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/inkos-panel/ping") {
          sendJson(res, 200, { ok: true, library: LIBRARY_ROOT });
          return;
        }
        if (url.pathname === "/inkos-panel/books") {
          sendJson(res, 200, { library: LIBRARY_ROOT, books: await readShelf() });
          return;
        }
        sendJson(res, 404, { error: "not found", path: url.pathname });
      } catch (error) {
        sendJson(res, 500, { error: String((error && error.message) || error) });
      }
    }
  }), "inkos-panel: shelf routes");
}
