# B · 表结构字段说明（两套库逐字段）

> 只读调查 · 2026-11-09 · 所有 DDL 来自 `sqlite_master` 实读，不是照抄源码注释
> 标记：`[事实]` 实读/实测 · `[推断]` 由代码推 · `[未验证]` 未取证

---

## 0. 两套库对照

| | A · `memory.db` | B · `longform/ledger.db` |
|:--|:--|:--|
| 全路径 | `books\<id>\story\memory.db` | `books\<id>\story\longform\ledger.db` |
| 建库代码 | `inkos-core/dist/state/memory-db.js:26-76`（+ `retrieval/local-search.js:101-146`） | `inkos-bridge/longform-proto.mjs:26-46`（`openLedger`） |
| 表数 | 4 实表 + 1 FTS5 虚表 + 4 FTS 影子表 | 6 表 |
| WAL | 是（`PRAGMA journal_mode = WAL`，`memory-db.js:31`） | 否（未设，默认 delete 模式）`[事实]`（无 `-wal` 文件伴随） |
| 权威性 | 派生索引，可删重建 | 派生账本，但**无人读** |
| 现状 | v06/v07/v09 有 | 仅 `_trash` / `.inkos\backups` 各留一份 |

---

## 1. A 层表结构（`memory.db`）

### 1.1 `facts` —— 带有效期的事实（核心表）

```sql
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,              -- 主语：常是 protagonist / 人物名
  predicate TEXT NOT NULL,            -- 谓语：当前冲突 / 当前目标 / 当前限制 / 主角状态 / 当前位置 …
  object TEXT NOT NULL,               -- 值（可长句）
  valid_from_chapter INTEGER NOT NULL,-- 从第几章起有效
  valid_until_chapter INTEGER,        -- 到第几章失效；NULL = 仍然有效
  source_chapter INTEGER NOT NULL,    -- 哪一章产生的
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_facts_subject ON facts(subject);
CREATE INDEX idx_facts_valid   ON facts(valid_from_chapter, valid_until_chapter);
CREATE INDEX idx_facts_source  ON facts(source_chapter);
```
`[事实]` DDL 与 `memory-db.js:36-45`、`:69-71` 完全一致；v06 实有 **41 行**。

**语义（关键）**：这是**时间区间事实表**，不是"最新值表"。旧事实不删，只把 `valid_until_chapter` 填上。
查询"第 5 章时某人知道什么"用 `getFactsAt(subject, 5)`（`memory-db.js:107-113`）：
`valid_from_chapter <= 5 AND (valid_until_chapter IS NULL OR valid_until_chapter > 5)`。

**过期由谁判**：`runner.js:2653-2701 rebuildCurrentStateFactHistory` —— 按章回放快照，
同一 `(subject,predicate)` 的 `object` 一变就 `invalidateFact(旧id, 当前章)`（`:2676-2679`）。
即**"事实过期"= 被新值顶掉，且留下历史**，不是自然语言里的"传闻被推翻"。

**已知副作用** `[推断]`：`memory-retrieval.js:45` 每次检索都 `replaceCurrentFacts(facts)`，
它先 `DELETE WHERE valid_until_chapter IS NULL` 再整批重插（`memory-db.js:138-143`），
所以**当前事实的 id 会每章轮换**，而历史行永久累积 → 表只增不减。长书要留意体积（v06 三章 41 行）。

### 1.2 `chapter_summaries` —— 每章六要素摘要

```sql
CREATE TABLE chapter_summaries (
  chapter INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  characters TEXT NOT NULL DEFAULT '',   -- 出场人物（逗号/顿号串）
  events TEXT NOT NULL DEFAULT '',       -- 事件
  state_changes TEXT NOT NULL DEFAULT '',-- 状态变化
  hook_activity TEXT NOT NULL DEFAULT '',-- 本章伏笔动作（埋/推进/回收）
  mood TEXT NOT NULL DEFAULT '',         -- 情绪基调
  chapter_type TEXT NOT NULL DEFAULT ''  -- 章型（推进/爆点/过渡…）
);
```
`[事实]` DDL = `memory-db.js:47-56`；v06 实有 6 行、v09 实有 9 行。

**它就是"记忆"的主载体**：下一章写什么，最先看的就是这几行（见 B-账本读写流程 §3）。
`hook_activity` 与 `state_changes` 是**文本而非外键** —— 所以摘要质量取决于"章后分析"那次模型调用的输出结构，格式一乱整条记忆就空转（v08 的 81 B 摘要就是这个下场）。

### 1.3 `hooks` —— 伏笔池（派生副本，非权威）

```sql
CREATE TABLE hooks (
  hook_id TEXT PRIMARY KEY,
  start_chapter INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',      -- open/progressing/pressured/resolved/deferred…
  last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
  expected_payoff TEXT NOT NULL DEFAULT '',
  payoff_timing TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_hooks_status ON hooks(status);
CREATE INDEX idx_hooks_last_advanced ON hooks(last_advanced_chapter);
```
`[事实]` DDL = `memory-db.js:58-67,72-73`（`payoff_timing` 是后加的，`ensureColumn` 兜 `:75`）；v06 实有 17 行。

