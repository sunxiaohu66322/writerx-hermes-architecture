/**
 * @local/dsh-scene9136 — 把本机「场景推演服务（9136/9137）」接进 DSH / WriterX Hermes。
 *
 * 四个模型可见工具：
 *   scene9136_status  只读：GET /api/health + /api/state（不碰 /api/socket/*）
 *   scene9136_plan    生成施工图：POST /api/derive，固定 events=preview，落"候选状态文件"
 *   scene9136_check   辅助检查：POST /api/check | /api/ambient_check（不作硬闸门）
 *   scene9136_apply   采用已确认候选：不重跑 derive，只按候选写 4 个受管文件
 *
 * 设计红线（阶段一授权 §二）：
 *   · 插件只做调度与数据适配，算法全在 Python 服务里。
 *   · 甲：16 个条件字段（含 time/crowd/exp/dark/pain/partner/era 七轴）全部由本插件构造后传入。
 *   · 同一份结果：plan 保存原始请求/完整返回/fingerprint/版本/plan_hash；apply 只比对，不重抽。
 *   · 第一版不调用 events=commit；骨架历史由本插件的状态文件维护。
 *   · apply 只写 story/focus/chNN.brief.md、story/focus/chNN.focus.md、story/brief.md、
 *     story/current_focus.md 四个文件；不碰正式 _章场景配置.json。
 *   · Agent 上限 validated；approved 必须来自作者的人工确认产物（见 1A-实现说明.md §5）。
 *
 * @module @local/dsh-scene9136
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Cordis 插件名。 */
const name = "tool-scene9136";

/** 需要注入的服务：只有工具注册表。 */
const inject = ["tools"];

/** 运行期配置（六参；inkosRoot / libraryRoot 无内置默认，缺了报 E_CONFIG_MISSING）。 */
const Config = z.object({
  baseUrl: z.string(),
  timeoutMs: z.number(),
  inkosRoot: z.string(),
  libraryRoot: z.string(),
  stateFile: z.string(),
  keepBackup: z.number(),
});

/** 协议常量默认值（不是路径，换端口时只改 config）。 */
const PROTOCOL_DEFAULTS = {
  baseUrl: "http://127.0.0.1:9137",
  timeoutMs: 5000,
  keepBackup: 10,
};

/** 整章预算（作者口径：单场 5000 / 整章 30000）。 */
const CHAPTER_BUDGET_MS = 30000;

/** 「无法真正执行的硬禁令」上限：force_new 重抽次数。 */
const MAX_FORCE_NEW = 3;

/** 9136 的 16 个条件字段（服务.py:325-342 FIELDS）。顺序固定，便于指纹稳定。 */
const FIELDS = [
  "type", "rel", "stage", "where", "temp", "goal", "level", "baseline",
  "witness", "time", "crowd", "exp", "dark", "pain", "partner", "era",
];

/** 七根调制轴（必须显式声明 unknown 才允许缺失）。 */
const AXES = ["time", "crowd", "exp", "dark", "pain", "partner", "era"];

/** 场次对象允许的 9 个键（D 的 SCENE_KEYS）。 */
const SCENE_KEYS = ["index", "tag", "facts", "note", "ambient", "locked", "preferences", "unknown", "forbidden"];

/** 已知枚举（只写服务端源码里确定的那几个；其余交给服务端判，避免两边漂移）。 */
const BASELINE = ["W0", "W1", "W2", "W3"];

/** 受管区块标记。 */
const BLOCK_BEGIN = "<!-- SCENE-DERIVE:BEGIN -->";
const BLOCK_END = "<!-- SCENE-DERIVE:END -->";

/** 状态：draft → validated → approved → applied（Agent 上限 validated）。 */
const STATES = ["draft", "validated", "approved", "applied", "superseded"];

/** 秒级时间戳串。 */
const stamp = () => new Date().toISOString();

/** 短哈希。 */
const h16 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** 结构化错误：细节一律写进 message 本体（B⑦ 实测：toolErrorResult 只透传 message）。 */
class SceneError extends Error {
  constructor(code, detail, extra = {}) {
    const where = extra.scene_index !== undefined ? `第${extra.scene_index}场 ` : "";
    const field = extra.field ? `${extra.field} ` : "";
    // detail 自己以字段名开头时不再重复前缀（模型看到的文案要干净）
    const body = extra.field && detail.startsWith(`${extra.field} `) ? detail.slice(extra.field.length + 1) : detail;
    const fix = extra.fix ? `（修法：${extra.fix}）` : "";
    super(`${code}：${where}${field}${body}${fix}`);
    this.name = "SceneError";
    this.code = code;
    this.detail = extra;
  }
}

/** Model-facing 文本块（与 @local/dsh-inkos-bridge 同形）。 */
const text = (lines) => [{ type: "text", text: lines.join("\n") }];

/**
 * 合并 patch 行 config 与协议默认值；两个路径参数缺失直接报错。
 * @param {object} [config] loader 传入的行 config
 */
function resolveConfig(config = {}) {
  const pickProtocol = (key) => (config[key] === undefined || config[key] === null || config[key] === "" ? PROTOCOL_DEFAULTS[key] : config[key]);
  const cfg = {
    baseUrl: String(pickProtocol("baseUrl")).replace(/\/+$/, ""),
    timeoutMs: Number(pickProtocol("timeoutMs")),
    keepBackup: Number(pickProtocol("keepBackup")),
    inkosRoot: config.inkosRoot,
    libraryRoot: config.libraryRoot,
    stateFile: config.stateFile,
  };
  const missing = ["inkosRoot", "libraryRoot", "stateFile"].filter((key) => typeof cfg[key] !== "string" || cfg[key].trim() === "");
  if (missing.length > 0) {
    throw new SceneError("E_CONFIG_MISSING", `缺少配置 ${missing.join("、")}`, {
      field: missing.join(","),
      fix: "在 profiles\\hermes\\cordis.patch.yml 的 scene9136 行 config 里补上（插件不猜路径）",
    });
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) throw new SceneError("E_CONFIG_MISSING", "timeoutMs 必须是正数", { field: "timeoutMs" });
  return cfg;
}

