/**
 * @local/dsh-inkos-bridge — 把本机 InkOS（@actalk/inkos 1.8.0）接进 WriterX Hermes。
 *
 * 三个模型可见工具：
 *   inkos_status  只读：书库状态（书 / 章节 / 待审 / 失败 / 字数），--json 解析后渲染
 *   inkos_run     白名单命令执行：status / book_list / doctor / write_next /
 *                 forecast_create / forecast_show / forecast_select / fanfic_init
 *   inkos_outline 只读：读一本书的 story/ 大纲与设定文件
 *
 * 插件形状与注册方式完全照抄同仓的 @writerx/dsh-tool-writing 与 @deepseek-ai/dsh-tool-todo：
 *   export { name, inject, Config, apply }
 *   apply() 里 ctx.effect(() => ctx.tools.register(defineTool({...})), label)
 *
 * 子进程一律 windowsHide: true（宿主可能是无控制台的计划任务/pythonw 上下文）。
 *
 * @module @local/dsh-inkos-bridge
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Cordis 插件名。 */
const name = "tool-inkos-bridge";

/** 需要注入的服务：只有工具注册表。 */
const inject = ["tools"];

/** 运行期配置（全部可省，省则用 DEFAULTS）。 */
const Config = z.object({
  inkosRoot: z.string(),
  nodePath: z.string(),
  cliPath: z.string(),
  baseUrl: z.string(),
  timeoutMs: z.number(),
  maxOutputChars: z.number(),
});

/** 本机实测值（见 _报告.md §1）。 */
const DEFAULTS = {
  inkosRoot: "J:\\SimonApp\\AI-Workspace\\InkOS-Test",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  cliPath: "E:\\NodePackages\\node_modules\\@actalk\\inkos\\dist\\index.js",
  /** InkOS Studio 的 REST 前缀实测是 /api/v1（不是 /api；/api 会回落到 SPA index.html）。 */
  baseUrl: "http://127.0.0.1:4567/api/v1",
  timeoutMs: 600000,
  maxOutputChars: 20480,
};

/** 书名 id 只允许安全字符，避免任何形式的路径穿越。 */
const BOOK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** story/ 下允许读的文件（相对书目录）。 */
const OUTLINE_FILES = {
  story_frame: "story/outline/story_frame.md",
  volume_map: "story/outline/volume_map.md",
  world: "story/outline/world.md",
  story_bible: "story/story_bible.md",
  brief: "story/brief.md",
  current_focus: "story/current_focus.md",
  pending_hooks: "story/pending_hooks.md",
  style_guide: "story/style_guide.md",
  chapter_summaries: "story/chapter_summaries.md",
};

/** Model-facing text from report lines（与 @writerx/dsh-tool-writing 同形）。 */
const text = (lines) => [{
  type: "text",
  text: lines.join("\n")
}];

/**
 * 把 patch 行里的 config 与默认值合并成一份完整配置。
 * @param {object} [config] - loader 传入的 row config。
 * @returns {{inkosRoot:string,nodePath:string,cliPath:string,timeoutMs:number,maxOutputChars:number}}
 */
function resolveConfig(config = {}) {
  const pick = (key) => {
    const value = config[key];
    if (value === void 0 || value === null || value === "") return DEFAULTS[key];
    return value;
  };
  return {
    inkosRoot: pick("inkosRoot"),
    nodePath: pick("nodePath"),
    cliPath: pick("cliPath"),
    baseUrl: pick("baseUrl"),
    timeoutMs: pick("timeoutMs"),
    maxOutputChars: pick("maxOutputChars")
  };
}

/**
 * 调 InkOS Studio 的 HTTP 接口（JSON 进、JSON 出），带超时。
 * @param {object} cfg - resolveConfig() 的结果。
 * @param {string} method - HTTP 方法。
 * @param {string} pathAndQuery - 相对 baseUrl 的路径。
 * @param {object} [body] - 要序列化成 JSON 的请求体。
 * @returns {Promise<{status:number,json:any,text:string,ok:boolean}>}
 */
