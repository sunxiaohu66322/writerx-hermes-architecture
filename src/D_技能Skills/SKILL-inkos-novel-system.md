---
name: inkos-novel-system
description: 本机小说创作系统的统一入口（InkOS 主创作 + 长篇记忆层 longform + 旧拆书技法库 craft）。当用户问"本机小说系统有什么功能 / 现在有几本书 / 长篇记忆是否正常 / 帮我建一本小说 / 接着写下一章 / 查某本书写到哪了 / 用旧拆书技法辅助写作"时使用。所有操作都经 inkos-bridge.mjs 统一入口，无需用户提供脚本路径。Use for any request about the local novel-writing stack: listing books, writing the next chapter, checking longform memory health, building a new book, or attaching legacy craft cards.
---

# inkos-novel-system —— 本机小说系统统一入口

**一句话：所有小说相关操作都走一个脚本 `inkos-bridge.mjs`，它把 InkOS（主创作）、长篇记忆层（longform）、旧拆书技法库（craft）三件事合成一个入口。**

## 0. 三步开机（照做，不要问用户路径）

```powershell
$B = "G:\Users\Administrator\Documents\deepseek-harness\default-workspace\inkos-bridge"
node "$B\inkos-bridge.mjs" -Op doctor          # 体检：模型/项目/书/技法库/长篇层
node "$B\inkos-bridge.mjs" -Op books           # 列出全部作品（含 id / 状态 / 章数）
```

- **项目根** = `J:\SimonApp\AI-Workspace\InkOS-Test`（环境变量 `INKOS_PROJECT` 可覆盖）
- **书 id** 从 `-Op books` 的输出里取，**不要猜**（`jiulou-001`、`bridge-iso-001` 等）
- 返回统一 JSON：`status` ∈ `ok | approval_required | error`，`error_code` 见 `契约.md`

## 1. 能力清单（⬤ 可用 / ◐ 半自动 / ○ 未完成）

| 能力 | 状态 | 命令 |
|:--|:--|:--|
| 体检（模型链路、项目、书、库） | ⬤ | `-Op doctor` |
| 列作品 / 读单本状态 | ⬤ | `-Op books` / `-Op state -Book <id>` |
| 技法检索（2,778 张卡） | ⬤ 可用但不聪明 | `-Op craft -Query "父子 矛盾 钱 对白"` |
| 技法注入到某本书 | ⬤ | `-Op craft-inject -Book <id> -Query "..." --approve` |
| 建书 | ⬤ | `-Op book-create --name 书名 --genre 都市 --approve` |
| 写下一章（**付费**） | ⬤ | `-Op write -Book <id> -Count 1 --approve` |
| 章节审稿 / 批准 | ⬤ | `-Op review -Book <id> -Chapter N --approve` |
| 状态降级修复（**付费**） | ⬤ | `-Op recover -Book <id> -Chapter N --approve` |
| 写前合同（零成本） | ⬤ | `-Op longform -Book <id> -Action contract -Chapter N` |
| 章后记账（零成本，幂等） | ⬤ | `-Op longform -Book <id> -Action commit -Chapter N -Ops <json>` |
| 事实自动提取（零模型） | ⬤ | `-Op longform -Book <id> -Action extract -Chapter N` |
| 实体自动归一（含称号别名） | ⬤ | 包含在 extract / commit 里 |
| 双账本一致性检查 | ⬤ | `-Op longform -Book <id> -Action reconcile` |
| 账本总览 | ⬤ | `-Op longform -Book <id> -Action show` |
| 事实自动进正史 | ◐ | 只进 `explicit`；金额**必须人工确认**，不许脚本猜余额 |
| 实体自动入库 | ◐ | 矩阵已备案 + 本章点名 → 自动入；新挖人物 → `unresolved_entities` 待确认 |

## 1.1 事实提取的判定口径（2026-10-27 实测后收紧）

一条句子要进正史，必须同时满足：

| 档 | 判据 | 落点 |
|:--|:--|:--|
| **explicit** | 句内（引号外）点名 + 该名在 `character_matrix.md` 已备案 | 可进正史 |
| **inferred** | 主语继承自上一句，或人物是规则从正文新挖、矩阵未备案 | 进 `pending_confirmations` |
| **ambiguous** | 数值量级 <100（不是钱）、句首是代词「他/她」且上句主语是被提及的配角 | 进 `pending_confirmations`，不猜 |