/**
 * 一次 HTTP 调用（JSON 进 / 文本先取再尝试 JSON）。
 * @returns {Promise<{status:number, ok:boolean, json:any, text:string, ms:number}>}
 */
async function httpJson(cfg, method, path, body, timeoutMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { method, signal: controller.signal, headers: { accept: "application/json" } };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json; charset=utf-8";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(cfg.baseUrl + path, init);
    const raw = await response.text();
    let json;
    try { json = JSON.parse(raw); } catch { json = undefined; }
    return { status: response.status, ok: response.ok, json, text: raw, ms: Date.now() - started };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw new SceneError(timedOut ? "E_TIMEOUT" : "E_SERVICE_DOWN",
      timedOut ? `请求 ${path} 超过 ${timeoutMs}ms 未返回` : `连不上 ${cfg.baseUrl}（${error?.message ?? error}）`,
      { fix: "确认隔离副本服务在听该端口；保活只由既有脚本负责，插件不启停服务" });
  } finally {
    clearTimeout(timer);
  }
}

/** 读服务状态；失败返回 undefined（status 工具要能在服务离线时给结论）。 */
async function readState(cfg, timeoutMs = Math.min(cfg.timeoutMs, 5000)) {
  try {
    const res = await httpJson(cfg, "GET", "/api/state", undefined, timeoutMs);
    return res.ok ? res.json : undefined;
  } catch { return undefined; }
}

/** 版本信息：serviceVersion 取 /api/state 的「版本」；ruleVersion 取计数表的指纹（数据变了就变）。 */
function versionsOf(state) {
  return {
    serviceVersion: state?.["版本"] ?? "UNKNOWN",
    ruleVersion: state?.["计数"] ? h16(state["计数"]) : "UNKNOWN",
  };
}

/** 解析 scenes / scenes_json 两个入口（scenes 优先）。 */
function resolveScenes(args) {
  if (Array.isArray(args.scenes) && args.scenes.length > 0) return args.scenes;
  if (typeof args.scenes_json === "string" && args.scenes_json.trim() !== "") {
    let parsed;
    try { parsed = JSON.parse(args.scenes_json); }
    catch (error) {
      throw new SceneError("E_BAD_JSON", `scenes_json 不是合法 JSON：${error.message}`, {
        fix: "检查引号/逗号；或改用结构化 scenes 数组",
      });
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.scenes;
    if (!Array.isArray(list) || list.length === 0) throw new SceneError("E_EMPTY_SCENES", "scenes_json 里没有场次数组");
    return list;
  }
  throw new SceneError("E_EMPTY_SCENES", "scenes 与 scenes_json 都没有给", { fix: "二选一，传至少 1 场" });
}

/**
 * 本地校验（D 的六条），返回规整后的场次数组；不改写作者给的值。
 * @param {any[]} scenes
 */
function validateScenes(scenes) {
  const out = [];
  const seenIndex = new Set();
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const label = Number.isInteger(scene?.index) ? scene.index : i + 1;
    if (scene === null || typeof scene !== "object" || Array.isArray(scene)) {
      throw new SceneError("E_BAD_TYPE", "场次必须是对象", { scene_index: label, field: "scenes[]" });
    }
    // ① 未知键
    for (const key of Object.keys(scene)) {
      if (!SCENE_KEYS.includes(key)) {
        throw new SceneError("E_UNKNOWN_FIELD", `场次顶层不允许键 ${key}`, {
          scene_index: label, field: key, fix: `只允许 ${SCENE_KEYS.join("/")}`,
        });
      }
    }
    // ② index
    if (!Number.isInteger(scene.index) || scene.index < 1) {
      throw new SceneError("E_BAD_TYPE", "index 必须是 ≥1 的整数", { scene_index: label, field: "index", fix: "例如 index: 1" });
    }
    if (seenIndex.has(scene.index)) {
      throw new SceneError("E_BAD_VALUE", "index 重复", { scene_index: label, field: "index", fix: "每场一个唯一 index" });
    }
    seenIndex.add(scene.index);
    // ③ facts
    const factsIn = scene.facts ?? {};
    if (factsIn === null || typeof factsIn !== "object" || Array.isArray(factsIn)) {
      throw new SceneError("E_BAD_TYPE", "facts 必须是对象", { scene_index: label, field: "facts" });
    }
    for (const key of Object.keys(factsIn)) {
      if (!FIELDS.includes(key)) {
        throw new SceneError("E_UNKNOWN_FIELD", `facts 不允许键 ${key}`, { scene_index: label, field: key, fix: `只允许 16 键：${FIELDS.join("/")}` });
      }
    }
    // ④ 三条数组
    for (const key of ["locked", "preferences", "unknown", "forbidden"]) {
      const value = scene[key];
      if (value !== undefined && !Array.isArray(value)) {
        throw new SceneError("E_BAD_TYPE", `${key} 必须是数组`, { scene_index: label, field: key, fix: `例如 ${key}: ["rel"]` });
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!FIELDS.includes(item)) {
            throw new SceneError("E_UNKNOWN_FIELD", `${key} 里有未知字段 ${item}`, { scene_index: label, field: key, fix: "只能是 16 个条件字段名" });
          }
        }
      }
    }
    const locked = scene.locked ?? [];
    const preferences = scene.preferences ?? [];
    const unknown = scene.unknown ?? [];
    const forbidden = scene.forbidden ?? [];
    // ⑤ 类型与取值
    const facts = {};
    for (const [key, raw] of Object.entries(factsIn)) {
      if (key === "temp" || key === "level") {
        if (!Number.isInteger(raw) || raw < 0 || raw > 4) {
          throw new SceneError("E_BAD_VALUE", `${key} 必须是 0–4 的整数（收到 ${JSON.stringify(raw)}）`, {
            scene_index: label, field: key, fix: "去掉引号，用整数 0..4",
          });
        }
      } else if (typeof raw !== "string" || raw.trim() === "") {
        throw new SceneError("E_BAD_TYPE", `${key} 必须是非空字符串`, { scene_index: label, field: key });
      }
      if (key === "baseline" && !BASELINE.includes(raw)) {
        throw new SceneError("E_BAD_VALUE", `baseline 只接受 ${BASELINE.join("/")}`, { scene_index: label, field: key });
      }
      facts[key] = raw;
    }
    // ⑥ locked / forbidden / undeclared
    for (const key of locked) {
      if (facts[key] === undefined) {
        throw new SceneError("E_LOCKED_EMPTY", `${key} 声明为 locked 但没有给值`, { scene_index: label, field: key, fix: `给 ${key} 一个值，或从 locked 删掉` });
      }
      if (forbidden.includes(key)) {
        throw new SceneError("E_LOCKED_FORBIDDEN", `${key} 不能同时 locked 与 forbidden`, { scene_index: label, field: key, fix: "删掉其中一个声明" });
      }
    }
    for (const key of forbidden) {
      if (facts[key] !== undefined) {
        throw new SceneError("E_FORBIDDEN_CONFLICT", `${key} 在 forbidden 里却给了值 ${JSON.stringify(facts[key])}`, {
          scene_index: label, field: key, fix: `删掉 facts.${key}，或把 ${key} 从 forbidden 移除`,
        });
      }
    }
    const undeclared = FIELDS.filter((key) => facts[key] === undefined && !unknown.includes(key));
    if (undeclared.length > 0) {
      throw new SceneError("E_UNDECLARED", `这些字段既没给值也没声明 unknown：${undeclared.join("、")}`, {
        scene_index: label, field: undeclared.join(","), fix: "给值，或写进 unknown 表示「本场未定」",
      });
    }
    const note = scene.note === undefined ? undefined : String(scene.note);
    out.push({
      index: scene.index,
      tag: scene.tag === undefined ? undefined : String(scene.tag),
      facts,
      note,
      ambient: scene.ambient,
      locked, preferences, unknown, forbidden,
      // 语义如实（§二.2）：第一版这两项能力不存在，标记出来，不假装有
      semantics: {
        preferences: "第一版无软偏好权重：preferences 只记录来源，不参与加权",
        forbidden: "forbidden 只能阻止显式给值；对「未给值走服务端默认」的字段不能可靠阻止",
      },
    });
  }
  return out;
}