async function inkosHttp(cfg, method, pathAndQuery, body) {
  const url = cfg.baseUrl.replace(/\/+$/, "") + pathAndQuery;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 120000));
  try {
    const init = { method, signal: controller.signal, headers: { accept: "application/json" } };
    if (body !== void 0) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = void 0;
    }
    return { status: response.status, ok: response.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 校验要素文件路径：拒绝绝对路径、反斜杠、盘符、.. 穿越。
 * @param {string} file - 模型给的要素文件名。
 * @returns {string} 原样返回（已验证）。
 */
function requireTruthFile(file) {
  if (typeof file !== "string" || file.trim().length === 0) throw new Error("file 必须是非空字符串");
  const value = file.trim().replace(/^\.\/+/, "");
  if (/[\\:]/.test(value)) throw new Error(`file 不允许反斜杠或盘符：${file}`);
  if (value.includes("..")) throw new Error(`file 不允许路径穿越：${file}`);
  if (!value.endsWith(".md")) throw new Error(`file 必须是 .md：${file}`);
  return value;
}

/**
 * 校验书名 id。
 * @param {string} bookId - 模型给的书名 id。
 * @returns {string} 原样返回（已验证）。
 */
function requireBookId(bookId) {
  if (typeof bookId !== "string" || bookId.length === 0) throw new Error("book_id 必须是非空字符串");
  if (!BOOK_ID_RE.test(bookId)) throw new Error(`book_id 不合法：${bookId}（只允许字母数字 . _ -）`);
  return bookId;
}

/**
 * 跑一条 InkOS CLI 命令，收集 stdout/stderr，带超时与输出上限。
 * @param {object} cfg - resolveConfig() 的结果。
 * @param {string[]} argv - 传给 dist/index.js 的参数。
 * @returns {Promise<{command:string,cwd:string,exitCode:number|null,timedOut:boolean,stdout:string,stderr:string,truncated:boolean}>}
 */
function runInkos(cfg, argv) {
  return new Promise((resolvePromise, rejectPromise) => {
    for (const [key, label] of [["nodePath", "node 可执行文件"], ["cliPath", "InkOS CLI"], ["inkosRoot", "书库目录"]]) {
      if (!existsSync(cfg[key])) {
        rejectPromise(new Error(`找不到${label}：${cfg[key]}`));
        return;
      }
    }
    let child;
    try {
      child = spawn(cfg.nodePath, [cfg.cliPath, ...argv], {
        cwd: cfg.inkosRoot,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_NO_WARNINGS: "1" }
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    const out = { stdout: "", stderr: "", truncated: false };
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, cfg.timeoutMs);
    const pump = (stream, key) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        const room = cfg.maxOutputChars - out[key].length;
        if (room <= 0) {
          out.truncated = true;
          return;
        }
        if (chunk.length <= room) out[key] += chunk;
        else {
          out[key] += chunk.slice(0, room);
          out.truncated = true;
        }
      });
    };
    pump(child.stdout, "stdout");
    pump(child.stderr, "stderr");
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        command: `inkos ${argv.join(" ")}`,
        cwd: cfg.inkosRoot,
        exitCode,
        timedOut,
        stdout: out.stdout,
        stderr: out.stderr,
        truncated: out.truncated
      });
    });
  });
}

/** 把一次执行的原始结果渲染成模型可读的文本行。 */
function describeRun(result, header) {
  const lines = [];
  if (header !== void 0) lines.push(header);
  lines.push(`$ ${result.command}    (cwd: ${result.cwd})`);
  if (result.timedOut) lines.push(`超时被杀（timeoutMs 到点）。`);
  if (result.exitCode !== null && result.exitCode !== 0) lines.push(`退出码：${result.exitCode}`);
  if (result.truncated) lines.push(`[输出已截断]`);
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  lines.push(stdout.length > 0 ? stdout : "(stdout 为空)");
  if (stderr.length > 0) lines.push("--- stderr ---", stderr);
  return lines;
}

/**
 * 构造三条工具。
 * @param {object} cfg - resolveConfig() 的结果。
 * @returns {object[]} registry 就绪的工具定义。
 */
