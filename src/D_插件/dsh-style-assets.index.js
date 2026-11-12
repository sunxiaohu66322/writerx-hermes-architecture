/**
 * @local/dsh-style-assets — 文风资产库存储底座（阶段一：存储 + 外部文件导入）
 *
 * 三层：
 *   analyses/    原始拆书档案（只进不改，任何修正走新 analysisId）
 *   candidates/  归一化候选（待作者确认；合并/拆分/覆盖/发布绝不自动执行）
 *   styles/      正式文风资产（发布版本快照不可变；归档状态只写 meta.json）
 *
 * 统一数据契约：外部 ChatGPT 与本地 API 共用同一份标准 JSON Schema；
 * analysisId / candidateId / styleId 全部为全局唯一 UUID。
 * 不把整本小说原文复制进库：只存来源信息、章节位置与简短证据摘句。
 *
 * 阶段一范围：目录与 registry、原子写、版本防覆盖、inbox 导入校验查重、整库导出与基础恢复。
 * 不含（后续阶段）：AI 拆书、文风融合界面、写作注入链、DSH 工具注册。
 *
 * 数据根：正式 = dshHomePath("writerx-style-assets")（优先用真实接口；
 *         测试一律 openStore({ dataRoot }) 显式注入独立临时目录，绝不误写真实 DSH_HOME）。
 *
 * @module @local/dsh-style-assets
 */
import { mkdir, readFile, writeFile, rename, rm, readdir, copyFile, cp } from "node:fs/promises";
import { constants as FS, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** 数据根目录名（dshHomePath 的最后一段）。 */
export const ASSETS_DIR_NAME = "writerx-style-assets";
/** 数据契约版本。 */
export const SCHEMA_VERSION = 1;
/** 初始化建出的顶层目录。 */
export const TOP_DIRS = ["schema", "inbox/analysis", "inbox/reports", "analyses", "reports", "candidates", "styles", "methods", "adult", "adult-maps", "packages", "docs", "trash"];
/**
 * 档案 Markdown 里固定节的键与标题对应（features 键 → 中文节名）。
 * 顺序即渲染顺序；作者改节名也能认，认不出的节原样留在 MD 里，不丢。
 */
export const DOC_FEATURE_LABELS = {
	overall: "整体语感",
	sentence: "句式",
	paragraph: "段落",
	dialogue: "对话",
	psychology: "心理",
	environment: "环境",
	narration: "叙事",
	rhythm: "节奏",
	perspective: "视角",
	preference: "偏好",
	forbidden: "禁用",
};
/**
 * 特征值是对象时，里层这些键换成中文小标题，其余键原样用。
 * 拆书模板产出的结构就是 observation / mechanism / transferableMethods / conditionsAndLimits 这四项。
 */
export const DOC_SUBKEY_LABELS = {
	observation: "观察",
	mechanism: "机制",
	transferableMethods: "可迁移写法",
	conditionsAndLimits: "适用与限制",
	examples: "示例",
	signals: "识别信号",
	presence: "出现位置",
	structure: "结构",
	effect: "效果",
};
/** 方法资产库自身的结构版本（methods 层新于首版契约，独立演进）。 */
export const METHODS_SCHEMA_VERSION = 1;
/** 成人向场面资产库的结构版本。 */
export const ADULT_SCHEMA_VERSION = 1;
/** 成人场景地图的结构版本。 */
export const ADULT_MAP_SCHEMA_VERSION = 1;
/** 成品包协议版本。 */
export const PACKAGE_SCHEMA_VERSION = 1;
/** 方法资产的可管理维度（与方法库 UI 的筛选一致）。 */
export const METHOD_DIMENSIONS = [
	"故事结构", "开篇钩子", "人物动机", "人物成长弧线", "人物关系", "冲突递进",
	"爽点设计", "情绪循环", "悬念与伏笔", "场景推进", "章节留存", "世界观构建",
];
/**
 * 成人向场面资产的可管理维度（成人向专项拆解的 14 项）。
 * 12 项结构维度（外部 ChatGPT 也能出）+ 两项血肉维度（只由本地无约束模型出）。
 * 与 {@link METHOD_DIMENSIONS} 刻意分开：这一层单独入库、单独查看，
 * 不参与文风候选的发布链，拆来的成人场面写法不会被顺手带进别的书的正式文风。
 */
export const ADULT_DIMENSIONS = [
	"场面功能", "进入条件", "推进阶梯", "张力曲线", "节奏与镜数", "视角与知情",
	"对话与声音", "物件与空间", "感官配比", "关系与权力变化", "禁忌与边界", "章末接口",
	"血肉词汇", "镜头写法",
];
/** 血肉层专用维度：只有本地无约束模型能产出，外部通道一律不碰。 */
export const ADULT_FLESH_DIMENSIONS = ["血肉词汇", "镜头写法"];
/** 词表类别（血肉词汇按这些格分，便于写作时按需取用）。 */
export const ADULT_LEXICON_CATEGORIES = [
	"身体部位", "动作", "声音", "体液与温度", "衣物与阻隔", "呼吸与节奏", "心理与生理反应", "程度与强度",
];
/** 感官配比里的五条通道（键固定，值填该通道的占比与承载方式）。 */
export const ADULT_SENSES = ["touch", "temperature", "sound", "smell", "sight"];
/** 三份标准 Schema 文件名（随库复制到 <root>/schema/）。 */
export const SCHEMA_FILES = ["analysis.schema.json", "candidate.schema.json", "style-profile.schema.json", "method-asset.schema.json", "adult-scene.schema.json", "adult-scene-map.schema.json"];
/** 场景类型码：中文/英文/短码统一折成短码 + 中文名。 */
export const SCENE_TYPE_MAP = {
	E: { code: "E", name: "主体场景" },
	A: { code: "A", name: "氛围镜头" },
	P: { code: "P", name: "前置铺垫" },
	R: { code: "R", name: "事后余韵" },
	main_scene: { code: "E", name: "主体场景" },
	ambient_mirror: { code: "A", name: "氛围镜头" },
	setup: { code: "P", name: "前置铺垫" },
	afterglow: { code: "R", name: "事后余韵" },
};
/** 年龄未确认的片段只能进待审核；未成年人片段不得生成成人向资产。 */
export const ADULT_AGE_BLOCKING = ["minor"];
const REGISTRY_FILE = "registry.json";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VERSION_RE = /^V\d+\.\d+$/u;
const STYLE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** 结构化错误：消息本体带编码、细节与修法。 */
export class StoreError extends Error {
	constructor(code, detail, fix) {
		super(`${code}：${detail}${fix ? `（修法：${fix}）` : ""}`);
		this.name = "StoreError";
		this.code = code;
		this.detail = detail;
	}
}

const stamp = () => new Date().toISOString();

/** 生成全局唯一 UUID（analysisId / candidateId / styleId / assetId 统一用它）。 */
export const newId = () => randomUUID();

/** registry 里 method 资产的条目形状（内部约定，随 registry 演进）。 */
const METHOD_ENTRY_KEYS = ["id", "dimension", "title", "source", "status", "version", "createdAt", "updatedAt"];

export const sha256File = async (file) =>
	createHash("sha256").update(await readFile(file)).digest("hex");

// ---------------------------------------------------------------------------
// 最小 JSON Schema 校验器：只支持本库 Schema 用到的关键字
// （type / const / enum / pattern / format:uuid|date-time / minLength /
//   maxLength / minimum / maximum / required / properties /
//   additionalProperties / items / minItems / maxItems / uniqueItems）
// ---------------------------------------------------------------------------

const typeOf = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

function typeMatches(schema, value) {
	const list = Array.isArray(schema.type) ? schema.type : [schema.type];
	const actual = typeOf(value);
	if (list.includes(actual)) return true;
	if (list.includes("integer") && actual === "number" && Number.isInteger(value)) return true;
	return false;
}

function validateNode(schema, value, at, problems) {
	if (schema === undefined || schema === true) return;
	if (schema === false) {
		problems.push(`${at}: 不允许出现`);
		return;
	}
	if (schema.type !== undefined && !typeMatches(schema, value)) {
		problems.push(`${at}: 类型应为 ${Array.isArray(schema.type) ? schema.type.join("|") : schema.type}，实际 ${typeOf(value)}`);
		return;
	}
	if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
		problems.push(`${at}: 必须等于 ${JSON.stringify(schema.const)}`);
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
		problems.push(`${at}: 必须是 ${schema.enum.join("/")}`);
	}
	if (typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: 最短 ${schema.minLength} 字`);
		if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${at}: 最长 ${schema.maxLength} 字`);
		if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) problems.push(`${at}: 不匹配规则 ${schema.pattern}`);
		if (schema.format === "uuid" && !UUID_RE.test(value)) problems.push(`${at}: 不是合法 UUID`);
		if (schema.format === "date-time" && !DATETIME_RE.test(value)) problems.push(`${at}: 不是 ISO 日期时间`);
	}
	if (typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: 不得小于 ${schema.minimum}`);
		if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: 不得大于 ${schema.maximum}`);
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at}: 至少 ${schema.minItems} 项`);
		if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at}: 至多 ${schema.maxItems} 项`);
		if (schema.uniqueItems) {
			const seen = new Set(value.map((item) => JSON.stringify(item)));
			if (seen.size !== value.length) problems.push(`${at}: 存在重复项`);
		}
		if (schema.items !== undefined) value.forEach((item, index) => validateNode(schema.items, item, `${at}[${index}]`, problems));
	}
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		for (const key of schema.required ?? []) {
			if (!(key in value)) problems.push(`${at}: 缺少必需字段 ${key}`);
		}
		const properties = schema.properties ?? {};
		for (const [key, child] of Object.entries(value)) {
			if (properties[key] !== undefined) validateNode(properties[key], child, `${at}.${key}`, problems);
			else if (schema.additionalProperties === false) problems.push(`${at}: 不认识字段 ${key}`);
			else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
				validateNode(schema.additionalProperties, child, `${at}.${key}`, problems);
			}
		}
	}
}

/** 按标准 Schema 校验，返回问题清单（空数组 = 通过）。 */
export function validateAgainstSchema(schema, value) {
	const problems = [];
	validateNode(schema, value, "$", problems);
	return problems;
}

// ---------------------------------------------------------------------------
// 数据根解析：优先真实 dshHomePath，回退按已核实的同一规则（显式 > $DSH_HOME > ~/.dsh）
// ---------------------------------------------------------------------------

export async function defaultDataRoot() {
	try {
		const mod = await import("@deepseek-ai/dsh-home-paths");
		if (typeof mod.dshHomePath === "function") return mod.dshHomePath(ASSETS_DIR_NAME);
	} catch {
		// 单独跑测试或依赖不可达时走同规则回退
	}
	const fromEnv = process.env.DSH_HOME;
	const home = typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv.trim() : join(homedir(), ".dsh");
	return join(home, ASSETS_DIR_NAME);
}

// ---------------------------------------------------------------------------

function nextMinor(version) {
	const match = /^V(\d+)\.(\d+)$/u.exec(version ?? "");
	if (!match) throw new StoreError("E_INVALID_VERSION", `版本号不合法：${version}`, "形如 V1.0");
	return `V${match[1]}.${Number(match[2]) + 1}`;
}