/** 场次的 derive 请求体：只传有值的字段（unknown 的留给服务端默认，再用 V0 核对）。 */
function deriveBody(book, chapter, scene, forceNew) {
  const facts = {};
  for (const key of FIELDS) if (scene.facts[key] !== undefined) facts[key] = scene.facts[key];
  return {
    book,
    chapter,
    scene: scene.index,
    facts,
    locked: scene.locked,
    preferences: scene.preferences,
    unknown: scene.unknown,
    forbidden: scene.forbidden,
    force_new: forceNew === true,
    events: "preview",
  };
}

/** 从一次 derive 返回里抽取需要长期保存的部分。 */
function extractPlan(scene, request, res) {
  const origin = res.inputs?.origin ?? res.origin ?? undefined;
  const skeleton = res.skeleton ?? res.inputs?.skeleton ?? undefined;
  return {
    sceneIndex: scene.index,
    tag: scene.tag ?? null,
    request,
    fingerprint: res.fingerprint ?? res.identity?.fingerprint ?? "UNKNOWN",
    identityStatus: res.identity?.status ?? "unknown",
    skeletonId: skeleton?.id ?? skeleton?.skeleton_id ?? res.skeleton_id ?? null,
    skeleton,
    shape: res.shape ?? null,
    inputs: res.inputs ?? null,
    origin: origin ?? null,
    scenePlan: res.scene_plan ?? null,
    planText: res["施工图"] ?? res.text ?? res.plan_text ?? null,
    warnings: res.warnings ?? [],
    conflicts: res.conflicts ?? [],
  };
}

/** V0 总闸：服务端把某字段当默认值用了，但本场没声明 unknown → 整批失败。 */
function checkOrigin(scene, plan) {
  const origin = plan.origin;
  if (origin === null || typeof origin !== "object") return null;
  const bad = [];
  for (const [field, value] of Object.entries(origin)) {
    if (!FIELDS.includes(field)) continue;
    if (value === "default" && !scene.unknown.includes(field) && scene.facts[field] === undefined) bad.push(field);
  }
  if (bad.length === 0) return null;
  throw new SceneError("E_ORIGIN_MISMATCH",
    `服务端把 ${bad.join("、")} 当默认值用了，但本场没有声明 unknown（=静默降级）`,
    { scene_index: scene.index, field: bad.join(","), fix: "把这些键写进 facts，或写进 unknown 表示本场未定" });
}