function inkosTools(cfg) {
  const statusTool = defineTool({
    name: "inkos_status",
    description: "读 InkOS 书库状态：书 id / 书名 / 章节数 / 目标章数 / 总字数 / 待审 / 失败 / 降级。只读，不写书稿、不调模型、不花钱。写下一章之前先调它确认 book_id 与进度。",
    parameters: {
      book_id: {
        type: "string",
        description: "书名 id（例如 zhutian-v08）；省略则列出全部书。"
      },
      chapters: {
        type: "boolean",
        description: "true = 附带每章状态与问题（--chapters），输出更长。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(statusLines(value))
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const argv = ["status", "--json"];
      if (args.book_id !== void 0 && args.book_id !== "") argv.push(requireBookId(args.book_id));
      if (args.chapters === true) argv.push("--chapters");
      const run = await runInkos(cfg, argv);
      let parsed;
      try {
        parsed = JSON.parse(run.stdout);
      } catch {
        parsed = void 0;
      }
      if (parsed === void 0) {
        return { ok: run.exitCode === 0, parseError: true, project: void 0, books: [], raw: describeRun(run, "InkOS 状态（不是合法 JSON，原样回显）") };
      }
      return {
        ok: run.exitCode === 0,
        parseError: false,
        project: parsed.project,
        books: Array.isArray(parsed.books) ? parsed.books : [],
        exitCode: run.exitCode
      };
    }
  });

  const outlineTool = defineTool({
    name: "inkos_outline",
    description: "读一本书 story/ 目录里的大纲与设定文件（story_frame 故事框架 / volume_map 卷目 / world 世界 / story_bible / brief / current_focus 当前焦点 / pending_hooks 未回收钩子 / style_guide 文风 / chapter_summaries 章摘要）。只读，不调模型。要「给大纲」或续写前先读它，别凭空编设定。",
    parameters: {
      book_id: {
        type: "string",
        required: true,
        description: "书名 id（例如 zhutian-v08）。"
      },
      file: {
        type: "string",
        enum: Object.keys(OUTLINE_FILES),
        description: "要读哪个文件；默认 story_frame（故事框架）。"
      },
      max_chars: {
        type: "integer",
        description: "最多返回多少字符，默认 12000，上限 40000。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(outlineLines(value))
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const bookId = requireBookId(args.book_id);
      const key = args.file ?? "story_frame";
      const rel = OUTLINE_FILES[key];
      if (rel === void 0) throw new Error(`不支持的 file：${key}`);
      const bookDir = join(cfg.inkosRoot, "books", bookId);
      if (!existsSync(bookDir)) throw new Error(`书不存在：${bookDir}`);
      const available = Object.entries(OUTLINE_FILES)
        .filter(([, relPath]) => existsSync(join(bookDir, relPath)))
        .map(([fileKey]) => fileKey);
      const target = join(bookDir, rel);
      if (!existsSync(target)) {
        return { found: false, book_id: bookId, file: key, path: target, text: "", truncated: false, available };
      }
      const cap = Math.min(Math.max(args.max_chars ?? 12000, 200), 40000);
      const raw = readFileSync(target, "utf8");
      const truncated = raw.length > cap;
      return {
        found: true,
        book_id: bookId,
        file: key,
        path: target,
        bytes: statSync(target).size,
        text: truncated ? raw.slice(0, cap) : raw,
        truncated,
        available
      };
    }
  });

  const runTool = defineTool({
    name: "inkos_run",
    description: "在本机 InkOS 书库里执行一条白名单命令。write_next 会真实写出一章并调用书里配置的模型（花钱、落盘），其余为只读或只写真稿外的产物。action 取值：status / book_list / doctor / write_next / forecast_create（2-5 条隔离分支推演）/ forecast_show / forecast_select（只写 selected-branch-plan.md，不动正史）/ fanfic_init。",
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["status", "book_list", "doctor", "write_next", "forecast_create", "forecast_show", "forecast_select", "fanfic_init"],
        description: "要执行哪条命令。"
      },
      book_id: {
        type: "string",
        description: "书名 id；只有一本书时可省略。"
      },
      context: {
        type: "string",
        description: "write_next 的创作要求（--context），自然语言，例如「这一章要收掉姚乐儿的线索」。"
      },
      count: {
        type: "integer",
        description: "write_next 连写几章（--count），默认 1，上限 20。"
      },
      words: {
        type: "integer",
        description: "write_next 单章字数（--words），覆盖书配置。"
      },
      divergence: {
        type: "string",
        description: "forecast_create 的分歧点，例如「主角是否接受对手的合作提议」。"
      },
      branches: {
        type: "integer",
        description: "forecast_create 分支数 2-5，默认 3。"
      },
      horizon: {
        type: "integer",
        description: "forecast_create 每条分支覆盖几章 1-10，默认 5。"
      },
      forecast_id: {
        type: "string",
        description: "forecast_show / forecast_select 用的推演 id。"
      },
      branch_id: {
        type: "string",
        description: "forecast_select 选的分支 id。"
      },
      title: {
        type: "string",
        description: "fanfic_init 的书名。"
      },
      from_path: {
        type: "string",
        description: "fanfic_init 的原著素材路径（文件或目录），必须已存在。"
      },
      mode: {
        type: "string",
        enum: ["canon", "au", "ooc", "cp"],
        description: "fanfic_init 的同人模式，默认 canon。"
      },
      genre: {
        type: "string",
        description: "fanfic_init 题材，默认 other。"
      },
      platform: {
        type: "string",
        description: "fanfic_init 目标平台，默认 other。"
      },
      target_chapters: {
        type: "integer",
        description: "fanfic_init 目标章数，默认 100。"
      },
      chapter_words: {
        type: "integer",
        description: "fanfic_init 每章字数，默认 3000。"
      },
      lang: {
        type: "string",
        enum: ["zh", "en"],
        description: "fanfic_init 写作语言。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(value.lines ?? ["(没有输出)"])
    },
    timeoutMs: cfg.timeoutMs + 60000,
    async execute(args) {
      const argv = [];
      const bookArgs = () => {
        if (args.book_id !== void 0 && args.book_id !== "") return [requireBookId(args.book_id)];
        return [];
      };
      switch (args.action) {
        case "status": {
          argv.push("status", ...bookArgs(), "--json");
          break;
        }
        case "book_list": {
          argv.push("book", "list");
          break;
        }
        case "doctor": {
          argv.push("doctor");
          break;
        }
        case "write_next": {
          const count = args.count ?? 1;
          if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("count 必须是 1-20 的整数");
          argv.push("write", "next", ...bookArgs(), "--count", String(count), "--json");
          if (args.words !== void 0) {
            if (!Number.isInteger(args.words) || args.words < 300 || args.words > 20000) throw new Error("words 必须是 300-20000 的整数");
            argv.push("--words", String(args.words));
          }
          if (args.context !== void 0 && args.context.trim().length > 0) argv.push("--context", args.context);
          break;
        }
        case "forecast_create": {
          const branches = args.branches ?? 3;
          const horizon = args.horizon ?? 5;
          if (!Number.isInteger(branches) || branches < 2 || branches > 5) throw new Error("branches 必须是 2-5 的整数");
          if (!Number.isInteger(horizon) || horizon < 1 || horizon > 10) throw new Error("horizon 必须是 1-10 的整数");
          argv.push("forecast", "create", ...bookArgs(), "--branches", String(branches), "--horizon", String(horizon), "--json");
          if (args.divergence !== void 0 && args.divergence.trim().length > 0) argv.push("--divergence", args.divergence);
          break;
        }
        case "forecast_show": {
          if (typeof args.forecast_id !== "string" || args.forecast_id.length === 0) throw new Error("forecast_show 需要 forecast_id");
          argv.push("forecast", "show", ...bookArgs(), args.forecast_id, "--json");
          break;
        }
        case "forecast_select": {
          if (typeof args.forecast_id !== "string" || args.forecast_id.length === 0) throw new Error("forecast_select 需要 forecast_id");
          if (typeof args.branch_id !== "string" || args.branch_id.length === 0) throw new Error("forecast_select 需要 branch_id");
          argv.push("forecast", "select", ...bookArgs(), args.forecast_id, args.branch_id, "--json");
          break;
        }
        case "fanfic_init": {
          if (typeof args.title !== "string" || args.title.trim().length === 0) throw new Error("fanfic_init 需要 title");
          if (typeof args.from_path !== "string" || args.from_path.length === 0) throw new Error("fanfic_init 需要 from_path");
          if (!existsSync(args.from_path)) throw new Error(`素材路径不存在：${args.from_path}`);
          argv.push("fanfic", "init", "--title", args.title, "--from", args.from_path, "--json");
          if (args.mode !== void 0) argv.push("--mode", args.mode);
          if (args.genre !== void 0) argv.push("--genre", args.genre);
          if (args.platform !== void 0) argv.push("--platform", args.platform);
          if (args.target_chapters !== void 0) argv.push("--target-chapters", String(args.target_chapters));
          if (args.chapter_words !== void 0) argv.push("--chapter-words", String(args.chapter_words));
          if (args.lang !== void 0) argv.push("--lang", args.lang);
          break;
        }
        default:
          throw new Error(`不支持的 action：${args.action}`);
      }
      const run = await runInkos(cfg, argv);
      return {
        action: args.action,
        command: run.command,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        truncated: run.truncated,
        stdout: run.stdout.trim(),
        stderr: run.stderr.trim(),
        lines: describeRun(run, `InkOS ${args.action}`)
      };
    }
  });

  const truthListTool = defineTool({
    name: "inkos_truth_list",
    description: "列出 InkOS 一本书的可写要素清单（GET /api/v1/books/{id}/truth）。每项给 name / size / preview / legacy。legacy=true 的是旧布局 shim，直接写会被 400 拒绝。往 InkOS 填资料之前先调它拿真实文件名，不要凭猜测拼路径。",
    parameters: {
      book_id: {
        type: "string",
        required: true,
        description: "书名 id（例如 zhutian-v09）。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(value.lines ?? [])
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const bookId = requireBookId(args.book_id);
      const res = await inkosHttp(cfg, "GET", `/books/${bookId}/truth`);
      if (!res.ok || res.json === void 0) throw new Error(`读要素清单失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
      const files = Array.isArray(res.json.files) ? res.json.files : [];
      const lines = [`${bookId} · 要素清单 ${files.length} 项`];
      for (const item of files) {
        const flag = item.legacy === true ? "  [legacy·不可写]" : "";
        lines.push(`- ${item.name}｜${item.size ?? "?"} 字节${flag}`);
      }
      if (files.length === 0) lines.push("（这本书的要素清单是空的）");
      return { book_id: bookId, count: files.length, files, lines };
    }
  });

  const truthReadTool = defineTool({
    name: "inkos_truth_read",
    description: "读 InkOS 某个要素文件的全文（GET /api/v1/books/{id}/truth/{file}）。支持 outline/ 与 roles/ 下的嵌套路径（中文文件名按段编码）。只读，不花 token、不调模型。",
    parameters: {
      book_id: {
        type: "string",
        required: true,
        description: "书名 id（例如 zhutian-v09）。"
      },
      file: {
        type: "string",
        required: true,
        description: "要素文件名，例如 style_guide.md / outline/story_frame.md / roles/景图南/景图南.md。先用 inkos_truth_list 确认真实名。"
      },
      max_chars: {
        type: "integer",
        description: "最多返回多少字符，默认 12000，上限 40000。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(value.lines ?? [])
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const bookId = requireBookId(args.book_id);
      const file = requireTruthFile(args.file);
      const encoded = file.split("/").map((segment) => encodeURIComponent(segment)).join("/");
      const res = await inkosHttp(cfg, "GET", `/books/${bookId}/truth/${encoded}`);
      if (!res.ok) throw new Error(`读要素失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
      const raw = res.json !== void 0
        ? String(res.json.content ?? res.json.text ?? res.json.body ?? res.text)
        : res.text;
      const cap = Math.min(Math.max(args.max_chars ?? 12000, 200), 40000);
      const truncated = raw.length > cap;
      const body = truncated ? raw.slice(0, cap) : raw;
      return {
        book_id: bookId,
        file,
        bytes: Buffer.byteLength(raw, "utf8"),
        truncated,
        text: body,
        lines: [`${bookId} · ${file}（${Buffer.byteLength(raw, "utf8")} 字节${truncated ? "，已截断" : ""}）`, "---", body]
      };
    }
  });

  const truthWriteTool = defineTool({
    name: "inkos_truth_write",
    description: "把整篇 Markdown 写进 InkOS 的一个要素文件（PUT /api/v1/books/{id}/truth/{file}，body {content}）。这是「AI 往 InkOS 填资料」的唯一通道 —— CLI 的 book update / chapter sync / write sync 都写不了要素。语义是整篇覆盖，不是追加。写前先 inkos_truth_read 留一份旧全文。dry_run=true 只做可写性检查不落盘。",
    parameters: {
      book_id: {
        type: "string",
        required: true,
        description: "书名 id（例如 zhutian-v09）。"
      },
      file: {
        type: "string",
        required: true,
        description: "要素文件名，例如 style_guide.md / outline/story_frame.md / roles/景图南/景图南.md。"
      },
      content: {
        type: "string",
        required: true,
        description: "要写入的整篇 Markdown 全文（覆盖原文件）。"
      },
      dry_run: {
        type: "boolean",
        description: "true = 只检查这个文件是否在白名单且非 legacy，不写入。默认 false。"
      }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => text(value.lines ?? [])
    },
    async execute(args) {
      const bookId = requireBookId(args.book_id);
      const file = requireTruthFile(args.file);
      const dict = await inkosHttp(cfg, "GET", `/books/${bookId}/truth`);
      if (!dict.ok || dict.json === void 0) throw new Error(`读要素清单失败：HTTP ${dict.status} ${dict.text.slice(0, 300)}`);
      const files = Array.isArray(dict.json.files) ? dict.json.files : [];
      const entry = files.find((item) => item.name === file);
      if (entry === void 0) {
        const names = files.map((item) => item.name);
        throw new Error(`要素 ${file} 不在 ${bookId} 的白名单里。可用：${names.join("、")}`);
      }
      if (entry.legacy === true) throw new Error(`要素 ${file} 是 legacy shim，写入会被服务端 400 拒绝。改用新布局的对应文件。`);
      if (args.dry_run === true) {
        return {
          book_id: bookId,
          file,
          dry_run: true,
          writable: true,
          bytes_before: entry.size,
          lines: [`${bookId} · ${file} 可写（dry_run，未写入）`, `现状 ${entry.size} 字节，准备写入 ${Buffer.byteLength(args.content, "utf8")} 字节`]
        };
      }
      const encoded = file.split("/").map((segment) => encodeURIComponent(segment)).join("/");
      const res = await inkosHttp(cfg, "PUT", `/books/${bookId}/truth/${encoded}`, { content: args.content });
      if (!res.ok) throw new Error(`写要素失败：HTTP ${res.status} ${res.text.slice(0, 400)}`);
      const after = await inkosHttp(cfg, "GET", `/books/${bookId}/truth`);
      const afterEntry = after.ok && after.json !== void 0 && Array.isArray(after.json.files)
        ? after.json.files.find((item) => item.name === file)
        : void 0;
      const bytesAfter = afterEntry?.size ?? Buffer.byteLength(args.content, "utf8");
      return {
        book_id: bookId,
        file,
        status: res.status,
        bytes_before: entry.size,
        bytes_after: bytesAfter,
        lines: [
          `${bookId} · ${file} 已写入（HTTP ${res.status}）`,
          `字节 ${entry.size} → ${bytesAfter}`,
          `回读校验：${afterEntry !== void 0 ? "清单里可见" : "清单里暂不可见（可能需刷新）"}`
        ]
      };
    }
  });

  return [statusTool, outlineTool, runTool, truthListTool, truthReadTool, truthWriteTool];
}

/** inkos_status 的文本渲染。 */
function statusLines(value) {
  const lines = [];
  if (value.parseError) {
    lines.push("InkOS status 没有返回合法 JSON，原样回显：");
    lines.push(...value.raw);
    return lines;
  }
  if (value.project !== void 0) lines.push(`书库：${value.project}`);
  if (value.books.length === 0) {
    lines.push("没有书。");
    return lines;
  }
  lines.push(`共 ${value.books.length} 本：`);
  for (const book of value.books) {
    const pending = book.pending ?? 0;
    const failed = book.failed ?? 0;
    const flags = [];
    if (pending > 0) flags.push(`待审 ${pending}`);
    if (failed > 0) flags.push(`失败 ${failed}`);
    if ((book.degraded ?? 0) > 0) flags.push(`降级 ${book.degraded}`);
    lines.push(
      `- ${book.id}｜${book.title}｜${book.status}｜${book.genre}/${book.platform}` +
      `｜${book.chapters}/${book.targetChapters ?? "?"} 章｜${book.totalWords} 字` +
      `｜均 ${book.avgWordsPerChapter} 字/章` +
      (flags.length > 0 ? `｜${flags.join("、")}` : "")
    );
  }
  return lines;
}

/** inkos_outline 的文本渲染。 */
function outlineLines(value) {
  const lines = [];
  if (!value.found) {
    lines.push(`${value.book_id} 里没有 ${value.file}（${value.path}）。`);
    if (value.available.length > 0) lines.push(`这本书实际有：${value.available.join("、")}`);
    else lines.push("这本书的 story/ 目录里一个可读文件都没有。");
    return lines;
  }
  lines.push(`${value.book_id} · ${value.file}（${value.bytes} 字节${value.truncated ? "，已截断" : ""}）`);
  if (value.available.length > 0) lines.push(`可读文件：${value.available.join("、")}`);
  lines.push("---");
  lines.push(value.text);
  return lines;
}

/**
 * 注册三条工具。
 * @param {object} ctx - 挂载上下文（需要 tools 服务）。
 * @param {object} [config] - patch 行里的 config。
 */
function apply(ctx, config) {
  const cfg = resolveConfig(config);
  for (const tool of inkosTools(cfg)) {
    ctx.effect(() => ctx.tools.register(tool), `inkos-bridge: register ${tool.name}`);
  }
}

export { Config, DEFAULTS, OUTLINE_FILES, apply, describeRun, inkosTools, inject, name, resolveConfig, runInkos, statusLines };