function deepMerge(base, patch) {
	if (patch === undefined) return base;
	if (base === null || typeof base !== "object" || Array.isArray(base) || typeof patch !== "object" || Array.isArray(patch) || patch === null) {
		return patch;
	}
	const out = { ...base };
	for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value);
	return out;
}

// ---------------------------------------------------------------------------

export async function openStore(options = {}) {
	const dataRoot = options.dataRoot ?? (typeof options.dshHomePath === "function" ? options.dshHomePath(ASSETS_DIR_NAME) : await defaultDataRoot());
	const root = resolve(dataRoot);
	const schemas = {};
	for (const name of SCHEMA_FILES) {
		schemas[name.replace(".schema.json", "")] = JSON.parse(await readFile(join(MODULE_DIR, "schema", name), "utf8"));
	}
	return new StyleAssetStore(root, schemas);
}

class StyleAssetStore {
	#root;
	#schemas;

	constructor(root, schemas) {
		this.#root = root;
		this.#schemas = schemas;
	}

	get root() {
		return this.#root;
	}

	// ---- 路径 ----
	#p(...segments) {
		return join(this.#root, ...segments);
	}
	#registryPath() {
		return this.#p(REGISTRY_FILE);
	}

	// ---- 原子写 ----
	async #tmpPath(file) {
		return join(dirname2(file), `.${basename2(file)}.${randomUUID()}.tmp`);
	}
	async #atomicWriteJson(file, value) {
		const tmp = await this.#tmpPath(file);
		await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		await rename(tmp, file);
	}
	async #atomicWriteText(file, text) {
		const tmp = await this.#tmpPath(file);
		await writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
		await rename(tmp, file);
	}
	/** 防覆盖写：目标已存在即拒绝（COPYFILE_EXCL），旧文件一个字节都不动。 */
	async #writeJsonIfAbsent(file, value, code = "E_ALREADY_EXISTS", fix = "换 ID 或走版本递增") {
		const tmp = await this.#tmpPath(file);
		await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		try {
			await copyFile(tmp, file, FS.COPYFILE_EXCL);
		} catch (error) {
			await rm(tmp, { force: true });
			if (error.code === "EEXIST") throw new StoreError(code, `目标已存在，不覆盖：${file}`, fix);
			throw error;
		}
		await rm(tmp, { force: true });
	}

	// ---- registry ----
	#emptyRegistry() {
		return {
			schemaVersion: SCHEMA_VERSION,
			createdAt: stamp(),
			updatedAt: stamp(),
			counts: { analyses: 0, candidates: 0, styles: 0, methods: 0, adult: 0, adultMaps: 0, customDocs: 0 },
			analyses: [],
			candidates: [],
			styles: [],
			methods: [],
			adult: [],
			adultMaps: [],
			customDocs: [],
		};
	}
	async readRegistry() {
		try {
			const registry = JSON.parse(await readFile(this.#registryPath(), "utf8"));
			if (!Array.isArray(registry.methods)) registry.methods = [];
			if (!Array.isArray(registry.adult)) registry.adult = [];
			if (!Array.isArray(registry.adultMaps)) registry.adultMaps = [];
			if (!Array.isArray(registry.customDocs)) registry.customDocs = [];
			return registry;
		} catch (error) {
			throw new StoreError("E_REGISTRY_CORRUPT", `registry.json 读不了或不是合法 JSON：${error.message}`, "用整库导出备份恢复");
		}
	}
	async #writeRegistry(registry) {
		registry.updatedAt = stamp();
		registry.counts = {
			analyses: registry.analyses.length,
			candidates: registry.candidates.length,
			styles: registry.styles.length,
			methods: (registry.methods ?? []).length,
			adult: (registry.adult ?? []).length,
			adultMaps: (registry.adultMaps ?? []).length,
			customDocs: (registry.customDocs ?? []).length,
		};
		await this.#atomicWriteJson(this.#registryPath(), registry);
	}

	// ---- 初始化 ----
	/** 建三层目录 + 落 Schema + 建 registry；已存在的文件一律不覆盖。 */
	async init() {
		for (const dir of TOP_DIRS) await mkdir(this.#p(dir), { recursive: true });
		for (const name of SCHEMA_FILES) {
			const target = this.#p("schema", name);
			if (!existsSync(target)) await copyFile(join(MODULE_DIR, "schema", name), target);
		}
		if (!existsSync(this.#registryPath())) await this.#writeRegistry(this.#emptyRegistry());
		return { root: this.#root };
	}

	// ================================================== 第一层：原始拆书档案
	/** 直接导入一份分析对象（外部与本地同一 Schema 同一通道）。 */
	async importAnalysis(analysis, { report } = {}) {
		const problems = validateAgainstSchema(this.#schemas.analysis, analysis);
		if (problems.length > 0) {
			throw new StoreError("E_INVALID_ANALYSIS", `校验未通过：${problems.join("；")}`, "按 schema/analysis.schema.json 修正后重试");
		}
		const id = analysis.analysisId;
		const file = this.#p("analyses", `${id}.json`);
		const registry = await this.readRegistry();
		if (registry.analyses.some((item) => item.id === id) || existsSync(file)) {
			throw new StoreError("E_DUPLICATE_ANALYSIS_ID", `analysisId 已存在：${id}`, "换新的 UUID；原文件不覆盖");
		}
		await this.#writeJsonIfAbsent(file, analysis, "E_DUPLICATE_ANALYSIS_ID", "换新的 UUID；原文件不覆盖");
		let reportFile;
		if (typeof report === "string" && report.trim() !== "") {
			reportFile = this.#p("reports", `${id}.md`);
			if (!existsSync(reportFile)) await this.#atomicWriteText(reportFile, report.endsWith("\n") ? report : `${report}\n`);
		}
		registry.analyses.push({
			id,
			title: analysis.source?.title ?? "",
			channel: analysis.channel?.type ?? "",
			createdAt: analysis.createdAt ?? stamp(),
		});
		await this.#writeRegistry(registry);
		return { analysisId: id, file, reportFile };
	}

	/** inbox 导入：读 inbox/analysis/<fileName>，校验查重，落 analyses/，删 inbox 原件；失败则原文件留在 inbox。 */
	async importInboxAnalysis(fileName, { reportFile: reportName } = {}) {
		const src = this.#p("inbox", "analysis", fileName);
		let raw;
		try {
			raw = await readFile(src, "utf8");
		} catch {
			throw new StoreError("E_NOT_FOUND", `inbox/analysis 里没有 ${fileName}`, "把外部 ChatGPT 的 JSON 放进 inbox/analysis 后重试");
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new StoreError("E_BAD_JSON", `${fileName} 不是合法 JSON：${error.message}`);
		}
		let report;
		if (reportName !== undefined) {
			try {
				report = await readFile(this.#p("inbox", "reports", reportName), "utf8");
			} catch {
				throw new StoreError("E_NOT_FOUND", `inbox/reports 里没有 ${reportName}`, "把配套 MD 放进 inbox/reports 后重试");
			}
		}
		const result = await this.importAnalysis(parsed, report === undefined ? {} : { report });
		await rm(src, { force: true });
		if (reportName !== undefined) await rm(this.#p("inbox", "reports", reportName), { force: true });
		return { ...result, movedFrom: fileName, reportFrom: reportName ?? null };
	}

	async readAnalysis(id) {
		try {
			return JSON.parse(await readFile(this.#p("analyses", `${id}.json`), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `原始拆书档案不存在：${id}`);
		}
	}

	/** 读一份拆书档案的配套阅读报告（可能没有）。 */
	async readAnalysisReport(id) {
		try {
			return await readFile(this.#p("reports", `${id}.md`), "utf8");
		} catch {
			return null;
		}
	}

	// ================================================== 档案正文层（Markdown 编辑面）
	// 分工写死：
	//   analyses/<id>.json  导入产物，Schema 只进不改，留档与引擎取结构化字段用；
	//   analyses/<id>.md    拆书档的正文，人读人改，作者随便加节、随便改字；
	//   docs/<id>.md        作者自建的档案，只有正文，没有 JSON。
	// JSON 与 MD 不互相覆盖：改 MD 不动 JSON；要改结构化字段走「另存为新档案」。

	#docFile(id, kind) {
		return kind === "custom" ? this.#p("docs", `${id}.md`) : this.#p("analyses", `${id}.md`);
	}

	/** analysis JSON → Markdown 正文。固定节按 DOC_FEATURE_LABELS 排，结论/证据/样本各成一节。 */
	#analysisToMarkdown(analysis) {
		const lines = ["---"];
		lines.push(`analysisId: ${analysis.analysisId}`);
		lines.push(`title: ${analysis.source?.title ?? ""}`);
		lines.push("kind: decomposed");
		lines.push(`channel: ${analysis.channel?.type ?? ""}`);
		if (typeof analysis.channel?.model === "string" && analysis.channel.model !== "") lines.push(`model: ${analysis.channel.model}`);
		lines.push(`scope: ${analysis.scope?.kind ?? ""}`);
		lines.push(`createdAt: ${analysis.createdAt ?? ""}`);
		lines.push("---", "");
		for (const [key, label] of Object.entries(DOC_FEATURE_LABELS)) {
			const value = analysis.features?.[key];
			if (value === void 0 || value === null || value === "") continue;
			lines.push(`## ${label}`, "");
			if (typeof value === "string") lines.push(value.trim());
			else if (Array.isArray(value)) for (const item of value) lines.push(`- ${typeof item === "string" ? item : JSON.stringify(item)}`);
			else if (value !== null && typeof value === "object") {
				// 对象型特征摊成小标题，别塞一整坨 JSON——作者要在页面上改这些字
				for (const [subKey, subValue] of Object.entries(value)) {
					lines.push(`### ${DOC_SUBKEY_LABELS[subKey] ?? subKey}`, "");
					if (typeof subValue === "string") lines.push(subValue.trim());
					else if (Array.isArray(subValue)) for (const item of subValue) lines.push(`- ${typeof item === "string" ? item : JSON.stringify(item)}`);
					else lines.push("```json", JSON.stringify(subValue, null, 2), "```");
					lines.push("");
				}
			}
			lines.push("");
		}
		if (Array.isArray(analysis.conclusions) && analysis.conclusions.length > 0) {
			lines.push("## 结论", "");
			for (const item of analysis.conclusions) lines.push(`- ${item}`);
			lines.push("");
		}
		if (Array.isArray(analysis.evidence) && analysis.evidence.length > 0) {
			lines.push("## 证据", "");
			for (const item of analysis.evidence) {
				const conf = item.confidence === "high" ? "高" : item.confidence === "medium" ? "中" : "低";
				const parts = [`【${conf}】${item.feature ?? ""}`];
				if (typeof item.excerpt === "string" && item.excerpt !== "") parts.push(`「${item.excerpt}」`);
				if (typeof item.why === "string" && item.why !== "") parts.push(item.why);
				if (typeof item.location === "string" && item.location !== "") parts.push(`@${item.location}`);
				lines.push(`- ${parts.join(" ｜ ")}`);
			}
			lines.push("");
		}
		if (Array.isArray(analysis.samples) && analysis.samples.length > 0) {
			lines.push("## 样本", "");
			for (const item of analysis.samples) {
				lines.push(`- ${item.sampleId ?? ""}（${item.location ?? ""}）${typeof item.note === "string" && item.note !== "" ? `：${item.note}` : ""}`);
			}
			lines.push("");
		}
		return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
	}

	/** 解析正文：YAML 头 + 按 `##` 切节。认不出的节照样保留，解析失败按纯文本处理，不抛错。 */
	#parseDoc(text) {
		const front = {};
		let body = text;
		const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
		if (head !== null) {
			body = text.slice(head[0].length);
			for (const line of head[1].split(/\r?\n/)) {
				const at = line.indexOf(":");
				if (at <= 0) continue;
				const key = line.slice(0, at).trim();
				const value = line.slice(at + 1).trim();
				if (key !== "") front[key] = value;
			}
		}
		const sections = [];
		let current = null;
		for (const line of body.split(/\r?\n/)) {
			const heading = /^##\s+(.+?)\s*$/.exec(line);
			if (heading !== null) {
				current = { heading: heading[1], lines: [] };
				sections.push(current);
				continue;
			}
			if (current === null) {
				if (line.trim() === "") continue;
				current = { heading: "", lines: [] };
				sections.push(current);
			}
			current.lines.push(line);
		}
		return { front, sections: sections.map((item) => ({ heading: item.heading, body: item.lines.join("\n").trim() })) };
	}

	/** 读档案正文。拆书档第一次读时由 JSON 生成 MD 并落盘（迁移），之后改的就是这份 MD。 */
	async readDoc(id) {
		const registry = await this.readRegistry();
		const custom = (registry.customDocs ?? []).find((item) => item.id === id);
		const built = registry.analyses.find((item) => item.id === id);
		if (custom === void 0 && built === void 0) throw new StoreError("E_NOT_FOUND", `档案不存在：${id}`);
		const kind = custom !== void 0 ? "custom" : "decomposed";
		const file = this.#docFile(id, kind);
		let markdown = null;
		try {
			markdown = await readFile(file, "utf8");
		} catch {
			markdown = null;
		}
		if (markdown === null) {
			if (kind === "custom") throw new StoreError("E_NOT_FOUND", `自建档案的正文文件缺失：${id}`, "到档案页重新新建，或从 trash 恢复");
			const analysis = await this.readAnalysis(id);
			markdown = this.#analysisToMarkdown(analysis);
			await this.#atomicWriteText(file, markdown);
		}
		return { id, kind, title: custom?.title ?? built?.title ?? "", markdown, parsed: this.#parseDoc(markdown), file };
	}

	/** 保存档案正文（整篇覆盖）。只写 MD 与标题，不动 Schema 化的 JSON。 */
	async saveDoc(id, markdown) {
		if (typeof markdown !== "string" || markdown.trim() === "") {
			throw new StoreError("E_EMPTY_DOC", "正文为空，不覆盖", "写点内容再保存");
		}
		const current = await this.readDoc(id);
		const text = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
		const parsed = this.#parseDoc(text);
		const title = typeof parsed.front.title === "string" && parsed.front.title.trim() !== "" ? parsed.front.title.trim() : current.title;
		await this.#atomicWriteText(current.file, text);
		const registry = await this.readRegistry();
		const entry = current.kind === "custom"
			? (registry.customDocs ?? []).find((item) => item.id === id)
			: registry.analyses.find((item) => item.id === id);
		if (entry !== void 0) entry.title = title;
		await this.#writeRegistry(registry);
		return { id, kind: current.kind, title, file: current.file, sections: parsed.sections.length };
	}

	/** 新建自建档案：只建 MD。固定节给一份骨架，作者随意删改。 */
	async createDoc({ title, template = "blank" } = {}) {
		const name = typeof title === "string" && title.trim() !== "" ? title.trim() : "未命名档案";
		const id = newId();
		const createdAt = stamp();
		const body = template === "blank" ? "" : `${Object.values(DOC_FEATURE_LABELS).map((label) => `## ${label}\n`).join("\n")}\n`;
		const markdown = ["---", `analysisId: ${id}`, `title: ${name}`, "kind: custom", "channel: 自建", "scope: full-book", `createdAt: ${createdAt}`, "---", "", body].join("\n");
		const file = this.#docFile(id, "custom");
		await this.#atomicWriteText(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
		const registry = await this.readRegistry();
		registry.customDocs.push({ id, title: name, kind: "custom", channel: "自建", createdAt });
		await this.#writeRegistry(registry);
		return { id, title: name, file, markdown };
	}

	/** 删除档案：文件移进 trash（不硬删），registry 里摘掉。拆书档的 JSON 仍留在 analyses/ 作留档。 */
	async deleteDoc(id) {
		const doc = await this.readDoc(id);
		const trashDir = this.#p("trash");
		await mkdir(trashDir, { recursive: true });
		const movedTo = join(trashDir, `${id}.${stamp().replace(/[:.]/g, "-")}.md`);
		await rename(doc.file, movedTo);
		const registry = await this.readRegistry();
		if (doc.kind === "custom") registry.customDocs = (registry.customDocs ?? []).filter((item) => item.id !== id);
		else registry.analyses = registry.analyses.filter((item) => item.id !== id);
		await this.#writeRegistry(registry);
		return { id, kind: doc.kind, movedTo };
	}

	/** 列出全部档案（拆书档 + 自建档），按创建时间倒序。 */
	async listDocs() {
		const registry = await this.readRegistry();
		return {
			items: [
				...registry.analyses.map((item) => ({ id: item.id, title: item.title ?? "", channel: item.channel ?? "", createdAt: item.createdAt ?? "", kind: "decomposed" })),
				...(registry.customDocs ?? []).map((item) => ({ id: item.id, title: item.title ?? "", channel: item.channel ?? "自建", createdAt: item.createdAt ?? "", kind: "custom" })),
			].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
		};
	}

	// ================================================== 成人场景地图（adult-maps 层）
	// 只存位置与分类，供本地模型按行号定点读取原文；不存原文、不复述露骨内容。
	// 原文哈希把整张地图钉在那一版原文上：原文一改，旧行号全部作废。
	#adultMapFile(mapId) {
		return this.#p("adult-maps", `${mapId}.json`);
	}

	/** 校验并规范化一张成人场景地图。 */
	#normalizeAdultMap(map, { analysisId } = {}) {
		const problems = [];
		if (!map || typeof map !== "object" || Array.isArray(map)) {
			return { normalized: null, problems: ["地图必须是 JSON 对象"] };
		}
		if (map.schemaVersion !== ADULT_MAP_SCHEMA_VERSION) problems.push(`schemaVersion 必须是 ${ADULT_MAP_SCHEMA_VERSION}`);
		const sourceHash = typeof map.sourceHash === "string" ? map.sourceHash.trim() : "";
		if (sourceHash.length < 16) problems.push("sourceHash 不能为空（原文 SHA-256，用于锁定行号版本）");
		if (map.lineBase !== 1) problems.push("lineBase 必须是 1（行号从 1 起算的全局物理行号）");
		const segmentsIn = Array.isArray(map.segments) ? map.segments : null;
		if (segmentsIn === null) problems.push("segments 必须是数组");
		const segments = [];
		const seen = new Set();
		for (const [index, raw] of (segmentsIn ?? []).entries()) {
			const where = `第${index + 1}条`;
			if (!raw || typeof raw !== "object") {
				problems.push(`${where} 不是对象`);
				continue;
			}
			const segmentId = typeof raw.segmentId === "string" ? raw.segmentId.trim() : "";
			if (segmentId === "") problems.push(`${where} 缺 segmentId`);
			else if (seen.has(segmentId)) problems.push(`${where} segmentId 重复：${segmentId}`);
			seen.add(segmentId);
			const typeHit = SCENE_TYPE_MAP[raw.type];
			if (!typeHit) problems.push(`${where} type 只允许 E/A/P/R（或 main_scene/ambient_mirror/setup/afterglow）`);
			const startLine = Number(raw.startLine);
			const endLine = Number(raw.endLine);
			if (!Number.isInteger(startLine) || startLine < 1) problems.push(`${where} startLine 必须是 ≥1 的整数`);
			if (!Number.isInteger(endLine) || endLine < 1) problems.push(`${where} endLine 必须是 ≥1 的整数`);
			if (Number.isInteger(startLine) && Number.isInteger(endLine) && endLine < startLine) problems.push(`${where} endLine 不能小于 startLine`);
			const intIn03 = (value, fallback) => (Number.isInteger(value) && value >= 0 && value <= 3 ? value : fallback);
			segments.push({
				segmentId,
				type: typeHit?.code ?? "A",
				typeName: typeHit?.name ?? "氛围镜头",
				chapter: typeof raw.chapter === "string" ? raw.chapter : "",
				chapterOccurrence: Number.isInteger(raw.chapterOccurrence) && raw.chapterOccurrence >= 1 ? raw.chapterOccurrence : 1,
				startLine: Number.isInteger(startLine) ? startLine : 0,
				endLine: Number.isInteger(endLine) ? endLine : 0,
				function: Array.isArray(raw.function) ? raw.function.filter((item) => typeof item === "string") : [],
				subTags: Array.isArray(raw.subTags) ? raw.subTags.filter((item) => typeof item === "string") : [],
				// 氛围贡献度是 A 类研究的核心字段；没给就按强度兜底，避免下游全空
				intensity: intIn03(raw.intensity, 1),
				ambientContribution: intIn03(raw.ambientContribution, intIn03(raw.intensity, 1)),
				ageStatus: ["confirmed_adult", "unconfirmed", "minor"].includes(raw.ageStatus) ? raw.ageStatus : "unconfirmed",
				consentRisk: ["none", "power_imbalance", "coercion", "unknown"].includes(raw.consentRisk) ? raw.consentRisk : "unknown",
				confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "medium",
				sceneGroupId: typeof raw.sceneGroupId === "string" ? raw.sceneGroupId : "",
				relatedIds: Array.isArray(raw.relatedIds) ? raw.relatedIds.filter((item) => typeof item === "string") : [],
				note: typeof raw.note === "string" ? raw.note : "",
			});
		}
		const counts = { E: 0, A: 0, P: 0, R: 0, minorBlocked: 0, ageUnconfirmed: 0 };
		for (const segment of segments) {
			counts[segment.type] += 1;
			if (ADULT_AGE_BLOCKING.includes(segment.ageStatus)) counts.minorBlocked += 1;
			else if (segment.ageStatus === "unconfirmed") counts.ageUnconfirmed += 1;
		}
		const normalized = {
			schemaVersion: ADULT_MAP_SCHEMA_VERSION,
			mapId: newId(),
			sourceHash,
			lineBase: 1,
			coverage: map.coverage === "partial" ? "partial" : "full-book",
			sourceTitle: typeof map.sourceTitle === "string" ? map.sourceTitle : "",
			sourcePath: typeof map.sourcePath === "string" ? map.sourcePath : "",
			totalLines: Number.isInteger(map.totalLines) && map.totalLines >= 0 ? map.totalLines : 0,
			notes: typeof map.notes === "string" ? map.notes : "",
			analysisId: analysisId ?? (typeof map.analysisId === "string" ? map.analysisId : null),
			segments,
			summary: { total: segments.length, ...counts },
			createdAt: stamp(),
		};
		return { normalized, problems };
	}

	/** 地图落库。只写位置与分类，不写原文。 */
	async saveAdultMap(map, meta = {}) {
		const { normalized, problems } = this.#normalizeAdultMap(map, meta);
		if (problems.length > 0) throw new StoreError("E_INVALID_ADULT_MAP", problems.join("；"), "按成人场景地图模板重新生成");
		// 同一原文哈希 + 同一覆盖范围视为重复地图
		const registry = await this.readRegistry();
		const same = registry.adultMaps.find((item) => item.sourceHash === normalized.sourceHash);
		if (same) throw new StoreError("E_DUPLICATE_ADULT_MAP", `这份原文（${normalized.sourceHash.slice(0, 12)}…）已有场景地图：${same.title || same.id}`, "旧地图仍在；要替换请先归档旧地图");
		await this.#atomicWriteJson(this.#adultMapFile(normalized.mapId), normalized);
		registry.adultMaps.push({
			id: normalized.mapId,
			title: normalized.sourceTitle || "",
			sourceHash: normalized.sourceHash,
			total: normalized.summary.total,
			counts: normalized.summary,
			createdAt: normalized.createdAt,
		});
		await this.#writeRegistry(registry);
		return normalized;
	}

	async listAdultMaps() {
		const registry = await this.readRegistry();
		return registry.adultMaps;
	}

	async readAdultMap(mapId) {
		try {
			return JSON.parse(await readFile(this.#adultMapFile(mapId), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `场景地图不存在：${mapId}`);
		}
	}

	/**
	 * 定点读取：按地图里的行号从原文本机文件读片段（只读，不改原文）。
	 * context 是前后各扩的行数，供本地模型理解上下文用，缺省 20 行。
	 * 哈希对不上直接拒绝：原文改过，旧行号读出来就是错的。
	 */
	async readMapSegment(mapId, segmentId, options = {}) {
		const map = await this.readAdultMap(mapId);
		const segment = map.segments.find((item) => item.segmentId === segmentId);
		if (!segment) throw new StoreError("E_NOT_FOUND", `地图里没有这个片段：${segmentId}`);
		const filePath = typeof options.filePath === "string" && options.filePath.trim() !== "" ? options.filePath.trim() : map.sourcePath;
		if (!filePath) throw new StoreError("E_SOURCE_MISSING", "不知道原文在哪：地图没记 sourcePath，本次也没传 filePath", "在导入时把原文路径写进地图，或调用时传 filePath");
		let buffer;
		try {
			buffer = await readFile(filePath);
		} catch (error) {
			throw new StoreError("E_SOURCE_UNREADABLE", `读不了原文：${error.message}`, "核对路径与权限");
		}
		const actualHash = createHash("sha256").update(buffer).digest("hex");
		if (map.sourceHash && actualHash.toLowerCase() !== String(map.sourceHash).toLowerCase()) {
			throw new StoreError("E_HASH_MISMATCH", `原文哈希对不上（地图是 ${String(map.sourceHash).slice(0, 12)}…，当前文件是 ${actualHash.slice(0, 12)}…）`, "原文改过，旧行号失效；重新生成场景地图");
		}
		const lines = buffer.toString("utf8").split(/\r?\n/u);
		const context = Number.isInteger(options.context) && options.context >= 0 ? options.context : 20;
		const from = Math.max(1, segment.startLine - context);
		const to = Math.min(lines.length, segment.endLine + context);
		const slice = lines.slice(from - 1, to).map((text, index) => ({ line: from + index, text }));
		return {
			segment,
			filePath,
			totalLines: lines.length,
			range: { from, to },
			core: { from: segment.startLine, to: segment.endLine },
			lines: slice,
			text: slice.map((item) => item.text).join("\n"),
			ageGate: {
				blocked: ADULT_AGE_BLOCKING.includes(segment.ageStatus),
				needsReview: segment.ageStatus !== "confirmed_adult",
				ageStatus: segment.ageStatus,
				consentRisk: segment.consentRisk,
			},
		};
	}

	// ================================================== 成人向场面资产（adult 层）
	// 独立一层：只存镜头骨架、推进阶梯、张力与节奏参数、净变化，不复述露骨原文。
	// 不进文风候选发布链（发布正式文风时不会把成人场面方法带进别的书）；导入即 proposed。
	#adultFile(assetId, suffix = "") {
		return this.#p("adult", `${assetId}${suffix}.json`);
	}

	/** 校验并规范化一条成人向场面资产（供预览与落库共用）。 */
	#normalizeAdultAsset(asset, { analysisId, sourceTitle }) {
		const problems = [];
		const id = asset?.assetId;
		if (typeof id !== "string" || !UUID_RE.test(id)) problems.push("assetId 不是合法 UUID");
		const dimension = typeof asset?.dimension === "string" ? asset.dimension : "";
		if (!ADULT_DIMENSIONS.includes(dimension)) problems.push(`dimension 必须是 ${ADULT_DIMENSIONS.join("/")}`);
		const title = typeof asset?.title === "string" ? asset.title.trim() : "";
		if (title === "") problems.push("title 不能为空");
		if (asset?.requireAdult !== true) problems.push("requireAdult 必须是 true（成人向资产必须显式标记）");
		if (analysisId !== undefined && typeof asset?.analysisId === "string" && asset.analysisId !== analysisId) {
			problems.push("asset.analysisId 与包内 analysis.json 不一致");
		}
		const str = (value) => (typeof value === "string" ? value : "");
		const ladder = Array.isArray(asset?.ladder)
			? asset.ladder.filter((item) => item && typeof item === "object").map((item, index) => ({
				step: Number.isInteger(item.step) && item.step > 0 ? item.step : index + 1,
				trigger: str(item.trigger),
				change: str(item.change),
				writing: str(item.writing),
			}))
			: [];
		const rhythmIn = asset?.rhythm && typeof asset.rhythm === "object" ? asset.rhythm : {};
		const intOr0 = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
		const sensesIn = asset?.senses && typeof asset.senses === "object" ? asset.senses : {};
		const isFlesh = ADULT_FLESH_DIMENSIONS.includes(dimension);
		const lexicon = Array.isArray(asset?.lexicon)
			? asset.lexicon
				.filter((item) => item && typeof item === "object")
				.map((item) => ({
					category: ADULT_LEXICON_CATEGORIES.includes(item.category) ? item.category : "动作",
					note: str(item.note),
					words: Array.isArray(item.words) ? item.words.filter((w) => typeof w === "string" && w.trim() !== "") : [],
					frequency: str(item.frequency),
					avoid: Array.isArray(item.avoid) ? item.avoid.filter((w) => typeof w === "string" && w.trim() !== "") : [],
				}))
				.filter((item) => item.words.length > 0 || item.note !== "")
			: [];
		const mirrors = Array.isArray(asset?.mirrors)
			? asset.mirrors
				.filter((item) => item && typeof item === "object")
				.map((item) => ({
					name: str(item.name),
					function: str(item.function),
					length: str(item.length),
					structure: str(item.structure),
					technique: str(item.technique),
					pitfall: str(item.pitfall),
				}))
				.filter((item) => item.name !== "" || item.structure !== "")
			: [];
		const samples = Array.isArray(asset?.samples)
			? asset.samples
				.filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim() !== "")
				.map((item) => ({
					text: item.text,
					location: str(item.location),
					why: str(item.why),
					intensity: Number.isInteger(item.intensity) && item.intensity >= 0 && item.intensity <= 3 ? item.intensity : 2,
				}))
			: [];
		// 血肉维度必须真有内容：光起个标题、词汇表和镜头写法都空的，不收
		if (isFlesh && lexicon.length === 0 && mirrors.length === 0 && samples.length === 0) {
			problems.push(`「${dimension}」必须给出 lexicon（词表）、mirrors（镜头写法）或 samples（样段）中至少一项`);
		}
		const mappingIn = asset?.sceneMapping && typeof asset.sceneMapping === "object" ? asset.sceneMapping : {};
		const normalized = {
			schemaVersion: ADULT_SCHEMA_VERSION,
			assetId: id,
			requireAdult: true,
			dimension,
			title,
			analysisId: analysisId ?? (typeof asset?.analysisId === "string" ? asset.analysisId : null),
			source: { title: sourceTitle ?? str(asset?.source?.title), analysisId: analysisId ?? asset?.analysisId ?? null },
			observation: str(asset?.observation),
			entry: str(asset?.entry),
			ladder,
			tension: {
				start: str(asset?.tension?.start),
				peak: str(asset?.tension?.peak),
				fall: str(asset?.tension?.fall),
				afterglow: str(asset?.tension?.afterglow),
			},
			rhythm: {
				mainWords: intOr0(rhythmIn.mainWords),
				mirrors: intOr0(rhythmIn.mirrors),
				avgMirrorWords: intOr0(rhythmIn.avgMirrorWords),
				accelerateAt: str(rhythmIn.accelerateAt),
				decelerateAt: str(rhythmIn.decelerateAt),
			},
			pov: str(asset?.pov),
			voice: str(asset?.voice),
			props: str(asset?.props),
			senses: Object.fromEntries(ADULT_SENSES.map((key) => [key, str(sensesIn[key])])),
			delta: str(asset?.delta),
			limits: str(asset?.limits),
			interface: str(asset?.interface),
			guidance: str(asset?.guidance),
			lexicon,
			mirrors,
			samples,
			sceneMapping: {
				exp: str(mappingIn.exp),
				partner: str(mappingIn.partner),
				dark: str(mappingIn.dark),
				pain: str(mappingIn.pain),
				crowd: str(mappingIn.crowd),
				time: str(mappingIn.time),
				era: str(mappingIn.era),
				mainWords: intOr0(mappingIn.mainWords),
				mirrors: intOr0(mappingIn.mirrors),
			},
			exportPolicy: "local-only",
			evidence: Array.isArray(asset?.evidence)
				? asset.evidence.filter((item) => item && typeof item === "object").map((item) => ({
					excerpt: str(item.excerpt).slice(0, 300),
					location: str(item.location),
					why: str(item.why),
					structuralOnly: item.structuralOnly === true,
				}))
				: [],
			version: typeof asset?.version === "string" && VERSION_RE.test(asset.version) ? asset.version : "V1.0",
			status: "proposed",
			createdAt: stamp(),
			updatedAt: stamp(),
		};
		return { normalized, problems };
	}

	/** 成人向场面资产落库（proposed）。 */
	async createAdultAsset(asset) {
		if (asset?.status !== "proposed") throw new StoreError("E_INVALID_ADULT", "成人向场面资产必须以 proposed 状态入库");
		const file = this.#adultFile(asset.assetId);
		const registry = await this.readRegistry();
		if (registry.adult.some((item) => item.id === asset.assetId) || existsSync(file)) {
			throw new StoreError("E_DUPLICATE_ADULT_ID", `assetId 已存在：${asset.assetId}`, "换新的 UUID；原文件不覆盖");
		}
		await this.#writeJsonIfAbsent(file, asset, "E_DUPLICATE_ADULT_ID", "换新的 UUID；原文件不覆盖");
		registry.adult.push({
			id: asset.assetId,
			dimension: asset.dimension,
			title: asset.title,
			source: asset.source?.title ?? "",
			status: asset.status,
			version: asset.version,
			requireAdult: true,
			createdAt: asset.createdAt,
			updatedAt: asset.updatedAt,
		});
		await this.#writeRegistry(registry);
		return { assetId: asset.assetId, file };
	}

	/** 成人向场面资产清单（全库）；query: { dimension, query }。 */
	async listAdultAssets(query = {}) {
		const registry = await this.readRegistry();
		const keyword = typeof query.query === "string" ? query.query.trim().toLowerCase() : "";
		return registry.adult.filter((item) => {
			if (query.dimension && item.dimension !== query.dimension) return false;
			if (keyword !== "") return `${item.title} ${item.source}`.toLowerCase().includes(keyword);
			return true;
		});
	}

	async readAdultAsset(assetId) {
		try {
			return JSON.parse(await readFile(this.#adultFile(assetId), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `成人向场面资产不存在：${assetId}`);
		}
	}

	/** 编辑成人向场面资产的可变字段（不改 assetId / 来源 / 版本快照）。 */
	async updateAdultAsset(assetId, patch) {
		const file = this.#adultFile(assetId);
		const asset = JSON.parse(await readFile(file, "utf8"));
		for (const key of ["observation", "entry", "pov", "voice", "props", "delta", "limits", "interface", "guidance"]) {
			if (typeof patch?.[key] === "string") asset[key] = patch[key];
		}
		asset.requireAdult = true;
		asset.status = patch?.status === "active" || patch?.status === "archived" || patch?.status === "proposed" ? patch.status : asset.status;
		asset.updatedAt = stamp();
		await this.#atomicWriteJson(file, asset);
		const registry = await this.readRegistry();
		const entry = registry.adult.find((item) => item.id === assetId);
		if (entry) {
			entry.status = asset.status;
			entry.updatedAt = asset.updatedAt;
			entry.title = asset.title;
		}
		await this.#writeRegistry(registry);
		return asset;
	}

	/** 成人向场面资产版本升级：旧版快照不可覆盖，主文件推进到新版本。 */
	async upgradeAdultAsset(assetId, patch = {}, note = "") {
		const file = this.#adultFile(assetId);
		const current = JSON.parse(await readFile(file, "utf8"));
		const version = nextMinor(current.version);
		await this.#writeJsonIfAbsent(this.#adultFile(assetId, `@${current.version}`), current, "E_VERSION_EXISTS", "该版本快照已存在，不覆盖");
		const next = {
			...current,
			...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
			requireAdult: true,
			version,
			updatedAt: stamp(),
		};
		next.history = [...(current.history ?? []), { version: current.version, note }];
		await this.#atomicWriteJson(file, next);
		const registry = await this.readRegistry();
		const entry = registry.adult.find((item) => item.id === assetId);
		if (entry) {
			entry.version = version;
			entry.updatedAt = next.updatedAt;
		}
		await this.#writeRegistry(registry);
		return next;
	}

	// ================================================== 方法资产（methods 层）
	// 方法资产与文风资产并列独立：维度、运作机制、适用条件、限制、证据、写作指导。
	// 导入只进 proposed（待审核），正式启用/归档由作者操作；发布版本快照不可覆盖。
	#methodFile(assetId, suffix = "") {
		return this.#p("methods", `${assetId}${suffix}.json`);
	}

	/** 校验并规范化一条方法资产（供预览与落库共用）。 */
	#normalizeMethodAsset(asset, { analysisId, sourceTitle }) {
		const problems = [];
		const id = asset?.assetId;
		if (typeof id !== "string" || !UUID_RE.test(id)) problems.push("assetId 不是合法 UUID");
		const dimension = typeof asset?.dimension === "string" ? asset.dimension : "";
		if (!METHOD_DIMENSIONS.includes(dimension)) problems.push(`dimension 必须是 ${METHOD_DIMENSIONS.join("/")}`);
		const title = typeof asset?.title === "string" ? asset.title.trim() : "";
		if (title === "") problems.push("title 不能为空");
		if (typeof asset?.mechanism !== "string" || asset.mechanism.trim() === "") problems.push("mechanism（运作机制）不能为空");
		if (analysisId !== undefined && typeof asset?.analysisId === "string" && asset.analysisId !== analysisId) {
			problems.push("asset.analysisId 与包内 analysis.json 不一致");
		}
		const normalized = {
			schemaVersion: METHODS_SCHEMA_VERSION,
			assetId: id,
			dimension,
			title,
			analysisId: analysisId ?? (typeof asset?.analysisId === "string" ? asset.analysisId : null),
			source: { title: sourceTitle ?? (typeof asset?.source?.title === "string" ? asset.source.title : ""), analysisId: analysisId ?? asset?.analysisId ?? null },
			observation: typeof asset?.observation === "string" ? asset.observation : "",
			mechanism: typeof asset?.mechanism === "string" ? asset.mechanism : "",
			transferable: typeof asset?.transferable === "string" ? asset.transferable : "",
			applicability: typeof asset?.applicability === "string" ? asset.applicability : "",
			limitations: typeof asset?.limitations === "string" ? asset.limitations : "",
			evidence: Array.isArray(asset?.evidence) ? asset.evidence.filter((item) => item && typeof item === "object") : [],
			guidance: typeof asset?.guidance === "string" ? asset.guidance : "",
			version: typeof asset?.version === "string" && VERSION_RE.test(asset.version) ? asset.version : "V1.0",
			status: "proposed",
			createdAt: stamp(),
			updatedAt: stamp(),
		};
		return { normalized, problems };
	}

	/**
	 * 把各种常见外部产物折成统一成品包形状。
	 * 外部模型很少会严格按 manifest/analysis 两文件命名，这里做宽容识别：
	 * · 单份 analysis 本体（有 analysisId + source）→ { analysis }
	 * · 单份地图（有 sourceHash + segments）→ { adultMap }
	 * · 裸数组 → 按条目特征分到 styleAssets / methodAssets / adultAssets
	 */
	normalizePackageShape(input) {
		/**
		 * 补结构性字段：schemaVersion / assetId。
		 * 这两个是纯技术标识，外部 ChatGPT 常常不带，缺了会让整批被判 invalid 而实际上什么都没导进去。
		 * 内容字段（dimension / title / mechanism 等）一律不补、不猜。
		 *
		 * **requireAdult 不在这里补。** 成人向内容必须由产出方显式标记，
		 * 系统不按字段推断后自动放行 —— 那条闸门（测试「必须显式标记成人向」）是刻意的，
		 * 自动补等于把「推断」变成「授权」，会把不该进成人向层的东西放进去。
		 * 缺标记时按正常校验报错，由作者补上标记或换用带标记的模板产出。
		 */
		const fillIdentity = (item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return item;
			const next = { ...item };
			if (next.schemaVersion === void 0) next.schemaVersion = 1;
			if (typeof next.assetId !== "string" || next.assetId.trim() === "") next.assetId = newId();
			return next;
		};
		/** 统一出口：补齐身份字段后再交出去。 */
		const shaped = (pkg, shape, note) => {
			if (pkg !== null && typeof pkg === "object" && !Array.isArray(pkg)) {
				if (Array.isArray(pkg.adultAssets)) pkg = { ...pkg, adultAssets: pkg.adultAssets.map((item) => fillIdentity(item)) };
				if (Array.isArray(pkg.methodAssets)) pkg = { ...pkg, methodAssets: pkg.methodAssets.map((item) => fillIdentity(item)) };
			}
			return { pkg, shape, note };
		};
		/**
		 * 单条资产是不是成人向的。
		 * 原来只认 `requireAdult === true`，可拆书模板产出的裸数组经常没带这个标记，
		 * 结果整批成人向骨架/血肉被静默丢掉（create:0，界面上什么也看不出来）。
		 * 现在按维度名和成人向专属字段一起判，宁可先归到成人向桶里，
		 * 再由 schema 校验报出真正缺什么，也不再无声丢弃。
		 */
		const looksAdultAsset = (item) => {
			if (!item || typeof item !== "object") return false;
			if (item.requireAdult === true) return true;
			if (typeof item.dimension === "string" && ADULT_DIMENSIONS.includes(item.dimension)) return true;
			return Array.isArray(item.lexicon) || Array.isArray(item.mirrors)
				|| item.ladder !== void 0 || item.tension !== void 0
				|| item.interface !== void 0 || item.sceneMapping !== void 0
				|| item.exportPolicy === "local-only";
		};
		if (Array.isArray(input)) {
			const buckets = { styleAssets: [], methodAssets: [], adultAssets: [] };
			for (const item of input) {
				if (!item || typeof item !== "object") continue;
				if (looksAdultAsset(item)) buckets.adultAssets.push(fillIdentity(item));
				else if (typeof item.mechanism === "string" || (typeof item.dimension === "string" && typeof item.title === "string")) buckets.methodAssets.push(fillIdentity(item));
				else if (typeof item.prompt === "string" || typeof item.name === "string") buckets.styleAssets.push(item);
			}
			const total = buckets.styleAssets.length + buckets.methodAssets.length + buckets.adultAssets.length;
			if (total === 0) {
				return {
					pkg: {},
					shape: "unknown",
					note: `裸数组里 ${input.length} 条一条也没认出来：每条至少要有 name 或 prompt（文风）、dimension+title（方法）、requireAdult 或成人向维度名（成人向）`,
				};
			}
			return {
				pkg: Object.fromEntries(Object.entries(buckets).filter(([, list]) => list.length > 0)),
				shape: "bare-array",
				note: `裸数组已按条目特征分拣：文风 ${buckets.styleAssets.length} · 方法 ${buckets.methodAssets.length} · 成人向 ${buckets.adultAssets.length}`,
			};
		}
		if (!input || typeof input !== "object") return { pkg: input, shape: "invalid", note: "" };
		const keys = Object.keys(input);
		const alreadyPackage = ["manifest", "analysis", "styleAssets", "methodAssets", "adultAssets", "adultMap"].some((key) => keys.includes(key));
		if (alreadyPackage) return shaped(input, "package", "");
		if (typeof input.analysisId === "string" && input.source !== undefined) {
			return { pkg: { analysis: input }, shape: "analysis-only", note: "识别为单份拆书档案（没有 manifest，按单档案导入）" };
		}
		if (input.sourceHash !== undefined && Array.isArray(input.segments)) {
			return { pkg: { adultMap: input }, shape: "map-only", note: `识别为成人场景地图（${input.segments.length} 条索引）` };
		}
		if (Array.isArray(input.segments) && input.segments.length > 0) {
			return { pkg: { adultMap: input }, shape: "map-only", note: `识别为成人场景地图（${input.segments.length} 条索引）` };
		}
		// 一次只导出一条资产时也给认出来，不必强行包成成品包
		if (looksAdultAsset(input)) {
			return shaped({ adultAssets: [input] }, "adult-only", "识别为单条成人向场面资产");
		}
		if (typeof input.mechanism === "string" && typeof input.dimension === "string" && typeof input.title === "string") {
			return shaped({ methodAssets: [input] }, "method-only", "识别为单条方法资产");
		}
		if ((typeof input.prompt === "string" || typeof input.name === "string") && (input.features !== void 0 || input.category !== void 0)) {
			return { pkg: { styleAssets: [input] }, shape: "style-only", note: "识别为单条文风资产" };
		}
		return { pkg: input, shape: "unknown", note: "" };
	}

	/** 导入预览：不写盘，只算出这份成品包会发生什么（新增 / 重复 / 冲突 / 异常）。 */
	async previewPackage(input) {
		const shaped = this.normalizePackageShape(input);
		const pkg = shaped.pkg;
		const problems = [];
		if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new StoreError("E_PACKAGE_INVALID", "成品包必须是 JSON 对象");
		if (shaped.shape === "unknown" && !Array.isArray(pkg)) {
			throw new StoreError("E_PACKAGE_UNRECOGNIZED", `认不出这份 JSON 是什么：顶层键 ${Object.keys(pkg).slice(0, 8).join("/") || "（空）"}`, "要 analysis（含 analysisId+source）或成品包（含 analysis/style-assets/method-assets/adult-scenes/adult-scene-map）");
		}
		const manifest = pkg.manifest;
		// manifest 现在是可选的：外部模型一般不会带，缺了不拦，只在有问题时报出来
		if (manifest !== undefined && (!manifest || typeof manifest !== "object")) problems.push("manifest 给的不是对象");
		else if (manifest && manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
			problems.push(`manifest.schemaVersion 必须是 ${PACKAGE_SCHEMA_VERSION}`);
		}
		const analysis = pkg.analysis;
		const hasMap = pkg.adultMap !== undefined;
		if (!analysis || typeof analysis !== "object") {
			if (!hasMap) problems.push("缺少 analysis.json 数据（也可以只导入场景地图）");
		}
		let mapPreview = null;
		if (hasMap) {
			const { normalized: mapNormalized, problems: mapProblems } = this.#normalizeAdultMap(pkg.adultMap);
			const registryForMap = await this.readRegistry();
			const duplicated = mapNormalized ? registryForMap.adultMaps.some((item) => item.sourceHash === mapNormalized.sourceHash) : false;
			mapPreview = {
				ok: mapProblems.length === 0 && !duplicated,
				action: mapProblems.length > 0 ? "invalid" : duplicated ? "duplicate" : "create-map",
				problem: mapProblems.join("；") || (duplicated ? "这份原文已有场景地图，不覆盖" : ""),
				title: mapNormalized?.sourceTitle ?? "",
				map: mapNormalized,
				summary: mapNormalized?.summary ?? null,
			};
		}
		let analysisProblems = [];
		if (analysis && typeof analysis === "object") {
			analysisProblems = validateAgainstSchema(this.#schemas.analysis, analysis);
			if (analysisProblems.length > 0) problems.push(`analysis.json 校验未通过：${analysisProblems.join("；")}`);
		}
		const analysisId = analysis?.analysisId;
		const registry = await this.readRegistry();
		/**
		 * 档案关联只认库里真有的那份。
		 * 外部拆书是一次一批产出的，补拆文件里写的 analysisId 常常指向另一批次生成的档案
		 * （例如资产写 34b9ae2f，实际导进来的是 ab846bb4），直接存就成了悬空引用，
		 * 界面上永远显示「来源：无」，候选也挂不回自己的书。
		 * 库里恰好只有一份档案时认领到它，多于一份就不猜，留空并在预览里说明。
		 */
		const knownAnalysisIds = new Set(registry.analyses.map((item) => item.id));
		const soleAnalysis = registry.analyses.length === 1 ? registry.analyses[0] : null;
		const resolveAnalysisId = (raw) => {
			if (typeof raw !== "string" || raw === "") return void 0;
			if (knownAnalysisIds.has(raw)) return raw;
			return soleAnalysis !== null ? soleAnalysis.id : void 0;
		};
		const analysisExists = typeof analysisId === "string" && (registry.analyses.some((item) => item.id === analysisId) || existsSync(this.#p("analyses", `${analysisId}.json`)));
		const styleAssets = Array.isArray(pkg.styleAssets) ? pkg.styleAssets : [];
		const methodAssets = Array.isArray(pkg.methodAssets) ? pkg.methodAssets : [];
		const adultAssets = Array.isArray(pkg.adultAssets) ? pkg.adultAssets : [];
		if (pkg.styleAssets !== undefined && !Array.isArray(pkg.styleAssets)) problems.push("style-assets.json 必须是数组");
		if (pkg.methodAssets !== undefined && !Array.isArray(pkg.methodAssets)) problems.push("method-assets.json 必须是数组");
		if (pkg.adultAssets !== undefined && !Array.isArray(pkg.adultAssets)) problems.push("adult-scenes.json 必须是数组");

		const stylePreview = [];
		for (const asset of styleAssets) {
			if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
				stylePreview.push({ ok: false, action: "invalid", problem: "不是对象" });
				continue;
			}
			if (typeof asset.analysisId === "string" && analysisId !== undefined && asset.analysisId !== analysisId) {
				stylePreview.push({ ok: false, action: "conflict", problem: "asset.analysisId 与 analysis.json 不一致", title: asset.title ?? "" });
				continue;
			}
			const draft = {
				name: typeof asset.name === "string" && asset.name.trim() !== "" ? asset.name : `文风资产 ${stylePreview.length + 1}`,
				category: typeof asset.category === "string" ? asset.category : "",
				features: asset.features && typeof asset.features === "object" ? asset.features : { overall: "" },
				prompt: typeof asset.prompt === "string" ? asset.prompt : "",
				forbidden: Array.isArray(asset.forbidden) ? asset.forbidden : [],
			};
			// 整包带档案就用整包的；否则看这条资产自带的 analysisId，只认库里存在的（见 resolveAnalysisId）
			const linkedAnalysisId = typeof analysisId === "string" ? analysisId : resolveAnalysisId(asset.analysisId);
			const candidate = {
				schemaVersion: SCHEMA_VERSION,
				candidateId: newId(),
				kind: "new-style",
				status: "proposed",
				createdAt: stamp(),
				confirmedAt: null,
				members: { analysisIds: typeof linkedAnalysisId === "string" ? [linkedAnalysisId] : [] },
				commonFeatures: {},
				divergentFeatures: {},
				independentSubStyles: [],
				proposed: { targetStyleId: null, draftVersion: "V1.0", draft },
				method: "external-chatgpt-deep-compare",
				note: typeof asset.note === "string" ? asset.note : "成品包导入的文风资产（待作者审核）",
			};
			// 同一来源 + 同名文风资产已经导入过 → 判重复（不重复建档）
			// 来源为空也算同来源：早先那批补拆文件导入时档案 id 悬空过，重导不该再建第二份
			const alreadyImported = typeof linkedAnalysisId === "string" && registry.candidates.some((item) =>
				item.kind === "new-style" && item.meta?.importedName === draft.name
				&& (item.meta?.importedFrom === linkedAnalysisId || item.meta?.importedFrom === null || item.meta?.importedFrom === undefined));
			if (alreadyImported) {
				stylePreview.push({ ok: false, action: "duplicate", problem: "同名文风资产已从同一本小说导入过，不重复建档", title: draft.name });
				continue;
			}
			const candidateProblems = validateAgainstSchema(this.#schemas.candidate, candidate);
			stylePreview.push(candidateProblems.length > 0
				? { ok: false, action: "invalid", problem: candidateProblems.join("；"), title: draft.name }
				: { ok: true, action: "create-candidate", title: draft.name, candidate, meta: { importedFrom: typeof analysisId === "string" ? analysisId : null, importedName: draft.name } });
		}

		const methodPreview = [];
		for (const asset of methodAssets) {
			const { normalized, problems: assetProblems } = this.#normalizeMethodAsset(asset, {
				analysisId: typeof analysisId === "string" ? analysisId : resolveAnalysisId(asset.analysisId),
				sourceTitle: analysis?.source?.title,
			});
			if (assetProblems.length > 0) {
				methodPreview.push({ ok: false, action: "invalid", problem: assetProblems.join("；"), title: asset?.title ?? "" });
				continue;
			}
			if (registry.methods.some((item) => item.id === normalized.assetId) || existsSync(this.#methodFile(normalized.assetId))) {
				methodPreview.push({ ok: false, action: "duplicate", problem: "assetId 已存在，不覆盖", title: normalized.title });
				continue;
			}
			methodPreview.push({ ok: true, action: "create-method", title: normalized.title, asset: normalized });
		}

		const adultPreview = [];
		for (const asset of adultAssets) {
			const { normalized, problems: assetProblems } = this.#normalizeAdultAsset(asset, {
				analysisId: typeof analysisId === "string" ? analysisId : resolveAnalysisId(asset.analysisId),
				sourceTitle: analysis?.source?.title,
			});
			if (assetProblems.length > 0) {
				adultPreview.push({ ok: false, action: "invalid", problem: assetProblems.join("；"), title: asset?.title ?? "" });
				continue;
			}
			if (registry.adult.some((item) => item.id === normalized.assetId) || existsSync(this.#adultFile(normalized.assetId))) {
				adultPreview.push({ ok: false, action: "duplicate", problem: "assetId 已存在，不覆盖", title: normalized.title });
				continue;
			}
			adultPreview.push({ ok: true, action: "create-adult", title: normalized.title, asset: normalized });
		}

		return {
			manifest: manifest ?? null,
			sourceTitle: analysis?.source?.title ?? null,
			analysisId: typeof analysisId === "string" ? analysisId : null,
			shape: shaped.shape,
			shapeNote: shaped.note,
			analysis: { action: analysisProblems.length > 0 ? "invalid" : analysisExists ? "duplicate" : "create", problem: analysisProblems.join("；") || (analysisExists ? "analysisId 已存在，不覆盖" : "") },
			styleAssets: { total: styleAssets.length, items: stylePreview },
			methodAssets: { total: methodAssets.length, items: methodPreview },
			adultAssets: { total: adultAssets.length, items: adultPreview },
			adultMap: mapPreview,
			summary: {
				create: (analysisProblems.length === 0 && !analysisExists && analysis ? 1 : 0) + stylePreview.filter((x) => x.action === "create-candidate").length + methodPreview.filter((x) => x.action === "create-method").length + adultPreview.filter((x) => x.action === "create-adult").length + (mapPreview?.action === "create-map" ? 1 : 0),
				duplicate: (analysisExists && analysisProblems.length === 0 ? 1 : 0) + stylePreview.filter((x) => x.action === "duplicate").length + methodPreview.filter((x) => x.action === "duplicate").length + adultPreview.filter((x) => x.action === "duplicate").length + (mapPreview?.action === "duplicate" ? 1 : 0),
				conflict: stylePreview.filter((x) => x.action === "conflict").length + methodPreview.filter((x) => x.action === "conflict").length + adultPreview.filter((x) => x.action === "conflict").length,
				invalid: (analysisProblems.length > 0 ? 1 : 0) + stylePreview.filter((x) => x.action === "invalid").length + methodPreview.filter((x) => x.action === "invalid").length + adultPreview.filter((x) => x.action === "invalid").length + (mapPreview?.action === "invalid" ? 1 : 0),
			},
			problems,
		};
	}

	/** 正式导入：只接受一份刚做过的预览结果（防止预览与落库之间内容被换掉）。 */
	async commitPackage(input, plan, { report } = {}) {
		const pkg = this.normalizePackageShape(input).pkg;
		const again = await this.previewPackage(pkg);
		if (JSON.stringify(again.summary) !== JSON.stringify(plan?.summary) || again.analysisId !== plan?.analysisId) {
			throw new StoreError("E_PREVIEW_CHANGED", "导入内容与预览时不一致", "重新预览后再确认");
		}
		if ((plan?.summary?.invalid ?? 0) > 0 || (plan?.summary?.conflict ?? 0) > 0) {
			throw new StoreError("E_IMPORT_HAS_ERRORS", "预览里存在异常或冲突项，确认后也不导入它们", "修好包或剔除异常项后重新预览");
		}
		const created = { analysisId: null, candidateIds: [], methodIds: [], adultIds: [], adultMapId: null, reportFile: null };
		const analysis = pkg.analysis;
		if (again.analysis.action === "create" && analysis && typeof analysis === "object") {
			const result = await this.importAnalysis(analysis, report === undefined ? {} : { report });
			created.analysisId = result.analysisId;
			created.reportFile = result.reportFile ?? null;
		} else if (typeof report === "string" && report.trim() !== "") {
			// 方法补拆 / 骨架 / 血肉这些包里没有拆书档案，报告以前在这里被直接丢掉。
			const kindName = pkg.adultAssets ? "adult-scenes" : pkg.methodAssets ? "method-assets" : pkg.styleAssets ? "style-assets" : pkg.adultMap ? "adult-scene-map" : "package";
			created.reportFile = await this.savePackageReport(pkg, report, { name: kindName });
		}
		if (again.adultMap?.action === "create-map" && again.adultMap.map) {
			const saved = await this.saveAdultMap(again.adultMap.map, { analysisId: created.analysisId ?? again.analysisId ?? null });
			created.adultMapId = saved.mapId;
		}
		for (const item of again.styleAssets.items) {
			if (item.action !== "create-candidate") continue;
			const made = await this.createCandidate(item.candidate, item.meta);
			created.candidateIds.push(made.candidateId);
		}
		for (const item of again.methodAssets.items) {
			if (item.action !== "create-method") continue;
			const made = await this.createMethodAsset(item.asset);
			created.methodIds.push(made.assetId);
		}
		for (const item of again.adultAssets.items) {
			if (item.action !== "create-adult") continue;
			const made = await this.createAdultAsset(item.asset);
			created.adultIds.push(made.assetId);
		}
		return created;
	}

	/**
	 * 没有拆书档案的包（方法补拆 / 骨架 / 血肉）也把带来的报告存下来。
	 * 以前 report 只在 importAnalysis 里落盘，这类包附的 MD 会被静默丢掉。
	 * 文件名按报告内容哈希取：同一份报告重复导入不会写第二遍，也不会互相覆盖。
	 */
	async savePackageReport(pkg, report, { name } = {}) {
		const digest = createHash("sha256").update(report).digest("hex").slice(0, 16);
		const safe = typeof name === "string" && name.trim() !== ""
			? name.trim().replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5.-]+/g, "-").slice(0, 40)
			: "package";
		const file = this.#p("reports", `${safe}-${digest}.md`);
		if (!existsSync(file)) await this.#atomicWriteText(file, report.endsWith("\n") ? report : `${report}\n`);
		return file;
	}

	/** 方法资产落库（proposed）。 */
	async createMethodAsset(asset) {
		if (asset?.status !== "proposed") throw new StoreError("E_INVALID_METHOD", "方法资产必须以 proposed 状态入库");
		const file = this.#methodFile(asset.assetId);
		const registry = await this.readRegistry();
		if (registry.methods.some((item) => item.id === asset.assetId) || existsSync(file)) {
			throw new StoreError("E_DUPLICATE_METHOD_ID", `assetId 已存在：${asset.assetId}`, "换新的 UUID；原文件不覆盖");
		}
		await this.#writeJsonIfAbsent(file, asset, "E_DUPLICATE_METHOD_ID", "换新的 UUID；原文件不覆盖");
		registry.methods.push({
			id: asset.assetId,
			dimension: asset.dimension,
			title: asset.title,
			source: asset.source?.title ?? "",
			status: asset.status,
			version: asset.version,
			createdAt: asset.createdAt,
			updatedAt: asset.updatedAt,
		});
		await this.#writeRegistry(registry);
		return { assetId: asset.assetId, file };
	}

	/** 方法资产清单（全库）；query: { dimension, query }。 */
	async listMethodAssets(query = {}) {
		const registry = await this.readRegistry();
		const keyword = typeof query.query === "string" ? query.query.trim().toLowerCase() : "";
		return registry.methods.filter((item) => {
			if (query.dimension && item.dimension !== query.dimension) return false;
			if (keyword !== "") return `${item.title} ${item.source}`.toLowerCase().includes(keyword);
			return true;
		});
	}

	async readMethodAsset(assetId) {
		try {
			return JSON.parse(await readFile(this.#methodFile(assetId), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `方法资产不存在：${assetId}`);
		}
	}

	/** 编辑方法资产的使用说明/创作要求等可变字段（不改 assetId / 来源 / 版本快照）。 */
	async updateMethodAsset(assetId, patch) {
		const file = this.#methodFile(assetId);
		const asset = JSON.parse(await readFile(file, "utf8"));
		for (const key of ["observation", "mechanism", "transferable", "applicability", "limitations", "guidance"]) {
			if (typeof patch?.[key] === "string") asset[key] = patch[key];
		}
		asset.status = patch?.status === "active" || patch?.status === "archived" ? patch.status : (patch?.status === "proposed" ? "proposed" : asset.status);
		asset.updatedAt = stamp();
		await this.#atomicWriteJson(file, asset);
		const registry = await this.readRegistry();
		const entry = registry.methods.find((item) => item.id === assetId);
		if (entry) {
			entry.status = asset.status;
			entry.updatedAt = asset.updatedAt;
			entry.title = asset.title;
		}
		await this.#writeRegistry(registry);
		return asset;
	}

	/** 方法资产版本升级：先把当前版本快照落成 <id>@<旧版>.json（不可覆盖），再把主文件推进到新版本。 */
	async upgradeMethodAsset(assetId, patch = {}, note = "") {
		const file = this.#methodFile(assetId);
		const current = JSON.parse(await readFile(file, "utf8"));
		const version = nextMinor(current.version);
		await this.#writeJsonIfAbsent(this.#methodFile(assetId, `@${current.version}`), current, "E_VERSION_EXISTS", "该版本快照已存在，不覆盖");
		const next = {
			...current,
			...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
			version,
			updatedAt: stamp(),
		};
		next.history = [...(current.history ?? []), { version: current.version, note }];
		await this.#atomicWriteJson(file, next);
		const registry = await this.readRegistry();
		const entry = registry.methods.find((item) => item.id === assetId);
		if (entry) {
			entry.version = version;
			entry.updatedAt = next.updatedAt;
		}
		await this.#writeRegistry(registry);
		return next;
	}

	// ================================================== 第二层：归一化候选
	/** 建候选（proposed）。kind: new-style / merge / split / absorb / version-upgrade。meta: 附加 registry 记录字段（如导入来源）。 */
	async createCandidate(input, meta = {}) {
		const candidate = {
			schemaVersion: SCHEMA_VERSION,
			candidateId: input.candidateId ?? newId(),
			kind: input.kind ?? "new-style",
			status: input.status ?? "proposed",
			createdAt: input.createdAt ?? stamp(),
			confirmedAt: input.confirmedAt ?? null,
			members: input.members ?? {},
			commonFeatures: input.commonFeatures ?? {},
			divergentFeatures: input.divergentFeatures ?? {},
			independentSubStyles: input.independentSubStyles ?? [],
			proposed: input.proposed ?? undefined,
			method: input.method ?? "local-api-assisted",
			note: input.note ?? "",
		};
		const problems = validateAgainstSchema(this.#schemas.candidate, candidate);
		if (problems.length > 0) {
			throw new StoreError("E_INVALID_CANDIDATE", `校验未通过：${problems.join("；")}`, "按 schema/candidate.schema.json 修正后重试");
		}
		const file = this.#p("candidates", `${candidate.candidateId}.json`);
		const registry = await this.readRegistry();
		if (registry.candidates.some((item) => item.id === candidate.candidateId) || existsSync(file)) {
			throw new StoreError("E_DUPLICATE_CANDIDATE_ID", `candidateId 已存在：${candidate.candidateId}`, "换新的 UUID");
		}
		await this.#writeJsonIfAbsent(file, candidate, "E_DUPLICATE_CANDIDATE_ID", "换新的 UUID");
		registry.candidates.push({ id: candidate.candidateId, kind: candidate.kind, status: candidate.status, createdAt: candidate.createdAt, ...(meta && typeof meta === "object" ? { meta } : {}) });
		await this.#writeRegistry(registry);
		return { candidateId: candidate.candidateId, file };
	}

	async readCandidate(id) {
		try {
			return JSON.parse(await readFile(this.#p("candidates", `${id}.json`), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `候选不存在：${id}`);
		}
	}

	async #markCandidate(id, status) {
		const file = this.#p("candidates", `${id}.json`);
		const candidate = JSON.parse(await readFile(file, "utf8"));
		candidate.status = status;
		if (status === "confirmed" || status === "applied") candidate.confirmedAt = stamp();
		await this.#atomicWriteJson(file, candidate);
		const registry = await this.readRegistry();
		const entry = registry.candidates.find((item) => item.id === id);
		if (entry) entry.status = status;
		await this.#writeRegistry(registry);
	}

	// ================================================== 第三层：正式文风资产
	/** 发布候选：new-style/merge/split 建新档案 V*；version-upgrade/absorb 给已有档案加新版本。 */
	async publishCandidate(candidateId, { styleId, note } = {}) {
		const candidate = await this.readCandidate(candidateId);
		if (candidate.status !== "proposed" && candidate.status !== "confirmed") {
			throw new StoreError("E_CANDIDATE_STATE", `候选状态为 ${candidate.status}，不能发布`, "只允许 proposed / confirmed");
		}
		if (candidate.kind === "version-upgrade" || candidate.kind === "absorb") {
			return this.#publishVersionUpgrade(candidate, note);
		}
		return this.#publishNewStyle(candidate, styleId, note);
	}

	async #publishNewStyle(candidate, styleIdOpt, noteOpt) {
		const draft = candidate.proposed?.draft ?? {};
		const styleId = styleIdOpt ?? candidate.proposed?.targetStyleId ?? newId();
		if (!STYLE_ID_RE.test(styleId)) {
			throw new StoreError("E_INVALID_STYLE_ID", `styleId 必须是 UUID：${styleId}`, "不传或传 UUID");
		}
		const version = candidate.proposed?.draftVersion ?? "V1.0";
		if (!VERSION_RE.test(version)) throw new StoreError("E_INVALID_VERSION", `版本号不合法：${version}`, "形如 V1.0");
		const styleDir = this.#p("styles", styleId);
		if (existsSync(join(styleDir, "meta.json"))) {
			throw new StoreError("E_DUPLICATE_STYLE_ID", `正式档案已存在：${styleId}`, "换 UUID 或走 version-upgrade");
		}
		const now = stamp();
		const profile = {
			schemaVersion: SCHEMA_VERSION,
			id: styleId,
			name: draft.name ?? `文风 ${styleId.slice(0, 8)}`,
			category: draft.category ?? "",
			version,
			status: "published",
			createdAt: now,
			publishedAt: now,
			features: draft.features ?? { overall: "" },
			prompt: draft.prompt ?? "",
			combination:
				draft.combination ??
				(candidate.kind === "merge"
					? { parents: (candidate.members?.styleIds ?? []).map((id) => ({ id, version: null, weight: null })), mode: "merge" }
					: null),
			lineage: {
				builtFromCandidate: candidate.candidateId,
				mergedFrom: candidate.kind === "merge" ? (candidate.members?.styleIds ?? []) : [],
				splitFrom: candidate.kind === "split" ? (candidate.proposed?.targetStyleId ?? null) : null,
				absorbed: [],
			},
			history: [{ version, publishedAt: now, fromCandidate: candidate.candidateId, note: noteOpt ?? candidate.note ?? "" }],
		};
		const problems = validateAgainstSchema(this.#schemas["style-profile"], profile);
		if (problems.length > 0) {
			throw new StoreError("E_INVALID_STYLE", `正式档案校验未通过：${problems.join("；")}`, "修候选 draft 后重新建候选");
		}
		await mkdir(join(styleDir, "versions"), { recursive: true });
		await this.#writeJsonIfAbsent(join(styleDir, "versions", `${version}.json`), profile, "E_VERSION_EXISTS", "该版本已发布，不覆盖");
		const meta = {
			schemaVersion: SCHEMA_VERSION,
			id: styleId,
			name: profile.name,
			category: profile.category,
			tags: draft.tags ?? [],
			status: "active",
			currentVersion: version,
			createdAt: now,
			updatedAt: now,
		};
		await this.#writeJsonIfAbsent(join(styleDir, "meta.json"), meta, "E_DUPLICATE_STYLE_ID", "换 UUID 或走 version-upgrade");
		const sources = {
			schemaVersion: SCHEMA_VERSION,
			styleId,
			analyses: (candidate.members?.analysisIds ?? []).map((id) => ({ analysisId: id, contribution: "候选归一化来源", weight: null })),
		};
		await this.#atomicWriteJson(join(styleDir, "sources.json"), sources);
		const registry = await this.readRegistry();
		registry.styles.push({
			id: styleId,
			name: profile.name,
			category: profile.category,
			status: "active",
			currentVersion: version,
			createdAt: now,
			updatedAt: now,
		});
		await this.#writeRegistry(registry);
		await this.#markCandidate(candidate.candidateId, "applied");
		return {
			styleId,
			version,
			profileFile: join(styleDir, "versions", `${version}.json`),
			metaFile: join(styleDir, "meta.json"),
			sourcesFile: join(styleDir, "sources.json"),
		};
	}

	async #publishVersionUpgrade(candidate, noteOpt) {
		const target = candidate.proposed?.targetStyleId;
		if (!target || !STYLE_ID_RE.test(target)) {
			throw new StoreError("E_INVALID_STYLE_ID", `${candidate.kind} 必须指向已有档案的 UUID（proposed.targetStyleId）`);
		}
		const styleDir = this.#p("styles", target);
		const metaPath = join(styleDir, "meta.json");
		let meta;
		try {
			meta = JSON.parse(await readFile(metaPath, "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `正式档案不存在：${target}`);
		}
		const previousVersion = meta.currentVersion;
		const baseFile = join(styleDir, "versions", `${previousVersion}.json`);
		let base;
		try {
			base = JSON.parse(await readFile(baseFile, "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `基准版本快照读不了：${baseFile}`);
		}
		const draft = candidate.proposed?.draft ?? {};
		const version = candidate.proposed?.draftVersion ?? nextMinor(previousVersion);
		if (!VERSION_RE.test(version)) throw new StoreError("E_INVALID_VERSION", `版本号不合法：${version}`, "形如 V1.1");
		const now = stamp();
		const profile = {
			...base,
			version,
			status: "published",
			publishedAt: now,
			name: draft.name ?? base.name,
			category: draft.category ?? base.category,
			features: draft.features ?? base.features,
			prompt: draft.prompt ?? base.prompt,
			combination: draft.combination !== undefined ? draft.combination : (base.combination ?? null),
			lineage: {
				...(base.lineage ?? { builtFromCandidate: candidate.candidateId, mergedFrom: [], splitFrom: null, absorbed: [] }),
				absorbed: [...(base.lineage?.absorbed ?? []), { candidateId: candidate.candidateId, atVersion: version }],
			},
			history: [
				...(base.history ?? []),
				{ version, publishedAt: now, fromCandidate: candidate.candidateId, note: noteOpt ?? candidate.note ?? "" },
			],
		};
		const problems = validateAgainstSchema(this.#schemas["style-profile"], profile);
		if (problems.length > 0) {
			throw new StoreError("E_INVALID_STYLE", `新版本校验未通过：${problems.join("；")}`, "修候选 draft 后重新建候选");
		}
		await this.#writeJsonIfAbsent(join(styleDir, "versions", `${version}.json`), profile, "E_VERSION_EXISTS", "该版本已发布，不覆盖");
		meta.currentVersion = version;
		meta.updatedAt = now;
		await this.#atomicWriteJson(metaPath, meta);
		const registry = await this.readRegistry();
		const entry = registry.styles.find((item) => item.id === target);
		if (entry) {
			entry.currentVersion = version;
			entry.updatedAt = now;
		}
		await this.#writeRegistry(registry);
		await this.#markCandidate(candidate.candidateId, "applied");
		return { styleId: target, version, previousVersion, profileFile: join(styleDir, "versions", `${version}.json`) };
	}

	/** 从现有版本派生新版本候选（draft 由基准快照 + changes 合成）。 */
	async proposeVersion({ styleId, baseVersion, changes = {}, kind = "version-upgrade", analysisIds = [], note = "", method } = {}) {
		const styleDir = this.#p("styles", styleId);
		let metaObj;
		try {
			metaObj = JSON.parse(await readFile(join(styleDir, "meta.json"), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `正式档案不存在：${styleId}`);
		}
		const base = baseVersion ?? metaObj.currentVersion;
		let baseSnap;
		try {
			baseSnap = JSON.parse(await readFile(join(styleDir, "versions", `${base}.json`), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `基准版本快照不存在：${styleId} ${base}`);
		}
		if (kind !== "version-upgrade" && kind !== "absorb") {
			throw new StoreError("E_INVALID_CANDIDATE", `proposeVersion 只接受 version-upgrade / absorb，收到 ${kind}`);
		}
		const draft = {
			features: deepMerge(baseSnap.features ?? {}, changes.features ?? {}),
			prompt: changes.prompt ?? baseSnap.prompt ?? "",
			forbidden: changes.forbidden ?? baseSnap.forbidden ?? [],
		};
		if (changes.name !== undefined) draft.name = changes.name;
		if (changes.category !== undefined) draft.category = changes.category;
		if (changes.combination !== undefined) draft.combination = changes.combination;
		return this.createCandidate({
			kind,
			members: { analysisIds, styleIds: kind === "absorb" ? [styleId] : [] },
			commonFeatures: changes.commonFeatures ?? {},
			divergentFeatures: changes.divergentFeatures ?? {},
			proposed: { targetStyleId: styleId, draftVersion: nextMinor(base), draft },
			method: method ?? (analysisIds.length > 0 ? "external-chatgpt-deep-compare" : "local-api-assisted"),
			note,
		});
	}

	/** 归档：只改 meta.json 与 registry；任何版本快照都不动。 */
	async archiveStyle(styleId) {
		const metaPath = this.#p("styles", styleId, "meta.json");
		let meta;
		try {
			meta = JSON.parse(await readFile(metaPath, "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `正式档案不存在：${styleId}`);
		}
		meta.status = "archived";
		meta.updatedAt = stamp();
		await this.#atomicWriteJson(metaPath, meta);
		const registry = await this.readRegistry();
		const entry = registry.styles.find((item) => item.id === styleId);
		if (entry) entry.status = "archived";
		await this.#writeRegistry(registry);
		return { styleId, status: "archived" };
	}

	async readVersion(styleId, version) {
		try {
			return JSON.parse(await readFile(this.#p("styles", styleId, "versions", `${version}.json`), "utf8"));
		} catch {
			throw new StoreError("E_NOT_FOUND", `版本快照不存在：${styleId} ${version}`);
		}
	}

	async listVersions(styleId) {
		return (await readdir(this.#p("styles", styleId, "versions"))).filter((name) => name.endsWith(".json")).sort();
	}

	// ================================================== 整库导出 / 基础恢复
	/** 整库导出：目录级复制到 outDir，附 export-manifest.json（恢复时跳过该文件）。 */
	async exportAssets(outDir, { overwrite = false } = {}) {
		const target = resolve(outDir);
		if (existsSync(target)) {
			const entries = await readdir(target);
			if (entries.length > 0) {
				if (!overwrite) throw new StoreError("E_EXPORT_TARGET_EXISTS", `导出目录非空：${target}`, "换目录或 overwrite:true");
				await rm(target, { recursive: true, force: true });
			}
		}
		await mkdir(target, { recursive: true });
		await cp(this.#root, target, { recursive: true });
		const registry = await this.readRegistry();
		const manifest = {
			schemaVersion: SCHEMA_VERSION,
			kind: "writerx-style-assets-export",
			exportedAt: stamp(),
			sourceRoot: this.#root,
			counts: registry.counts,
		};
		await this.#atomicWriteJson(join(target, "export-manifest.json"), manifest);
		return { outDir: target, manifest };
	}

	/** 基础恢复：校验备份齐备 → 默认 dryRun 出计划 → 确认后逐顶层条目替换。 */
	async restoreAssets(backupDir, { dryRun = true } = {}) {
		const backup = resolve(backupDir);
		const registryPath = join(backup, REGISTRY_FILE);
		let registry;
		try {
			registry = JSON.parse(await readFile(registryPath, "utf8"));
		} catch {
			throw new StoreError("E_RESTORE_INVALID", `备份里没有可读的 registry.json：${backup}`);
		}
		for (const name of SCHEMA_FILES) {
			if (!existsSync(join(backup, "schema", name))) {
				throw new StoreError("E_RESTORE_INVALID", `备份缺少 schema/${name}：${backup}`);
			}
		}
		const entries = (await readdir(backup, { withFileTypes: true })).filter(
			(item) => item.name !== "export-manifest.json",
		);
		const plan = entries.map((item) => ({
			entry: item.name,
			action: existsSync(this.#p(item.name)) ? "replace" : "add",
		}));
		if (dryRun) return { dryRun: true, backup, plan, registryCounts: registry.counts };
		for (const item of entries) {
			const target = this.#p(item.name);
			await rm(target, { recursive: true, force: true });
			await cp(join(backup, item.name), target, { recursive: true });
		}
		const after = await this.readRegistry();
		return { dryRun: false, backup, restored: plan.length, counts: after.counts };
	}
}

// 小工具：dirname/basename 直接用 node:path 的话要再 import 两个名字，就地实现避免多余依赖
function dirname2(file) {
	const index = file.lastIndexOf("\\");
	const unix = file.lastIndexOf("/");
	return file.slice(0, index > unix ? index : unix) || file;
}
function basename2(file) {
	const index = file.lastIndexOf("\\");
	const unix = file.lastIndexOf("/");
	return file.slice((index > unix ? index : unix) + 1);
}

export { validateAgainstSchema as validateSchema, nextMinor as bumpMinorVersion };
