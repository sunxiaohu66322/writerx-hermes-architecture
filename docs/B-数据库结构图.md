# B · 数据库结构图（InkOS 长篇记忆与账本）

> 只读调查 · 2026-11-09 · 调查者 memory-specialist
> 所有结论标 `[事实]`（有文件/行号或实测输出）/`[推断]`（从证据推）/`[未验证]`（本轮没取到证据）
> 关键前提：**InkOS 1.8.0 里有两套互不相通的"记忆"**，上一阶段把它们混称"账本"，导致"全部测试书无 ledger.db"这个结论读起来像"记忆没落库"。实际上**主记忆库叫 `memory.db`，存在于三本真实书里**。

---

## 1. 一句话结论

| 层 | 库 | 位置 | 谁写 | 谁读 | 现状 |
|:--|:--|:--|:--|:--|:--|
| **A 官方记忆层** | `memory.db`（facts / chapter_summaries / hooks + FTS5） | `books\<id>\story\memory.db` | InkOS core：`runner.syncNarrativeMemoryIndex` / `retrieveMemorySelection` 自愈重建 | InkOS core：Composer（写下一章的上下文）、ChapterAnalyzer（章后分析）、Planner 材料 | **在工作**：v06 = 282 KB / v07 = 340 KB / v09 = 82 KB，实测检索 118 ms 命中 27 条 `[事实]` |
| **B 桥接账本层** | `ledger.db`（entity / resource / ledger / chapter_commit / fact / event） | `books\<id>\story\longform\ledger.db` | **只有** `inkos-bridge.mjs` 的 `-Op longform -Action commit` | 只有 bridge 自己的 `show` / `reconcile` | **旁挂**：一份真库只出现在 `_trash` 与 `.inkos\backups` 里，**没有任何 InkOS 代码读它** `[事实]` |

**核心命题的答案（详见 B-账本读写流程.md）**：
- 「写完一章记忆是否真保存？」→ **A 层：真保存**（磁盘上有 memory.db 实体 + 6/9 章摘要）`[事实]`
- 「下一章生成时是否真读到？」→ **A 层：真读到**（实测 `retrieveMemorySelection(ch8)` 返回 3 条摘要 + 4 条事实 + 8 条伏笔）`[事实]`
- **B 层（bridge 账本）：保存了也读不到** —— 它写进 `story/longform/`，而 Planner/Composer 的输入清单里没有这个目录 `[事实]`（`planning-materials.js:111-118`）

---

## 2. 总体结构（实际调用关系，不是设计图）

```
                        ┌──────────────────────────────────────────────┐
                        │ 权威层 = Markdown / JSON（唯一真值）          │
                        │  story/chapter_summaries.md  (章摘要·人可读)  │
                        │  story/current_state.md      (当前状态事实)   │
                        │  story/pending_hooks.md      (伏笔池)         │
                        │  story/volume_summaries.md   (卷摘要,可缺)    │
                        │  story/state/*.json          (结构化镜像)     │
                        └───────────┬──────────────────┬───────────────┘
                    读(权威) │                        │ 写(章后)
                        ┌───────────▼──────────┐   ┌─────▼─────────────────┐
                        │ Composer / Planner    │   │ ChapterAnalyzer       │
                        │ ChapterAnalyzer       │   │ (章后产摘要/状态/伏笔) │
                        └───────────┬──────────┘   └─────┬─────────────────┘
                                    │ 每章现算           │
                        ┌───────────▼────────────────────▼─────────────┐
                        │  A  memory.db  （派生投影，可删可重建）        │
                        │  facts(41) chapter_summaries(6) hooks(17)     │
                        │  + retrieval_documents(29) → FTS5(bm25)       │
                        │  重建时机：每次 retrieveMemorySelection 开头   │
                        │           + runner 每次阶段收尾               │
                        └───────────┬──────────────────────────────────┘
                                    │ BM25 top-32 → 再按业务权重截断
                        ┌───────────▼──────────────────────────────────┐
                        │ 模型上下文包（entries）：summary/fact/hook/vol│
                        └──────────────────────────────────────────────┘

     ┌──── 另一条独立的、不接入上面任何一步的线 ────────────────────────┐
     │  inkos-bridge.mjs  -Op longform -Action commit                    │
     │    ↓ 读 chapters/NNN*.md + story/state/*.json + character_matrix  │
     │  B  ledger.db（story/longform/）: entity/resource/ledger/         │
     │      chapter_commit/fact/event                                    │
     │    ↓                                                              │
     │  只有 bridge 的 show/reconcile 会读它；InkOS 侧零引用              │
     └───────────────────────────────────────────────────────────────────┘
```

---

## 3. 两条链的边界（为什么"账本推不进正史"）

`[事实]` InkOS 侧检索函数的输入清单（`inkos-core/dist/utils/planning-materials.js:111-118`）：

```js
join(seed.storyDir, "author_intent.md"),
join(seed.storyDir, "current_focus.md"),
join(seed.storyDir, "outline", "story_frame.md"),
join(seed.storyDir, "outline", "volume_map.md"),
join(seed.storyDir, "chapter_summaries.md"),
join(seed.storyDir, "book_rules.md"),
join(seed.storyDir, "current_state.md"),
join(seed.storyDir, "pending_hooks.md"),
```

**八个源 + brief.md + 上一章结尾摘录 = Planner 的全部输入。`story/longform/` 不在其中，`memory.db` 也不在其中。**
两条推论：
1. B 层账本**天生不会**影响写作 —— 它写多少章，下一章的提示词都不会因为"账上多了 3 条资源"而变化 `[事实]`（输入清单里没有它）。
2. A 层 memory.db 也**不是**上下文来源 —— 上下文来自 Markdown，DB 只是加速索引；所以"删掉 memory.db 全书照样写得下去" `[推断]`，只是慢一点。