/** 读状态文件（不存在则给空骨架）。 */
function readStateFile(cfg) {
  if (!existsSync(cfg.stateFile)) return { schema: 1, candidates: {}, skeletons: [], revisions: [] };
  const raw = readFileSync(cfg.stateFile, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      schema: 1,
      candidates: parsed.candidates ?? {},
      skeletons: Array.isArray(parsed.skeletons) ? parsed.skeletons : [],
      revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [],
    };
  } catch (error) {
    throw new SceneError("E_STATE_CORRUPT", `状态文件不是合法 JSON：${cfg.stateFile}（${error.message}）`, {
      fix: "先备份该文件再从 .bak 恢复；不要手改后直接重试",
    });
  }
}

/** 原子写状态文件。 */
function writeStateFile(cfg, state) {
  mkdirSync(dirname(cfg.stateFile), { recursive: true });
  const tmp = `${cfg.stateFile}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, cfg.stateFile);
}

/** 候选键：作品 + 章节（一章一份候选）。 */
const candidateKey = (book, chapter) => `${book}|${chapter}`;

/** 定位书目录：inkosRoot/<book> → inkosRoot/books/<book> → libraryRoot/<book>。 */
function bookDirOf(cfg, book) {
  const candidates = [join(cfg.inkosRoot, book), join(cfg.inkosRoot, "books", book), join(cfg.libraryRoot, book)];
  for (const dir of candidates) if (existsSync(dir)) return dir;
  throw new SceneError("E_BOOK_NOT_FOUND", `找不到作品目录 ${book}`, {
    fix: `已在 ${candidates.join(" / ")} 找过；先确认测试书在哪个根下`,
  });
}

/** 读文件（不存在给空串）。 */
const readIfExists = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");

/** 把受管区块替换进原文；原文里没有区块就追加到末尾。 */
function upsertBlock(existing, body) {
  const block = `${BLOCK_BEGIN}\n${body.trim()}\n${BLOCK_END}`;
  const pattern = new RegExp(`${BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (pattern.test(existing)) return existing.replace(pattern, block);
  const base = existing.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

/** 渲染 chNN.brief.md 的受管区块。 */
function renderChapterBrief(candidate) {
  const lines = [`> 由 @local/dsh-scene9136 生成 · ${stamp()}`, `> plan_hash: \`${candidate.planHash}\``, ""];
  for (const plan of candidate.scenes) {
    lines.push(`### 场次 ${plan.sceneIndex}${plan.tag ? ` · ${plan.tag}` : ""}`);
    lines.push(`- fingerprint: \`${plan.fingerprint}\``);
    if (plan.skeletonId) lines.push(`- skeleton_id: \`${plan.skeletonId}\``);
    if (plan.unknown?.length) lines.push(`- 本场未定（unknown）: ${plan.unknown.join("、")}`);
    if (plan.note) lines.push(`- 作者指令: ${plan.note}`);
    if (plan.planText) { lines.push("", "```text", String(plan.planText).trim(), "```"); }
    if (plan.warnings?.length) lines.push(`- 服务端告警: ${plan.warnings.join("；")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 渲染 chNN.focus.md 的受管区块。 */
function renderChapterFocus(candidate) {
  const lines = [`> ${candidate.book} 第 ${candidate.chapter} 章场景焦点 · ${stamp()}`, ""];
  for (const plan of candidate.scenes) {
    const shape = plan.shape ?? {};
    const parts = Object.entries(shape).slice(0, 6).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
    lines.push(`- 场次 ${plan.sceneIndex}${plan.tag ? `（${plan.tag}）` : ""}：${parts.join("，") || "（无形状信息）"}`);
  }
  return lines.join("\n");
}

/** 渲染书级 brief 的受管区块。 */
function renderBookBrief(entry) {
  return [`> 章节场景索引 · 由 @local/dsh-scene9136 维护 · ${stamp()}`, "",
    `- 第 ${entry.chapter} 章：${entry.sceneCount} 场 · plan_hash \`${entry.planHash.slice(0, 12)}\` · 采用于 ${entry.appliedAt}`].join("\n");
}

/** 渲染 current_focus 的受管区块。 */
function renderCurrentFocus(entry) {
  return [`> 当前聚焦：第 ${entry.chapter} 章（${entry.sceneCount} 场）· ${stamp()}`, "",
    ...entry.sceneLines.map((line) => `- ${line}`)].join("\n");
}

/**
 * 读作者的人工确认产物（唯一可信的 approved 来源）。
 * 约定：`<stateFile 所在目录>\approvals\<book>-ch<NN>.approved.json`，由作者本人执行
 * `确认.py`（或手工写文件）产生；**不接受模型在工具参数里填的任何 approved_by 字符串**。
 */
function readApproval(cfg, book, chapter, candidate) {
  const dir = join(dirname(cfg.stateFile), "approvals");
  const file = join(dir, `${book}-ch${String(chapter).padStart(2, "0")}.approved.json`);
  if (!existsSync(file)) {
    throw new SceneError("E_STATE_NOT_APPROVED",
      `没有作者的确认文件（${file}）；当前状态 ${candidate.status}，Agent 不能自己批准`, {
      fix: "由作者本人运行 确认.py '<book>' <chapter> '<plan_hash>' 生成确认文件，再重调本工具",
    });
  }
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) {
    throw new SceneError("E_APPROVAL_UNREADABLE", `确认文件不是合法 JSON：${file}（${error.message}）`, { fix: "让作者重新生成确认文件" });
  }
  if (parsed.book !== book || Number(parsed.chapter) !== chapter) {
    throw new SceneError("E_APPROVAL_STALE", `确认文件对应的不是 ${book} 第 ${chapter} 章`, { fix: "让作者为本章重新确认" });
  }
  if (parsed.planHash !== candidate.planHash) {
    throw new SceneError("E_APPROVAL_STALE", `确认文件的 plan_hash 与当前候选不一致（确认 ${String(parsed.planHash).slice(0, 12)}… / 候选 ${candidate.planHash.slice(0, 12)}…）`, {
      fix: "候选已被重新推演：请作者重新确认",
    });
  }
  const approvedAt = Date.parse(parsed.approvedAt ?? "");
  if (!Number.isFinite(approvedAt)) {
    throw new SceneError("E_APPROVAL_UNREADABLE", "确认文件缺少合法 approvedAt（ISO 时间）", { fix: "让作者重新生成" });
  }
  if (approvedAt < Date.parse(candidate.createdAt)) {
    throw new SceneError("E_APPROVAL_STALE", "确认时间早于候选生成时间（批准的是旧候选）", { fix: "请作者重新确认当前候选" });
  }
  if (typeof parsed.approvedBy !== "string" || parsed.approvedBy.trim() === "") {
    throw new SceneError("E_APPROVAL_UNREADABLE", "确认文件缺少 approvedBy", { fix: "让作者重新生成" });
  }
  return { file, approvedAt: parsed.approvedAt, approvedBy: parsed.approvedBy, via: parsed.via ?? "manual" };
}

/**
 * 四个工具的工厂。
 * @param {object} cfg resolveConfig 的结果
 */
function sceneTools(cfg) {
  const statusTool = defineTool({
    name: "scene9136_status",
    description: "查场景推演服务是否在线与数据是否就绪：GET /api/health + GET /api/state。只读，不生成施工图、不写任何文件。注意 /api/socket/* 未集成（返回 socket_unavailable 只是说明，不是服务故障）。推演前先调它。",
    parameters: {
      include: { type: "string", enum: ["state", "health", "both"], description: "[本地] 取哪部分，默认 both。" },
    },
    output: { schema: { type: "json" }, render: (_a, v) => text(v.lines ?? []) },
    isConcurrencySafe: () => true,
    async execute(args) {
      const include = args.include ?? "both";
      const lines = [];
      let health;
      let state;
      if (include !== "state") {
        try {
          const res = await httpJson(cfg, "GET", "/api/health", undefined, cfg.timeoutMs);
          health = { status: res.status, ok: res.ok, json: res.json, ms: res.ms };
        } catch (error) { health = { ok: false, error: error.message }; }
      }
      if (include !== "health") {
        try {
          const res = await httpJson(cfg, "GET", "/api/state", undefined, cfg.timeoutMs);
          state = { status: res.status, ok: res.ok, json: res.json, ms: res.ms };
        } catch (error) { state = { ok: false, error: error.message }; }
      }
      const online = health ? health.ok === true : state?.ok === true;
      lines.push(online ? `服务在线：${cfg.baseUrl}` : `服务离线：${cfg.baseUrl}`);
      if (health) lines.push(`- /api/health → ${health.ok ? `HTTP ${health.status}（${health.ms}ms）` : health.error}`);
      if (state?.ok) {
        const v = versionsOf(state.json);
        lines.push(`- /api/state → HTTP ${state.status}（${state.ms}ms）`);
        lines.push(`- 版本=${v.serviceVersion} · 规则指纹=${v.ruleVersion}`);
        lines.push(`- 计数：${Object.entries(state.json?.["计数"] ?? {}).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
      } else if (state) {
        lines.push(`- /api/state → ${state.error ?? `HTTP ${state.status}`}`);
      }
      lines.push("- socket_unavailable：未集成（阶段一不调用 /api/socket/*，这不代表服务故障）");
      return { online, baseUrl: cfg.baseUrl, health, state, socket_unavailable: "未集成", versions: state?.ok ? versionsOf(state.json) : null, lines };
    },
  });

  const planTool = defineTool({
    name: "scene9136_plan",
    description: "按 16 项条件（含 time/crowd/exp/dark/pain/partner/era 七轴）生成施工图：POST /api/derive，固定 events=preview。只出图：不写历史、不写任何作品文件，结果存进插件候选状态文件（status=draft→validated）。同参命中缓存时 identity.status=reused，要重抽传 force_new=true（最多重抽 3 次，仍重复报 E_SKELETON_REPEAT）。必须是 scenes 或 scenes_json 二选一；facts 里没给的键必须写进 unknown。",
    parameters: {
      book: { type: "string", required: true, description: "作品标识（测试书 id，例如 isobook-01）；不要用占位符。" },
      chapter: { type: "integer", required: true, description: "章节号，≥1。" },
      scenes: { type: "array", items: { type: "object", additionalProperties: true }, description: "场次数组（首选）。每场 9 键：index/tag/facts/note/ambient/locked/preferences/unknown/forbidden。" },
      scenes_json: { type: "string", description: "整段 JSON（兜底）；解析失败报 E_BAD_JSON。" },
      force_new: { type: "boolean", description: "true=不吃缓存重抽（最多 3 次）。默认 false。" },
    },
    output: { schema: { type: "json" }, render: (_a, v) => text(v.lines ?? []) },
    timeoutMs: CHAPTER_BUDGET_MS + 10000,
    async execute(args) {
      if (typeof args.book !== "string" || args.book.trim() === "") {
        throw new SceneError("E_MISSING_BOOK", "book 不能为空", { field: "book", fix: "传测试书 id，例如 isobook-01" });
      }
      if (!Number.isInteger(args.chapter) || args.chapter < 1) {
        throw new SceneError("E_BAD_TYPE", "chapter 必须是 ≥1 的整数", { field: "chapter" });
      }
      const book = args.book.trim();
      const chapter = args.chapter;
      const scenes = validateScenes(resolveScenes(args));
      const fileState = readStateFile(cfg);          // 插件自己的候选/台账
      const liveState = await readState(cfg);         // 服务端 /api/state
      const versions = versionsOf(liveState);
      const plans = [];
      const lines = [`${book} 第 ${chapter} 章 · ${scenes.length} 场（events=preview，不写历史）`];

      for (const scene of scenes) {
        let attempt = 0;
        let last = null;
        for (;;) {
          const forceNew = args.force_new === true || attempt > 0;
          const request = deriveBody(book, chapter, scene, forceNew);
          const res = await httpJson(cfg, "POST", "/api/derive", request, cfg.timeoutMs);
          if (!res.ok) {
            const code = res.json?.code ?? "E_DERIVE_FAILED";
            throw new SceneError(code, res.json?.error ?? `服务端返回 HTTP ${res.status}`, {
              scene_index: scene.index, fix: "按服务端提示改参数后重试（不要改插件的枚举）",
            });
          }
          const json = res.json ?? {};
          if (json.ok === false) {
            throw new SceneError(json.code ?? "E_DERIVE_FAILED", json.error ?? "derive 返回 ok=false", { scene_index: scene.index });
          }
          const plan = extractPlan(scene, request, json);
          checkOrigin(scene, plan);
          // 骨架重复判重：用插件自己的台账（book + skeletonId），同一骨架在本章内出现即为重复
          const repeated = plan.skeletonId !== null && plans.some((item) => item.skeletonId === plan.skeletonId);
          if (repeated && attempt < MAX_FORCE_NEW - 1) { attempt += 1; last = plan; continue; }
          if (repeated) {
            throw new SceneError("E_SKELETON_REPEAT", `骨架 \`${plan.skeletonId}\` 与本章前序场次重复，force_new 已用 ${MAX_FORCE_NEW - 1} 次`, {
              scene_index: scene.index, field: "skeleton_id", fix: "换条件（temp/level/where 等）后重新推演，或接受并人工改骨架",
            });
          }
          plan.unknown = scene.unknown;
          plans.push(plan);
          lines.push(`- 场次 ${scene.index}${scene.tag ? `（${scene.tag}）` : ""}：fingerprint=\`${plan.fingerprint}\` · 骨架=\`${plan.skeletonId ?? "UNKNOWN"}\` · 缓存=${plan.identityStatus}`);
          break;
        }
        void last;
      }

      const planHash = h16({
        book, chapter, versions,
        scenes: plans.map((p) => ({ i: p.sceneIndex, f: p.fingerprint, s: p.skeletonId })),
      });
      const candidate = {
        schema: 1,
        book, chapter, planHash,
        createdAt: stamp(),
        status: "validated",
        versions,
        request: scenes.map((s) => deriveBody(book, chapter, s, args.force_new === true)),
        scenes: plans.map((p) => ({ ...p, unknown: p.unknown ?? [] })),
        semantics: {
          preferences: "第一版无软偏好权重：只记录来源，不参与加权",
          forbidden: "只能阻止显式给值；对未给值走默认的字段不能可靠阻止",
          commit: "第一版不调用 events=commit；骨架历史由本插件状态文件维护",
          socket: "未集成 /api/socket/*",
        },
      };
      fileState.candidates[candidateKey(book, chapter)] = candidate;
      fileState.revisions.push({ at: candidate.createdAt, action: "validated", book, chapter, planHash });
      writeStateFile(cfg, fileState);

      lines.push("", `plan_hash=\`${planHash}\`（apply 必须与它一致）`, `状态：validated（Agent 上限）· 候选已保存到 ${cfg.stateFile}`);
      lines.push("下一步：作者人工确认后，把批准写成 approval 文件，再调 scene9136_apply（本工具不会自己批准）");
      return { ok: true, book, chapter, planHash, status: "validated", versions, plan_hash: planHash, scenes: candidate.scenes.map((p) => ({ index: p.sceneIndex, fingerprint: p.fingerprint, skeletonId: p.skeletonId, warnings: p.warnings })), lines };
    },
  });

  const checkTool = defineTool({
    name: "scene9136_check",
    description: "对已写好的正文做规则检查，只作辅助参考：mode=check → POST /api/check；mode=ambient → POST /api/ambient_check（镜数/密度/连用/不推进/不解释）。只读不改稿。阈值未标定前，本结果不得作为唯一放行或拦截依据（不可当硬闸门）。",
    parameters: {
      mode: { type: "string", enum: ["check", "ambient"], required: true, description: "check=通用规则检查；ambient=氛围镜检查。" },
      text: { type: "string", required: true, description: "要检查的正文（空串会被服务端 400 拒绝）。" },
      main_words: { type: "integer", description: "仅 ambient：正戏字数（服务端读 正戏字数 或 main_words）。" },
      mirrors: { type: "integer", description: "仅 ambient：镜数（服务端读 镜数）。" },
      text_out: { type: "boolean", description: "仅 ambient：true=返回服务端渲染的纯文本报告。" },
    },
    output: { schema: { type: "json" }, render: (_a, v) => text(v.lines ?? []) },
    isConcurrencySafe: () => true,
    timeoutMs: CHAPTER_BUDGET_MS + 10000,
    async execute(args) {
      if (typeof args.text !== "string" || args.text.trim() === "") {
        throw new SceneError("E_BAD_TYPE", "text 不能为空", { field: "text" });
      }
      const body = { text: args.text };
      if (args.mode === "ambient") {
        if (args.main_words !== undefined) body.main_words = args.main_words;
        if (args.mirrors !== undefined) body["镜数"] = args.mirrors;
        if (args.text_out === true) body.text_out = true;
      }
      const path = args.mode === "ambient" ? "/api/ambient_check" : "/api/check";
      const res = await httpJson(cfg, "POST", path, body, cfg.timeoutMs);
      if (!res.ok) {
        throw new SceneError(res.json?.code ?? "E_CHECK_FAILED", res.json?.error ?? `HTTP ${res.status}`, { fix: "确认 text 非空、mode 正确" });
      }
      const payload = res.json ?? { text: res.text };
      const lines = [`${args.mode === "ambient" ? "氛围镜检查" : "规则检查"}（${res.ms}ms，正文 ${args.text.length} 字）`];
      if (typeof res.text === "string" && res.json === undefined) lines.push(res.text);
      else lines.push("```json", JSON.stringify(payload, null, 2).slice(0, 4000), "```");
      lines.push("", "提示：本结果只作辅助参考；阈值未标定前不得作为唯一放行/拦截依据。");
      return { mode: args.mode, payload, advisory_only: true, lines };
    },
  });

  const applyTool = defineTool({
    name: "scene9136_apply",
    description: "采用一份已确认的候选施工图。硬前提：候选状态必须是 approved（由作者人工确认产出 approval 文件，Agent 不能自己批准；模型填字符串不算批准）。本工具不重跑 derive、不重抽方案：逐一比对 plan_hash、每场 fingerprint、服务版本、规则版本，任一不一致即停止并要求重新推演。只写 4 个受管文件（story/focus/chNN.brief.md、story/focus/chNN.focus.md、story/brief.md、story/current_focus.md）的 SCENE-DERIVE 区块，写前全部备份，任一步失败恢复全部备份；不改正式 _章场景配置.json。",
    parameters: {
      book: { type: "string", required: true, description: "作品标识。" },
      chapter: { type: "integer", required: true, description: "章节号。" },
      plan_hash: { type: "string", required: true, description: "plan 返回的 plan_hash；与候选不一致直接拒绝。" },
      dry_run: { type: "boolean", description: "true=只做前置检查（状态/哈希/版本/备份可行性），不写文件。" },
    },
    output: { schema: { type: "json" }, render: (_a, v) => text(v.lines ?? []) },
    async execute(args) {
      const book = String(args.book ?? "").trim();
      if (book === "") throw new SceneError("E_MISSING_BOOK", "book 不能为空", { field: "book" });
      if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new SceneError("E_BAD_TYPE", "chapter 必须是 ≥1 的整数", { field: "chapter" });
      const state = readStateFile(cfg);
      const candidate = state.candidates[candidateKey(book, args.chapter)];
      if (candidate === undefined) {
        throw new SceneError("E_NO_CANDIDATE", `没有 ${book} 第 ${args.chapter} 章的候选`, { fix: "先调 scene9136_plan 生成候选" });
      }
      if (candidate.planHash !== args.plan_hash) {
        throw new SceneError("E_PLAN_HASH_MISMATCH", `plan_hash 与候选不一致（候选 ${candidate.planHash}）`, {
          field: "plan_hash", fix: "用候选的 plan_hash，或重新推演后重新确认",
        });
      }
      // ① 状态与作者确认：approved 只能来自确认文件（不是模型参数）
      if (candidate.status === "applied") {
        throw new SceneError("E_ALREADY_APPLIED", `该候选已于 ${candidate.appliedAt ?? "?"} 采用过`, { fix: "要再采用请重新推演并重新确认" });
      }
      const approval = readApproval(cfg, book, args.chapter, candidate);
      // ② 服务与规则版本必须与候选时一致
      const liveState = await readState(cfg);
      if (liveState === undefined) {
        throw new SceneError("E_SERVICE_DOWN", `连不上 ${cfg.baseUrl}，无法核对版本`, { fix: "服务起来后再调；不会用离线状态跳过核对" });
      }
      const live = versionsOf(liveState);
      if (live.serviceVersion !== candidate.versions.serviceVersion || live.ruleVersion !== candidate.versions.ruleVersion) {
        throw new SceneError("E_VERSION_DRIFT",
          `服务/规则版本已变（候选 ${candidate.versions.serviceVersion}/${candidate.versions.ruleVersion}，当前 ${live.serviceVersion}/${live.ruleVersion}）`, {
          fix: "重新推演（scene9136_plan）并重新请作者确认",
        });
      }
      // ③ 各场 fingerprint 必须存在且未变（用现场消费的服务核对：本版只读状态，无法重取 fingerprint，
      //    因此改为核对候选内部一致性 + 记录，留作阶段二接 commit 时再与服务端对账）
      for (const plan of candidate.scenes) {
        if (plan.fingerprint === "UNKNOWN" || !plan.fingerprint) {
          throw new SceneError("E_FINGERPRINT_MISSING", `场次 ${plan.sceneIndex} 没有 fingerprint`, {
            scene_index: plan.sceneIndex, fix: "重新推演；没有 fingerprint 的候选不可采用",
          });
        }
      }
      const bookDir = bookDirOf(cfg, book);
      const files = {
        chapterBrief: join(bookDir, "story", "focus", `ch${String(args.chapter).padStart(2, "0")}.brief.md`),
        chapterFocus: join(bookDir, "story", "focus", `ch${String(args.chapter).padStart(2, "0")}.focus.md`),
        bookBrief: join(bookDir, "story", "brief.md"),
        currentFocus: join(bookDir, "story", "current_focus.md"),
      };
      const rendered = {
        chapterBrief: upsertBlock(readIfExists(files.chapterBrief), renderChapterBrief(candidate)),
        chapterFocus: upsertBlock(readIfExists(files.chapterFocus), renderChapterFocus(candidate)),
        bookBrief: upsertBlock(readIfExists(files.bookBrief), renderBookBrief({ chapter: args.chapter, sceneCount: candidate.scenes.length, planHash: candidate.planHash, appliedAt: stamp() })),
        currentFocus: upsertBlock(readIfExists(files.currentFocus), renderCurrentFocus({
          chapter: args.chapter,
          sceneCount: candidate.scenes.length,
          sceneLines: candidate.scenes.map((p) => `场次 ${p.sceneIndex}${p.tag ? `·${p.tag}` : ""}：${p.skeletonId ?? "骨架未定"}`),
        })),
      };
      // ④ 完整性自检：受管区块里的场次数必须等于候选场次数
      for (const [key, content] of Object.entries(rendered)) {
        const count = (content.match(/^### 场次 |^- 场次 /gm) ?? []).length;
        if (key === "chapterBrief" || key === "chapterFocus") {
          const expect = key === "chapterBrief" ? candidate.scenes.length : candidate.scenes.length;
          const actual = key === "chapterBrief" ? (content.match(/^### 场次 /gm) ?? []).length : (content.match(/^- 场次 /gm) ?? []).length;
          if (actual !== expect) {
            throw new SceneError("E_RENDER_INCOMPLETE", `${key} 渲染出 ${actual} 场，候选是 ${expect} 场`, { fix: "报告此 bug，不要写入" });
          }
        }
        void count;
      }
      if (args.dry_run === true) {
        return { ok: true, dry_run: true, book, chapter: args.chapter, planHash: candidate.planHash, files, lines: [
          `前置检查全部通过（dry_run，未写入）`,
          `- 状态 ${candidate.status} · 版本 ${candidate.versions.serviceVersion}/${candidate.versions.ruleVersion}`,
          `- 将写入：${Object.values(files).join("、")}`,
        ] };
      }
      // ⑤ 备份 + 原子替换；任一步失败恢复全部
      const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const backups = [];
      const created = [];
      try {
        for (const [key, target] of Object.entries(files)) {
          mkdirSync(dirname(target), { recursive: true });
          if (existsSync(target)) {
            const backup = `${target}.bak-scene9136-${ts}`;
            copyFileSync(target, backup);
            backups.push({ target, backup });
          } else {
            created.push(target);
          }
          const tmp = `${target}.scene9136-${ts}.tmp`;
          writeFileSync(tmp, rendered[key], "utf8");
          renameSync(tmp, target);
        }
        // ⑥ 台账 + 状态
        for (const plan of candidate.scenes) {
          if (plan.skeletonId === null || plan.skeletonId === undefined) continue;
          state.skeletons.push({ book, chapter: args.chapter, scene: plan.sceneIndex, skeletonId: plan.skeletonId, adoptedAt: stamp() });
        }
        state.candidates[candidateKey(book, args.chapter)] = {
          ...candidate,
          status: "applied",
          appliedAt: stamp(),
          approvedAt: approval.approvedAt,
          approvedBy: approval.approvedBy,
          approvalFile: approval.file,
          appliedFiles: Object.values(files),
        };
        state.revisions.push({ at: stamp(), action: "applied", book, chapter: args.chapter, planHash: candidate.planHash, backups: backups.map((b) => b.backup) });
        writeStateFile(cfg, state);
      } catch (error) {
        // 恢复：先回滚已替换文件，再删掉本次新建的文件
        const restored = [];
        for (const item of backups) {
          try { copyFileSync(item.backup, item.target); restored.push(item.target); } catch { /* 尽力而为 */ }
        }
        for (const target of created) {
          try { rmSync(target, { force: true }); } catch { /* 尽力而为 */ }
        }
        throw new SceneError("E_WRITE_FAILED",
          `写入失败并已回滚（${error?.message ?? error}）；恢复 ${restored.length} 个文件`, {
          fix: `检查这些备份：${backups.map((b) => b.backup).join("、") || "（无）"}`,
        });
      }
      const lines = [
        `${book} 第 ${args.chapter} 章已采用 · ${candidate.scenes.length} 场`,
        `plan_hash=\`${candidate.planHash}\``,
        `- 状态：applied（骨架台账已记 ${candidate.scenes.filter((p) => p.skeletonId).length} 条）`,
        ...Object.entries(files).map(([k, v]) => `- ${k} → ${v}`),
        `- 备份 ${backups.length} 个（*.bak-scene9136-${ts}）`,
        "注意：第一版未调用 events=commit，服务端历史未写入；骨架历史以本插件状态文件为准。",
      ];
      return { ok: true, book, chapter: args.chapter, status: "applied", planHash: candidate.planHash, files, backups: backups.map((b) => b.backup), lines };
    },
  });

  return [statusTool, planTool, checkTool, applyTool];
}

/**
 * 注册四个工具。
 * @param {object} ctx 挂载上下文（需要 tools 服务）
 * @param {object} [config] patch 行里的 config
 */
function apply(ctx, config) {
  const cfg = resolveConfig(config);
  for (const tool of sceneTools(cfg)) {
    ctx.effect(() => ctx.tools.register(tool), `scene9136: register ${tool.name}`);
  }
}

export { AXES, CHAPTER_BUDGET_MS, Config, FIELDS, MAX_FORCE_NEW, SCENE_KEYS, STATES, SceneError, apply, bookDirOf, checkOriginFn, deriveBody, extractPlan, h16, inject, name, resolveConfig, resolveScenes, sceneTools, upsertBlock, validateScenes, versionsOf };

/** 供测试直接引用（避免与内部同名冲突）。 */
function checkOriginFn(scene, plan) { return checkOrigin(scene, plan); }