**⚠ 这张表故意不被检索用** `[事实]` —— `memory-retrieval.js:32-35` 注释原文：
> "Hooks stay on the authority path instead of the SQLite acceleration path: the DB table intentionally stores only a small subset and cannot preserve promoted/core/dependency metadata, which is load-bearing for hook debt."

即 **hooks 表只存字段子集**（`coreHook`、`promoted`、`dependencies` 全丢），所以判定"该回收哪条伏笔"必须回读 `story/state/hooks.json` / `pending_hooks.md`。
→ 设计上：**hooks 表 = 快照留痕，不是真源**。改它不会影响任何判定。

### 1.4 `retrieval_documents` + `retrieval_documents_fts` —— 检索面（FTS5）

```sql
CREATE TABLE retrieval_documents (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,   -- 'summary:7' / 'hook:姚百川的掂量' / 'fact:4' / 'volume-summary:0'
  scope TEXT NOT NULL,         -- 'story-memory'（另有 archived-material / skill-reference 等复用同一内核）
  kind TEXT NOT NULL,          -- chapter-summary | hook | fact | volume-summary | character
  source TEXT NOT NULL,        -- 'story/chapter_summaries.md#7' 之类，可回溯
  title TEXT NOT NULL,         -- 已分词
  body TEXT NOT NULL,          -- 原文（给模型看）
  title_tokens TEXT NOT NULL,  -- 已分词（给 FTS 用）
  body_tokens TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,          -- sha256(kind\0source\0title\0body\0metadata)，用于增量跳过
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, document_id)
);
CREATE VIRTUAL TABLE retrieval_documents_fts USING fts5(
  title_tokens, body_tokens,
  content='retrieval_documents', content_rowid='rowid');   -- 外部内容表模式
```
`[事实]` DDL = `local-search.js:103-127`；三个触发器 `_ai/_ad/_au` 同步 FTS（`:129-144`）；v06 实有 29 行。

**增量写入**：`replaceScope`（`local-search.js:20-59`）先按 `content_hash` 比对，**哈希没变就跳过 upsert**（`:45-47`），再删掉本 scope 里已消失的 id（`:49-52`）。整段包在 `BEGIN IMMEDIATE` 里。

**实测分布**（v06 副本）`[事实]`：
```
chapter-summary 6 | character 1 | fact 6 | hook 16
```
> 注意：`fact` 只有 6 条进检索面，而 `facts` 表有 41 行 —— 因为送进检索的是**当前有效事实**（`valid_until IS NULL`），历史行不进索引。这是对的（历史事实不该干扰当前写作）。
> `character` 那 1 条来源未定位 `[未验证]`（`buildMemorySearchDocuments` 不产 character 类型）。

---

## 2. B 层表结构（`longform/ledger.db`）

`[事实]` 六表 DDL 与 `longform-proto.mjs:28-44` **逐字一致**，说明 bridge 用的就是这份原型 schema。
实有数据来自 `_trash/books/bridge-iso-001-…/story/longform/ledger.db`（65,536 B）。

### 2.1 `chapter_commit` —— 幂等锚点

```sql
CREATE TABLE chapter_commit (
  commit_id TEXT PRIMARY KEY,      -- 'ch002-<hash前12>'，格式见 longform-proto.mjs:79
  chapter INTEGER NOT NULL,
  artifact_hash TEXT NOT NULL,     -- 四工件的 sha256（键序无关规范化 JSON）
  applied_at TEXT,
  entries INTEGER,
  UNIQUE(chapter, artifact_hash)   -- 同章同内容只能有一条
);
```
实有 **2 行**（ch001、ch002）。
**幂等判据有两条，不是一条** `[事实]`：
1. `(chapter, artifact_hash)` 已存在 → `skipped_duplicate`（`longform-proto.mjs:80-81`）
2. 同章已有提交但哈希**不同** → `chapter_already_committed`，**不覆盖、不重扣**（`:83-93`），要强替必须显式 `--force-recommit`

> 这是本轮唯一见到"防重复扣账"做得比官方更严的地方。官方 memory.db 没有等价机制（它每次整表重灌，天然幂等）。

### 2.2 `entity` —— 实体与别名

```sql
CREATE TABLE entity (
  entity_id TEXT PRIMARY KEY,   -- 'ent-陈默'（名称去空白后拼）
  canonical TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]'   -- JSON 数组
);
```
实有 **6 行**。
**归一三档**（`longform-proto.mjs:48-68`，注释即规格）：
| 相似度 | 处置 | confidence |
|:--|:--|:--|
| 完全同名（去空白后） | 命中已有实体 | 1 |
| ≥ 0.8 | 自动并入 + 追加别名 | 实际相似度 |
| 0.5 – 0.8 | **挂 pending，不入库** | 实际相似度 |
| < 0.5 | 建新实体 | 0 |
相似度算法 `:69` = 字符集 Dice 系数 `2|A∩B| / (|A|+|B|)`（**不是**编辑距离，对中文同音/异体不敏感）。