三条硬规矩：
1. **金额换算按中文数字规则**（两万八=28000、十六万八=168000），不是字符串截取。
2. **引号内的名字不算金额归属人** —— 那是被提及者，不是账主。
3. **称谓词靠关系行解析**（`陈守义(父亲/…)` → 「父亲」指陈守义），不靠正文里谁提到了这个词。
4. 同一章内容变了要重记，必须显式 `-ForceRecommit`；否则返回 `chapter_already_committed`。

## 2. 哪些操作花钱、哪些必须审批

- **花钱**：`write`（一章约 4–14 万 token，10–20 分钟）、`recover`（3–8 万 token）、`plan`/`compose`/`review`（少量）。
- **零成本**：`doctor`/`books`/`state`/`craft`/`craft-inject`/`longform`（全部子动作）。
- **必须带 `--approve`**，否则返回 `status: approval_required`、`executed: false` —— **这不是失败，是"已请示未执行"**，取到用户同意后重发即可。
- 未获用户同意，**不得**调用任何花钱操作；也不得为了"看看效果"批量写章。

## 3. 状态降级（state-degraded）—— 必须停，不能绕

InkOS 给每章算完状态后会做校验。若某章被判 `state-degraded`：

- **下一章会被直接拒绝**（1 秒返回、0 token，报 `Latest chapter N is state-degraded`）。这不是卡死，是设计好的闸门。
- **唯一正确动作**：`-Op recover -Book <id> -Chapter N --approve`（官方 `write repair-state`，**只重建真值文件，不重写正文**）。
- **禁止**：用"重写整章"来绕（等于把钱重花一遍）、手工改 `manifest.json`、手改 `story/state/*.json`。
- 修复前置条件（缺一不可）：该章是**最新章**、`story/snapshots/<N-1>/current_state.md` 与 `pending_hooks.md` **存在**。
- 修完必须核：`chapters/index.json` 的 status、`manifest.lastAppliedChapter`、`story/state/current_state.json` 的 `chapter`、`longform reconcile`。

## 4. 长篇记忆层（longform）的边界

- **正史只有一份**：InkOS 自己的 `story/state/*.json`。`story/longform/ledger.db` 是**派生投影**（`projection_role: derived_read_models`），删了可按 `commits/NNN.json` 重放重建。
- **不许超前**：账本 commit 前会核 `manifest.lastAppliedChapter`；正史没提交成功、或该章仍降级 → 直接拒（`CANON_NOT_COMMITTED`）。
- **幂等**：`commit_id = ch{N}-{sha256(工件)[:12]}`，同章同内容重放 → `skipped_duplicate`，账目不动。
- **金额只吃结构化输入**（`{entity,key,op:set|add|sub,amount,evidence}`），**绝不从散文里猜**；`sub` 后为负会抛错并回滚整章。
- 账本超前/落后时用 `-Action reconcile` 看差异，**不要删账硬凑**。

## 5. 失败与恢复

| 症状 | 判据 | 动作 |
|:--|:--|:--|
| 写章很久没动静 | 有 `streaming` 日志行 | **等着**，一章 10–20 分钟是正常；bridge 超时已设 2400s |
| 1 秒返回、0 token | 报 `state-degraded` | 走 §3 修复 |
| `approval_required` | 缺 `--approve` | 取同意后重发，**不是故障** |
| `ENGINE_INTERNAL_ERROR` | InkOS 自身缺陷（如 `__discriminator__`） | 看 `data.raw`；模型档需 `use_legacy_chat_completions=true` |
| 账本 `CANON_NOT_COMMITTED` | 正史未提交 | 先修状态，再 commit |
| 技法检索不准 | 召回混杂 | 已知问题（旧库 `craft` 字段质量参差）；别现场调参，先写作 |

## 6. 选书 / 选项目

- 多本书时**必须显式 `-Book <id>`**，不传就落到默认或报错；**永远不要假设"就那一本"**。
- 别人的书（`jiulou-001` 等）**只读**；新实验用 `bridge-iso-001` 或 `book-create` 新建，**不要在生产书里试**。
- `inkos.json`（模型名单/激活档）**由一个会话独占维护**；其它会话只读，不写。

## 7. 机器可读能力清单

同目录 `capabilities.json`：每项含 `id / title / status / impl / entry / cost / approval / health / notes`。健康检查入口统一为 `-Op doctor`。