> 这正好对上任务书里的设计约束「Markdown/InkOS 正史仍权威 / 数据库=可重建派生」—— **InkOS 官方本来就是这么设计的**（`memory-db.js:8-9` 注释原文："existing markdown truth files are still the primary persistence layer. MemoryDB is an acceleration index built alongside them."）。

---

## 4. 权威层级（谁覆盖谁，别搞反）

```
第 1 层（唯一真值）   story/*.md  + story/state/*.json
第 2 层（派生索引）   story/memory.db   ← 删了会自动重建（每次检索都重灌）
第 3 层（旁挂账本）   story/longform/ledger.db  ← InkOS 完全不认识，只能靠 bridge 自己读
```

三条硬证据：

| 断言 | 证据 |
|:--|:--|
| memory.db 是派生，检索时被重灌 | `memory-retrieval.js:44-45` `memoryDb.replaceSummaries(summaries); memoryDb.replaceCurrentFacts(facts);` |
| memory.db 删了能重建 | `runner.js:2558-2560` 删 `memory.db` / `-shm` / `-wal`，随后 `2641-2721` 由 `loadNarrativeMemorySeed` 重灌 |
| 同步失败不报错，只 warn | `runner.js:2646-2651` `catch → logWarn("叙事记忆同步已跳过")` |

---

## 5. 数据规模实测（三本真书 + 一份真账本）

`[事实]` 表行数来自 `node:sqlite` 只读打开后的 `COUNT(*)`：

| 库 | 文件大小 | chapter_summaries | facts | hooks | retrieval_documents | FTS5 |
|:--|--:|--:|--:|--:|--:|--:|
| `zhutian-v06/story/memory.db` | 282,624 B | 6 | 41 | 17 | 29 | 29 |
| `zhutian-v09/story/memory.db` | 81,920 B | 9 | 0 | 0 | 9 | 9 |
| `zhutian-v07/story/memory.db` | 339,968 B | （未逐表读，见 B-表结构字段说明） | | | | |
| `zhutian-v08/story/memory.db` | **不存在** | — | — | — | — | — |
| `_trash/…/bridge-iso-001/story/longform/ledger.db` | 65,536 B | 6 表：chapter_commit 2 / entity 6 / event 6 / fact 6 / ledger 1 / resource 2 | | | | |

`zhutian-v08` 没有 memory.db 的原因 `[推断]`：它只有 3 章且 `chapter_summaries.md` 只有 81 B（占位），从未跑过"章后分析 + 记忆同步"；而 v09 的 facts/hooks 为 0 说明**摘要路通了、事实/伏笔路没通**（两条路各自独立，见 B-账本读写流程 §4）。

---

## 6. 与上次 QA 结论的对照（哪些要改口径）

| 上次 QA 结论 | 本轮更正 | 证据 |
|:--|:--|:--|
| 全部测试书无 `ledger.db` | **口径要改**：无 ledger.db ≠ 无记忆。主记忆在 `memory.db`，三本有；`ledger.db` 是 bridge 自建的另一层，只在 `_trash`/`_backups` 留有一份 | 本报告 §5 文件清单 |
| planner 输入 9 文件不含 longform 产物 | **确认成立**，并补上原因：Planner 输入是 8 个 md（`planning-materials.js:111-118`），longform 目录不在清单里 | 同左 |
| 账本要文件路径、内联 JSON 静默记 0 | 确认（bridge 侧）：`a.ops` 直接当路径 `existsSync(opsFile)`，传内联串走到 `:473` 的空对象分支 → `ledger_ops: []` → 0 笔，但仍返回 `status: ok` | `inkos-bridge.mjs:451-473` |
| 推正史三面夹死 | 确认，且门槛在 bridge 侧写成硬闸门 `CANON_NOT_COMMITTED` | `inkos-bridge.mjs:399-405, 456-460` |

---

## 7. 未验证 / 边界

- `[未验证]` v07 的逐表行数没读（只看文件大小 340 KB）；需要时可补一条 COUNT 查询。
- `[未验证]` `retrieval_documents` 里 `kind='character'` 那 1 条文档的产出者没找到 —— `memory-retrieval.js:170-216` 的 `buildMemorySearchDocuments` 只产 summary/hook/fact/volume-summary 四种，不产 character。可能来自旧版本或 studio，本轮未定位。
- `[未验证]` 没跑过 `write next`（会真花钱），所以"写完一章 → 立即读下一章"的**同进程内**时序是靠 `runner.js` 的 `syncNarrativeMemoryIndex` 调用点推断的，不是端到端跑出来的。
- 本轮无内容改动：全部检索实验在 `D:\DSH_Cache\cache\tmp\lf-probe\` 下的**副本**上做。
- **一处必须如实交代的副作用**：为读表结构，我用 `node:sqlite` 以 `readOnly: true` 打开过原书 `memory.db`；
  WAL 模式下即使是只读写也能触碰 `-shm` 共享内存索引 —— 实测 `books\zhutian-v06\story\memory.db-shm`
  的 mtime 变成 `2026-11-09 18:35:41`，而 **`memory.db` 本体 mtime 仍是 `2026-11-06 15:53:08`、大小 282624 B 未变**。
  → 数据未被修改；`-shm` 是进程间共享的页索引，下次正常打开会自动重建。若 QA 要求"零接触"，这条要单独记账。