### 2.3 `ledger` —— 账目流水（只增不改）

```sql
CREATE TABLE ledger (
  entry_id TEXT PRIMARY KEY,      -- '<commit_id>-led-<i>'
  commit_id TEXT NOT NULL,
  entity_id TEXT,
  key TEXT,                       -- 资源键：现金/负债/…
  op TEXT CHECK(op IN ('set','add','sub')),
  amount REAL NOT NULL,
  chapter INTEGER,
  evidence TEXT                   -- 证据句（正文原句）
);
```
实有 **1 行**。
流水是**审计用**，余额真值在 `resource` 表。`op` 有 CHECK 约束，写错值会直接 SQL 报错而不是静默。

### 2.4 `resource` —— 余额（确定性计算）

```sql
CREATE TABLE resource (
  entity_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  updated_ch INTEGER,
  PRIMARY KEY(entity_id, key)
);
```
实有 **2 行**（对应 v06 那本：今日收入 0 / 负债 28000 的同类结构）。
**计算规则**（`longform-proto.mjs:135-143`）：
```
set → value = amount
add → value = base + amount
sub → value = base - amount，且 next < 0 直接抛错「账本透支」
```
→ 这是**确定性算术**，不靠模型摘要。这一点是本层最有价值的资产（见 B-向量检索必要性评估 §4）。

### 2.5 `fact` —— 带有效期的事实（与 A 层同构，但独立）

```sql
CREATE TABLE fact (
  fact_id TEXT PRIMARY KEY,       -- '<commit_id>-fct-<i>'
  commit_id TEXT NOT NULL,
  subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
  valid_from INTEGER NOT NULL, valid_until INTEGER, source_chapter INTEGER NOT NULL
);
```
实有 **6 行**。
**过期机制与 A 层不同** `[事实]`：提交新事实时先 `UPDATE fact SET valid_until = 章号-1 WHERE subject=? AND predicate=? AND valid_until IS NULL AND valid_from < 章号`（`:122-124`），
即**新事实自动把旧传闻压成历史**，且 `valid_until` 填的是"新事实的前一章"（A 层填的是"发现变化的章"）。两者语义差 1 章，**如果将来合并两库必须先统一这条**。

### 2.6 `event` —— 事件流

```sql
CREATE TABLE event (
  event_id TEXT PRIMARY KEY,   -- '<commit_id>-evt-<i>'
  commit_id TEXT NOT NULL, chapter INTEGER NOT NULL,
  event_type TEXT, subject TEXT, object TEXT, evidence TEXT
);
```
实有 **6 行**。`event_type` 在自动提取下全是 `"auto"`，`subject`/`object` 常为空 —— 因为 `-Action commit -Ops auto` 只把规则命中的句子塞进 `evidence`（`inkos-bridge.mjs:468`），**没有实体化**。这正是上一阶段 QA 看到"第二章事件只剩半句"的原因 `[事实]`。

---

## 3. 字段级坑清单（改代码前必看）

| # | 坑 | 位置 | 后果 |
|:--|:--|:--|:--|
| 1 | `hooks` 表缺 `coreHook/promoted/dependencies` | `memory-db.js:58-67` + `memory-retrieval.js:32-35` | 若有人"以 DB 为准"改伏笔状态，会丢掉核心伏笔标记 |
| 2 | `replaceCurrentFacts` 每次 DELETE+重插 | `memory-db.js:138-143` | fact id 不稳定，任何"按 fact id 引用"的外部逻辑都会失效 |
| 3 | 两库 `valid_until` 语义差 1 章 | A:`runner.js:2677` 用"当前章"；B:`longform-proto.mjs:124` 用"章号-1" | 合并时区间查询结果会偏移 |
| 4 | `resource.op` 有 CHECK，`ledger.op` 也 CHECK | `longform-proto.mjs:35` | 写 `'increase'` 之类会整笔失败（好事，但要求调用方枚举对齐） |
| 5 | `entity_id` 由名称拼成（`ent-陈默`） | `longform-proto.mjs:65` | 改名 = 新实体；改名类剧情会让账本断链 |
| 6 | WAL 模式下 `-shm`/`-wal` 必须一起删 | `runner.js:2558-2560` | 只删 `.db` 会留下脏 WAL，重开可能回放旧数据 |
| 7 | commas/顿号混用无约束 | `chapter_summaries.characters` 是自由文本 | `getSummariesByCharacters` 用 `LIKE '%名%'`（`memory-db.js:177-194`），短名会误命中（如"姚"命中"姚乐儿"） |

---

## 4. 未验证

- `[未验证]` v07 逐表行数（只读了文件大小）。
- `[未验证]` `retrieval_documents.kind='character'` 的生产者。
- `[未验证]` FTS5 是否启用了 ICU 分词器（DDL 里没写 `tokenize=`，走默认 `unicode61`；中文靠代码层喂 bigram 解决 —— 见 `local-search.js:185-195`）。
- 本轮未对任何库执行写操作；v06 的实验全部在 `D:\DSH_Cache\cache\tmp\lf-probe\book\` 副本上。
