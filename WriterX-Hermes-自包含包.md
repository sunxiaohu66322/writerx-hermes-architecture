# WriterX Hermes（改编版）· 自包含包

> **本文件自包含，不需要联网、不要尝试打开任何链接。** 你拿到的这一个文件就是全部：六件套全文 + 全部说明文档 + 关键源码索引（带行号）+ 交付说明。
> 开头不要回复「读不到链接」「没有仓库读取连接」——完全以本附件为准。
> 用途：读懂这套系统「是什么 / 由哪几层组成 / 数据怎么流 / 现在做到哪一步 / 哪些还没做 / 怎么改」，然后给升级建议。
> 同名内容也在 GitHub 仓库 `sunxiaohu66322/writerx-hermes-architecture`（PUBLIC），但**本文件已含全部要点，离线可读**。

## 目录

1. README.md（仓库总览）
2. llms.txt（全文索引）
3. 00_读我_AI-FIRST.md（第一站 / 包里没有什么）
4. 01_架构.md（五层结构 / 数据流 / 端口 / 扩展点）
5. 02_现状与边界.md（改了什么 / 已知问题 / 未验证）
6. 03_怎么改.md（逐文件六步 + 验收 + 回滚）
7. 03_数据库结构.md（DDL，无数据行）
8. 04_接口清单.md（源码抓取，未逐条验证）
9. 05_文件清单.md
10. 06_核心文件导航.md
11. 关键源码索引（带行号）
12. 初始版上传交付说明
13. 提建议四条格式

---

## README.md（仓库总览）

# WriterX Hermes（改编版） · 架构快照仓库

> **初始版 v1**｜由 DSH skill `github-project-push` 上传｜用途：给看不到本机、打不开端口的外部 AI（ChatGPT / Claude / 其它）读懂这套系统「是什么 / 由哪几层组成 / 数据怎么流 / 现在做到哪一步 / 哪些还没做 / 怎么改」。
> 这是**结构化架构快照**，不是可直接运行的部署包，也不是完整源码压缩包。上传时原安装目录 `H:\新建文件夹\WriterX Hermes` 一个字节未改。

## 0 · 版本记录（第三方 AI 请先读这里）

- [CHANGELOG.md](CHANGELOG.md) —— 每一次改了什么、为什么改、改动落在哪些文件，**从最新一条往下读即看全历史**
- [VERSIONS.md](VERSIONS.md) —— vN 索引表（时间 / 说明 / 基线 commit / 改动数）
- 看某一版完整差异：`git show v1`，或 GitHub 的 `/commits/v1` 页
- 版本规则：每次同步 = 远端历史之上 **1 个新 commit + 1 个 annotated tag `vN`**，绝不清空历史、绝不 force push
- `raw.githubusercontent.com` 有 CDN 缓存，刚推完几分钟内可能读到旧版；确认最新版看仓库网页 / `/tags` 页 / `git show <tag>`

## 1 · 一句话结论

**WriterX Hermes = DSH（DeepSeek Harness）引擎的 Electron 套壳**，跑在 Windows 本机上的 AI 长篇小说写作工作台。引擎本体完整内嵌（`@deepseek-ai/*` 229 包 + `@writerx/*` 33 包），**产品层被改的是收费闸门（会员判定）、预设开关（能力禁用）、模型/搜索 provider 选择**，并融合了 InkOS/LinkOS 书库、novel-studio 系列技能与 9136 场景推演。写作走候选制：模型产出候选稿，作者采用才进正史。

不是从零写的小说软件；不要按「自研应用」去理解它。

## 2 · 五层真源（改动落点是本仓库最要紧的一件事）

| 层 | 真源位置 | 职责 | 仓库内对应 |
|:--|:--|:--|:--|
| **A 引导器 / 壳** | `H:\新建文件夹\WriterX Hermes\resources\app.asar`（签名件，只读） | 单实例锁、选 build、记账、import 载荷 | `src/A_引导器壳/` |
| **B 产品壳** | `H:\...\app\1007\app.asar` | 起 dsh web server 子进程（端口 **3876**）、URL token 换 HttpOnly cookie、Hub 会话 | `src/B_产品壳/` |
| **C 内嵌 DSH 引擎** | `H:\...\app\1007\dsh\node_modules` | 完整 DSH agent 引擎 | **不搬**（体积 / 依赖），结构见 `01_架构.md` |
| **D 用户 Profile** | `F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\` | `cordis.patch.yml` + `@local/` 三插件 + `skills\`（junction → `I:\DSHHome\skills`） | `src/D_用户Profile/`、`src/D_插件/`、`src/D_技能Skills/` |
| **E 融合模块** | 9136 推演 / InkOS 书库 / 主书库 / 工程文档 | 场景推演、书库合并（J: `books` → F: 主书库 junction）、能力补齐施工记录 | `docs/`、`03_数据库结构.md`、`04_接口清单.md` |

**端口口径**：`3876` = WriterX web（需 token）｜`9136` = 生产场景推演（在跑）｜`9137` = 隔离推演副本（当前停，而插件 baseUrl 指向它 → 此刻 plan/check/apply 必 `E_SERVICE_DOWN`）。

## 3 · 根目录怎么读（六件套 + 索引）

| 文件 | 读它做什么 |
|:--|:--|
| [00_读我_AI-FIRST.md](00_读我_AI-FIRST.md) | **外部 AI 第一站**：五真源表、读的顺序、一句话结论、边界、「包里没有什么」、提建议四条格式 |
| [01_架构.md](01_架构.md) | 五层结构、启动与数据流、端口、扩展点 —— **只看架构读这份就够** |
| [02_现状与边界.md](02_现状与边界.md) | 当前改了什么、已知问题 5 条、没做完的事、未验证 / 未取得 |
| [03_怎么改.md](03_怎么改.md) | 逐文件六步改法 + 验收命令 + 回滚 |
| [03_数据库结构.md](03_数据库结构.md) | 全部表 DDL + 表数（**不含任何业务行**）；生产库未定位已如实标注 |
| [04_接口清单.md](04_接口清单.md) | 源码字符串抓的 `/api/*` 与路由 —— **未逐条请求验证，别当可用清单** |
| [05_文件清单.md](05_文件清单.md) | 离线包 47 文件 + 大小（只统计离线快照那部分，不含仓库导航与版本文件） |
| [06_核心文件导航.md](06_核心文件导航.md) | 20 个关键文件，各一句职责（带真实行号） |
| [llms.txt](llms.txt) | 全文索引 + 关键源码 / 报告链接，机器友好 |
| [WriterX-Hermes-自包含包.md](WriterX-Hermes-自包含包.md) | **无需联网的单文件全文**（对方打不开链接时直接把这个当附件发） |
| [给外部AI的开场话术.txt](给外部AI的开场话术.txt) | 复制给对方的首轮提示词（含 3 条具体任务） |

`src/` = A/B/D 三层已脱敏源码原文｜`docs/` = 审计 / 施工 / QA / 用户说明原版（已脱敏）｜`_MANIFEST.json` = 机器可读清单。

> 本仓库 = **离线包 47 文件** + 仓库导航（`README.md` / `llms.txt` / `03_怎么改.md` / 自包含包 / 话术）+ 版本记录（`CHANGELOG.md` / `VERSIONS.md`）。离线包里的 `00_读我` 说「只能读附件」，在这个仓库里同样成立 —— 只是附件换成了仓库文件。

## 4 · 真数据与红线（别误读）

- **配置只给字段名与结构、不给值**；密钥 / Token / Cookie / 密码 / 会话串 / 私钥的**值**一律 `===REDACTED===`。字段名保留不算泄漏。
- **数据库只给 DDL 与表名，不给任何业务行**；没有执行过 `SELECT` 业务数据。
- `04_接口清单.md` 是**字符串抓取**，未逐条请求验证；`HTTP 200 ≠ 通过`。
- 结论分级：**已实测** / **已落地(需重启)** / **仅安装** / **仅设计** / **未验证** / **未取得**。请勿把「未取得」读成「不存在」。
- **「未收」≠「不存在」**：`node_modules`、`dist/`、`build/`、缓存、`*.bak-*`、探针、图片视频、模型权重、完整小说正文、聊天原文、`.credentials.yaml`、`Network\Cookies`、`server.log` token 行、`sessions\*.jsonl.zstd`、`storages\session_projcache\*.json` 全部按硬约束有意排除。详见 `00_读我_AI-FIRST.md`「包里没有什么」。
- **`InkOS` / `LinkOS` / `9136` / `novel-studio` / `axu-novel` / `linkos-novel` 是本项目合法组成**，不是串台。
- 技能补全触发符是 **`/` 不是 `@`**；且**没有叫「LinkOS」的技能**（只有 `linkos-novel` / `inkos-novel-system` / `novel-studio` / `axu-novel`）。`docs/` 里 11-10 凌晨的旧文档写「输入 `@` 调技能」已被当天 P3/P4 实测更正，保留原版仅作历史证据。
- 联网搜索「会员专享」是 **Hub 服务端返回**，本构建只有 `writerx-hub` 一个 provider，本地改不动。
- 插件 `ui-settings-plugins` / `ui-plugin-manager` 在产品 patch 里 `disabled`；插件本体活着但管理页被关。

## 5 · 已知缺口（初始版，不是验收通过）

1. `9137` 无监听而 `dsh-scene9136` 的 baseUrl 指向它 → 界面调 plan/check/apply 当前必失败。
2. `check/apply` 未逐个界面真调；apply 卡在「人工 approval 文件」，Agent 不能自批，无界面确认入口。
3. InkOS 检索链未进界面写作上下文（实测注入走 md 档案而非 `memory.db`/FTS5）；生产 `memory.db` / `ledger.db` 合并后**未定位** —— `03` 的 DDL 取自隔离副本。
4. 用户原问题「界面看不到」的真正解决（新增 `linkos` 技能 / 覆盖 `disabled`）**都未实施**，判为未完成。
5. 启动方式脆弱：只有 `explorer` 双击 `.lnk` 能起；直接 Start-Process exe 撞 `main.mjs:275` 单实例锁秒退且零日志。
6. 生产 9136 服务源码未取得（抓到的是 9137 隔离副本 `服务.py`，同源基线但非同一运行实例）；3876 全量页面需 token，未取得。

完整清单见 `02_现状与边界.md` §4–§5 与 `docs/P4-独立QA结果与残留缺口.md`（R1–R10）。

## 6 · 怎么跑 / 怎么改

**这不是可部署包**：没有 `package.json` 可 `npm install`，没有可执行入口。要在本机运行，用原来的桌面快捷方式（`explorer` 双击 `.lnk`）启动 `WriterX Hermes.exe`。

**一切可改项在 D 用户 Profile 层**（`cordis.patch.yml` 的 `- id:` / `- insert:` 行、`@local/` 插件包、`skills\` 根、用户预设行）。**H: 签名安装件不可改**：有完整性校验 + 自更新回滚，改了会被覆盖或触发回滚。逐文件六步、验收命令与回滚见 [03_怎么改.md](03_怎么改.md)。

## 7 · 提建议时请说明（给外部 AI 的四条格式）

1. **依据哪个文件**（`01_架构.md` / `src/xxx` / `docs/xxx` / `02_现状与边界.md`）
2. 说的是**现有能力**还是**需要新增**
3. **改动落在哪一层**：A 引导器 / B 产品壳 / C 内嵌引擎 / D 用户 Profile（含插件·技能）/ E 融合模块（9136·书库）
4. 若建议改 `node_modules/`、`dist/`、`H:` 签名安装件 → 挂点选错，应回到 D 层

## 8 · 脱敏与排除

推送前对全部纳入文本文件做密钥正则终检（`_GITHUB_MANIFEST.json` 的 `secret_hits` 必须为 `0`）；凭据只从本机 `gh` keyring 现取，**仓库内不含任何令牌**。远端 tree 另做一次登录态 / 凭据路径核验，命中必须为 0。详见 `_GITHUB_MANIFEST.json` 与 `CHANGELOG.md` 每版的「密钥终检」字段。

---

## llms.txt（全文索引）

# WriterX Hermes（改编版） · 全文索引（llms.txt）

> 本仓库是 **DSH 引擎 Electron 套壳** 的结构化架构快照，给外部 AI 读懂全貌并指导升级。不是可运行部署包。
> **版本记录先看**：[CHANGELOG.md](CHANGELOG.md) · [VERSIONS.md](VERSIONS.md)（`git show vN` 看某版完整 diff）。

## 读法（按顺序）

1. [00_读我_AI-FIRST.md](00_读我_AI-FIRST.md) —— 第一站：五真源表、读序、边界、包里没有什么、提建议四条格式
2. [01_架构.md](01_架构.md) —— 五层结构 / 启动与数据流 / 端口 / 扩展点（**只看架构读这份**）
3. [02_现状与边界.md](02_现状与边界.md) —— 改了什么 / 已知问题 / 没做完 / 未验证 / 未取得
4. [03_怎么改.md](03_怎么改.md) —— 逐文件六步 + 验收命令 + 回滚
5. [03_数据库结构.md](03_数据库结构.md) —— 全表 DDL + 表数（无数据行）
6. [04_接口清单.md](04_接口清单.md) —— 源码抓的路由（**未逐条验证**）
7. [06_核心文件导航.md](06_核心文件导航.md) —— 20 个关键文件各一句职责
8. [05_文件清单.md](05_文件清单.md) —— 离线包 47 文件 + 大小
9. [WriterX-Hermes-自包含包.md](WriterX-Hermes-自包含包.md) —— 无需联网的单文件全文
10. [给外部AI的开场话术.txt](给外部AI的开场话术.txt) —— 复制给对方的首轮提示词

仓库根导航：[README.md](README.md)（总览 / 六层目录 / 真数据 / 红线 / 怎么跑）。

## 分层源码（已脱敏，按真源层）

- `src/A_引导器壳/`：main.mjs（单实例锁 :275、import 载荷 :250）· launch.mjs（选 build + 记账）· verify.mjs（完整性）· state-file.mjs · package.json
- `src/B_产品壳/`：main.js（spawn 3876 / token→cookie / Hub 会话，96KB）· hub-membership.mjs · hub-profile-patch.mjs · runtime-env.mjs
- `src/D_用户Profile/`：cordis.patch-脱敏.yml（3 plugins insert + `id: web` 行）· hermes-profile.package.json（3 bundles）
- `src/D_插件/`：dsh-scene9136.index.js（4 工具 + readApproval 硬闸门）· dsh-inkos-bridge.index.js（6 工具）· dsh-inkos-panel.lib.index.js（host 半路由）· dsh-inkos-panel.client.js（浏览器半）· 各 package.json
- `src/D_技能Skills/`：SKILL-novel-studio.md · SKILL-linkos-novel.md · SKILL-inkos-novel-system.md · SKILL-axu-novel.md
- **C 内嵌 DSH 引擎不搬**（`node_modules` 229+33 包），结构见 01_架构.md

## 施工 / 审计 / QA 原版（docs/，已脱敏）

- `docs/P1-框架差异与付费墙地图.md` —— 与沟通端 DSH 逐条 diff + 三类付费墙 + 三档边界
- `docs/P2-能力补齐落地.md` · `docs/P2-B2-用户预设行片段.md` —— 唯一实改（cordis.patch.yml +30 行）
- `docs/P3-界面可见性与调用清单.md` —— `/` 触发符实测、21 技能、可见性方案（未实施）
- `docs/P4-独立QA结果与残留缺口.md` —— 独立 QA 判定 + R1–R10
- `docs/00-团队共用底稿.md` · `docs/00-审计最终报告.md` · `docs/V1-真实界面最终验收.md`
- `docs/B-表结构字段说明.md` · `docs/B-数据库结构图.md` · `docs/记忆系统审计.md` · `docs/写作Skill审计.md`
- `docs/系统模块清单与边界.md` · `docs/整体协同调用链.md` · `docs/插件接口摘要.md` · `docs/用户操作指南.md` · `docs/问题与缺口清单.md`

## 关键事实速查

- WriterX **是 DSH 套壳**：引擎完整，被改的是收费闸与预设开关。
- 五层真源：A 引导器（H: 签名件只读）/ B 产品壳（3876）/ C 内嵌引擎（不搬）/ **D 用户 Profile（一切可改项）** / E 融合模块（9136·书库）。
- 端口：3876 web（需 URL token 换 HttpOnly cookie）｜9136 生产推演在跑｜9137 隔离副本**停**（插件 baseUrl 指向它 → 当前 plan/check/apply 必 `E_SERVICE_DOWN`）。
- 技能触发符 **`/` 非 `@`**；无「LinkOS」技能；联网搜索「会员专享」= Hub 服务端返回，本构建仅 `writerx-hub` 一个 provider。
- 书库已物理合并（J: `books` → F: 主书库 junction）；生产 `memory.db`/`ledger.db` **未定位**。
- 三能力曾联合产出**一次候选稿并保存**（候选级，非正史），不是「日常可无干预连续创作」验收结论。

## 红线 / 别误读

- 配置只给字段名与结构、**不给值**；密钥值全部 `===REDACTED===`；数据库只给 DDL、不给业务行。
- `04_接口清单.md` 是字符串抓取、未逐条验证；`HTTP 200 ≠ 通过`、`文件存在 ≠ 界面可见`、`代码存在 ≠ 已调用`、`候选 ≠ 正史`。
- **「未收」≠「不存在」**、「未取得」≠「没有」，详见 00_读我「包里没有什么」。
- `InkOS` / `LinkOS` / `9136` / `novel-studio` / `axu-novel` / `linkos-novel` 是本项目合法组成，不是串台。
- 提建议请按 00_读我四条格式：依据哪个文件 / 现有能力还是需新增 / 改动落在哪一层 / 别把挂点选到 H: 签名件或 node_modules。

## 脱敏与排除

推送前密钥正则终检（`_GITHUB_MANIFEST.json` 的 `secret_hits` = 0），远端 tree 登录态/凭据路径核验 = 0。凭据只从本机 `gh` keyring 现取，仓库内不含任何令牌。

---

## 00_读我_AI-FIRST.md（第一站 / 包里没有什么）

# WriterX Hermes · 整套项目包（发给外部 AI 的第一站）

> 打包时间：2026-11-10 21:00:57　|　用途：让看不到本机、打不开端口、只能读附件的外部 AI 读懂本项目
> 「是什么 / 由哪几层组成 / 数据怎么流 / 现在做到哪一步 / 哪些还没做」
> 生成方式：磁盘实测 + ASAR 解包 + 源码字符串抓取 + 自动脱敏。密钥值一律 `===REDACTED===`。
> **本包是架构说明书，不是调查报告、不是设计方案、不是源码压缩包。**

## 这是什么

**WriterX Hermes** = 一台 Windows 本机上的 **AI 长篇小说写作工作台**，本质是
**DSH（DeepSeek Harness）引擎的 Electron 套壳**：引擎本体完整内嵌，产品层改的是
**收费闸门（会员判定）、预设开关（能力禁用）、模型/搜索 provider 选择**，
并融合了两套长篇写作体系：**InkOS / LinkOS 书库与账本** + **novel-studio 系列技能**
+ **9136 场景推演服务**。写作走「候选制」：模型产出候选稿，作者采用才进正史。

## 为什么有这个包

本机 3876 端口需要 URL token 换 HttpOnly cookie 才能进，外部 AI 打不开；9136 也只有本机回环。
这个包把**五个真源**的结构、关键源码（已脱敏）、数据字典、接口清单、当前进度与缺口收齐，
外部 AI 只读附件即可理解全貌，不必连本机。

## 五个真源（都要在包里讲清）

| 层 | 真源位置 | 职责 | 包内对应 |
|:--|:--|:--|:--|
| **A 引导器/壳** | `H:\新建文件夹\WriterX Hermes\resources\app.asar`（签名件，只读） | 单实例锁、选 build、记账、import 载荷 | `src/A_引导器壳/` |
| **B 产品壳** | `H:\新建文件夹\WriterX Hermes\app\1007\app.asar` | 起 dsh web server 子进程（**端口 3876**）、URL token 换 HttpOnly cookie | `src/B_产品壳/` |
| **C 内嵌 DSH 引擎** | `H:\新建文件夹\WriterX Hermes\app\1007\dsh\node_modules`（`@deepseek-ai/*` 229 包 + `@writerx/*` 33 包） | 完整 DSH agent 引擎 | 不搬（体积/依赖），见 `01_架构.md` |
| **D 用户 Profile** | `F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\`（含 `dsh-home\`） | `cordis.patch.yml` + `@local/` 三插件 + `skills\`（junction → `I:\DSHHome\skills`） | `src/D_用户Profile/`、`src/D_插件/`、`src/D_技能Skills/` |
| **E 融合模块** | 9136 推演服务 / InkOS 书库 / 主书库 / 工程文档 | 场景推演 + 书库合并 + 能力补齐施工记录 | `docs/`、`02/03/04` |

- **主书库**：`F:\Users\Administrator\Documents\WriterX\作品`
- **有意融合的 InkOS 书库**：`J:\SimonApp\AI-Workspace\InkOS-Test`，其中 `books` 已是 **junction → F: 主书库**
- **工程文档根**：`G:\Users\Administrator\Documents\deepseek-harness\default-workspace`

**端口口径**：`3876` = WriterX web ｜ `9136` = 生产场景推演（在跑）｜ `9137` = 隔离推演副本（当前停）。
另有一套**独立的沟通端 DSH 安装**，端口与本机不在本包讨论范围，包内不写、不混。

## 读的顺序

1. `01_架构.md` —— 结构、数据流、入口、端口、扩展点（**只看架构读这份就够**）
2. `02_现状与边界.md` —— 当前改了什么、已知问题、没做完的事、未验证项
3. `03_数据库结构.md` —— 全部表 DDL + 表数（**不含任何数据行**）
4. `04_接口清单.md` —— 从源码抓的 `/api/*` 与路由
5. `06_核心文件导航.md` —— 点名 10–20 个关键文件
6. `src/` —— 分层后的源码原文（已脱敏），按 A/B/D 真源层建子目录
7. `docs/` —— 项目自带审计 / 施工 / QA / 用户说明 原版（已脱敏）
8. `05_文件清单.md` —— 包内全部文件与大小；`_MANIFEST.json` —— 机器可读清单

## 一句话结论

- WriterX **是 DSH 套壳**：引擎本体完整，被改的是收费闸与预设开关；不是从零写的小说软件。
- **技能补全触发符是 `/` 不是 `@`**；且**没有叫「LinkOS」的技能**——实际是 `linkos-novel` / `inkos-novel-system` / `novel-studio` / `axu-novel`。
- 联网搜索「会员专享」是 **Hub 服务端返回**，本构建只有 `writerx-hub` 一个 provider，本地改不动。
- 插件 `ui-settings-plugins` / `ui-plugin-manager` 在产品 patch 里 `disabled`；插件本体活着但管理页被关。
- 书库已物理合并（J:→F: junction）；生产 InkOS `memory.db` / `ledger.db` 合并后**未定位**（见 `03`）。
- 三大能力曾联合产出**一次候选稿并保存**（候选级，非正史），尚不是「日常可无干预连续创作」的验收结论。

## 边界（别误读）

- 这是**架构 + 现状快照**，不是「系统已验收通过」；打包完成 ≠ 功能可用。
- `InkOS` / `LinkOS` / `9136` / `novel-studio` / `axu-novel` / `linkos-novel` 都属**本项目合法组成**，不是串台。
- 配置只给**字段名与结构、不给值**；数据库只给 **DDL 与表名、不给业务行**；密钥值全部 `===REDACTED===`。
- `04_接口清单.md` 是**字符串抓取，未逐条请求验证，别当可用清单**。
- 结论分级：**已实测** / **仅代码存在** / **仅设计完成** / **尚未验证** / **未取得**，请勿把后者读成「没有」。
- **时效更正**：`docs/` 里 11-10 凌晨的旧审计/操作指南写「输入 `@` 调技能」，**已被当天 P3/P4 实测更正为 `/`**（`@` 是文件/上下文引用）。以 `00`/`01` 与 `docs/P3-界面可见性与调用清单.md` 为准；旧文档保留原版仅作历史证据。

## 包里没有什么（防止把「未收」当成「不存在」）

| 未收 | 为什么未收 | 「0 / 未取得」是什么意思 |
|:--|:--|:--|
| `node_modules` 整体、`dist/`、`build/`、缓存、`__pycache__`/`*.pyc` | 依赖与编译产物不是项目信息，且体积巨大 | 包内 0 命中 = 有意排除，不是本地没有 |
| `*.bak-*` / `_backup-*` / `_snapshot-*` / `_验_*`/`_查_*`/`_探_*` 探针 | 历史备份与临时探针，会污染结论 | 0 命中 = 剔除，不代表本机无备份 |
| 图片 / 视频 / 模型权重 / 完整小说正文 / 聊天原文 | 大体积素材与业务数据，不是架构信息 | 0 命中 = 未收，不是不存在 |
| `.credentials.yaml`、`Network\Cookies`、`server.log` 原文、`sessions\*.jsonl.zstd`、`storages\session_projcache\*.json` | **含密钥 / cookie / 会话串 / 聊天原文，一个字节都不进包** | 这些文件本机存在（或曾在），只是本包一律不收 |
| API Key / Token / Cookie / 密码 / 会话串 / 私钥的**值** | 脱敏硬约束 | `===REDACTED===` = 该处原本有值，被替换；字段**名**保留不算泄漏 |
| 生产 `memory.db` / `ledger.db`、完整 9136 服务源码、3876 全量页面 | 合并后生产库**未定位**；服务源码抓到的是 9137 隔离副本；页面需 token | **「未取得」≠「没有」**：见 `03_数据库结构.md` 与 `04_接口清单.md` 的原因说明 |

## 想给建议时请说明

- **依据哪个文件**（`01_架构.md` / `src/xxx` / `docs/xxx` / `02_现状`）
- 说的是**现有能力**还是**需要新增**
- **改动落在哪一层**：A 引导器 / B 产品壳 / C 内嵌引擎 / D 用户 Profile（含插件·技能）/ E 融合模块（9136·书库）
- 若建议改 `node_modules/`、`dist/`、`H:` 签名安装件，那是挂点选错：H: 有完整性校验 + 自更新回滚，一切可改项在 **D 用户 Profile 层**

---

## 01_架构.md（五层结构 / 数据流 / 端口 / 扩展点）

# 01 · 架构（结构、数据流、入口、端口、扩展点）

> 只看架构读这份就够。证据来自 `src/` 内已脱敏源码原文与 `docs/` 审计报告；分级见文末。

## 1. 五层结构（真源 → 职责 → 实体）

| 层 | 目录 / 实体 | 干什么 |
|:--|:--|:--|
| **A 引导器/壳** | `resources\app.asar` → `main.mjs`/`launch.mjs`/`verify.mjs`/`state-file.mjs` | `app.requestSingleInstanceLock()`（`main.mjs:275`）；`launch.mjs` 选 build、记账到 `globalThis.__hermesBoot`；`verify.mjs` 完整性；`main.mjs:250` `import(app.asar/src/main.js)` 载入载荷 |
| **B 产品壳** | `app\1007\app.asar` → `src/main.js` | Electron 主进程；`spawn` 便携 Node 起 **dsh web server 子进程（3876）**；URL token → HttpOnly cookie；Hub 会话/目录/图像库在主进程，renderer 不直连 Hub（`main.js:3-15` 注释）；挂 3 个 bundle |
| **C 内嵌 DSH 引擎** | `app\1007\dsh\node_modules` | **完整 DSH 引擎**：`@deepseek-ai/*` 229 包 + `@writerx/*` 33 包（`@writerx/dsh-hermes-app`、`dsh-entitlements`、`dsh-web-search-hub`、`dsh-model-adapters`、`dsh-hermes-presets`、`dsh-system-skills` 等）。写作能力 = DSH agent + 技能 + 工具 + 参考卡 |
| **D 用户 Profile** | `F:\...\WriterX Hermes\dsh-home\profiles\hermes\` | `cordis.patch.yml`（bundles → patch → overlays 合成 cordis 树）；`package.json`（3 bundles：`dsh-base` + `dsh-web-app` + `@writerx/dsh-hermes-app`）；`@local/` 三插件；`skills\` = junction → `I:\DSHHome\skills`（21 个技能） |
| **E 融合模块** | 9136 推演 / InkOS 书库 / 主书库 | 生产 `127.0.0.1:9136` 在跑、隔离 `9137` 当前无监听；`dsh-home\scene9136\state.json`；J: `books` junction → F: 主书库 |

## 2. 启动与数据流

```
桌面 .lnk（explorer.exe 双击，唯一可用启动方式）
  └─> WriterX Hermes.exe（Electron）
       └─> A 引导器 app.asar：单实例锁 → 选 build 1007 → verify 完整性 → import 载荷
            └─> B 产品壳 app.asar/src/main.js
                 ├─ spawn 便携 Node → C 引擎 dsh web server 子进程 → LISTEN 3876
                 ├─ 主进程持有 Hub 会话/token/目录；renderer 经 HttpOnly cookie 访 3876
                 ├─ 载入 D profile：cordis.yml → cordis.patch.yml → 3 plugins(@local) + 21 skills
                 └─ 界面「AI 写作工作台」←→ 模型（tool-registry 挂 9136/inkos 工具）

一次写作（候选级，已实测一次）：
用户输入(/) → DSH 调度 → 加载 novel-studio 技能 → 读 md 真值档案 → scene9136_plan 推演
 → 候选片段 → 界面修改另存「待确认/」→ 作者采用才进「正文/」成正史
```

**收费闸数据流**：前端 bundle `requireFeatureEntitlement(feature)` → `POST /writerx-entitlements/authorize`
→ Hub 云端会话批准 → 本地 `@writerx/dsh-entitlements` 判定（`policy.js` 8 个 feature key）→ 按钮/拒绝。
联网搜索走 `web` 行 `searchProvider: writerx-hub` → `@writerx/dsh-web-search-hub` → **Hub 服务端**返回「会员专享」。

## 3. 端口与入口

| 端口 | 服务 | 状态 | 备注 |
|:--|:--|:--|:--|
| `3876` | WriterX dsh web server（B 层起） | 在跑 | URL token → HttpOnly cookie；根路径未带 token 返 401 |
| `9136` | 场景推演服务（生产） | 在跑 | `derive`/`check`/`ambient_check`/`health`/`state`；两个 pythonw 监听者归属存疑 |
| `9137` | 场景推演（隔离副本） | **停** | `dsh-scene9136` 插件 `baseUrl` 当前指向它 → 此刻 plan/check/apply 必 `E_SERVICE_DOWN` |

**扩展点（一切可改项在 D 用户 Profile 层，H: 签名件只读）**：
- `cordis.patch.yml` 的 `- id:` / `- insert:` 行：provider 选择、`disabled` 覆盖、工具行配置
- `@local/` 插件包（复制目录 + patch 追加 insert）
- `skills\` 根（放 `SKILL.md` 即被扫；触发符 `/`）
- 用户预设：用 `wx_preset_copy` 复制内置预设 → 生成 profile patch 一行 → 改该行内 `fetch`/`disabled`
- **H: 安装件不可改**：有完整性校验 + 自更新回滚

## 4. 三档能力边界（重要）

- **可文件级复制**：Skill 文件、Cordis 插件包、provider/config 覆盖、bundle 开关、`web_fetch` 的 provider
- **等价替代（≠ 原样复制）**：`pwsh`/`desktop_*`/`wechat_send`/`everything_search`/`memhub_search`/`codegraph`/`craft` 等**宿主级工具**属于当前沟通端 DSH 会话，不是可移植文件；`modsearch` 技能可替联网搜索
- **不可复制**：Hub 云端内容、会话上下文、依赖宿主进程内存的状态

## 5. 证据分级

`[事实]` 源码 file:line / 实测端口 / 哈希 ｜`[推断]` 由结构推出 ｜`[未验证]` 无调用记录 ｜`[未取得]` 抓不到（见 00 读我「包里没有什么」）。
`HTTP 200 ≠ 通过`、`文件存在 ≠ 界面可见`、`代码存在 ≠ 已调用`、`候选 ≠ 正史`。

---

## 02_现状与边界.md（改了什么 / 已知问题 / 未验证）

# 02 · 现状与边界（改了什么 / 已知问题 / 没做完 / 未验证）

> 时刻：2026-11-10 晚。分级：**已实测** / **已落地(需重启)** / **仅安装** / **仅设计** / **未验证** / **未取得**。
> 施工记录全文见 `docs/P1..P4`、`docs/00-团队共用底稿.md`；V1 验收见 `docs/V1-真实界面最终验收.md`。

## 1. 已完成（有证据）

| 项 | 状态 | 证据 |
|:--|:--|:--|
| V1.0 真实界面接通 | **已实测** | 启动/关闭/重开、UIA 控件树 93 控件、真键鼠输入、两次「允许一次」批准 |
| `scene9136_status` / `scene9136_plan` 真调 | **已实测** | tool-registry 4× tool-addition；`plan_hash=355c786d9965d5d9`/`slow_mo` |
| `novel-studio` 被 WriterX 调用 | **已实测** | 真实会话 `skill("novel-studio")` call+result 返回全文 |
| 三能力联合产出一次候选稿并保存、重开仍在 | **已实测（候选级·非正史）** | 250 字候选 + 修改版落「待确认/」，重开后仍在 |
| 书库物理合并 | **已实测** | J: `books` → F: 主书库 junction；读写改删互见；AutoSync 已禁用 |
| 正式数据零改动 | **已实测** | 生产 `历史.json` sha 全等；H: 签名件今日未改；正式正文零写入 |
| 技能触发符 `/`、无「LinkOS」技能、21 个技能 | **已实测** | `dsh-client-ui-skill/lib/client.js:376 trigger:"/"`；技能根实测 21 目录 |
| 插件管理页被关、插件本体活着 | **已实测** | 产品 patch `:228/:234 disabled:true`；`/inkos-panel/ping` HTTP 200 |

## 2. 今天（能力补齐）唯一实改

- **文件**：`F:\...\profiles\hermes\cordis.patch.yml`（575→605 行，+30 行）
- **内容**：`- id: web` 行 `config: { searchProvider: writerx-hub, fetchProvider: http }`（补回被产品 patch 丢掉的 `fetchProvider`）
- **备份**：`cordis.patch.yml.bak-能力补齐-20261110-201239`（sha `DD241CC4…8D5081`）
- **回滚**：`docs/` 未收脚本，脚本路径 `G:\...\_WriterX能力补齐-20261110\P2-回滚.ps1`（含 sha 自校验 + 回滚前另存 + `-WhatIfOnly`）
- **判定**：**已落地，需重启才生效**；运行时零增量（当前无工具调 `ctx.web.fetch`）

## 3. 明确「没做 / 不改」的工程判断（不是遗漏）

- ❌ **没改 `searchProvider`**：本构建只有 `writerx-hub` 一个 search provider，无第二个可换；「会员专享」在 Hub 服务端，本地改不动
- ❌ **没放开 `web_fetch` 工具行**：三处 `fetch: false`，真正生效的两处在**预设域**，profile 顶层 patch 打不到；只备好 provider，工具行仍关
- ❌ **没启用 workflow/ralph/subagent-fork**：宿主面与每个预设同名行会碰撞；写作助手禁用是设计取舍，创造模式本就全开
- ❌ **没新建 `存档.md`**：全盘 0 命中，是模型编造路径（真实为 `references\档案.md`），建了等于给幻觉背书
- ❌ **没改 H: 签名安装件 / 预设原件 / 正式小说 / 生产 9136 / 9137 生产实例**

## 4. 已知问题（五条，按影响排序）

1. **9137 无监听**，而 `dsh-scene9136` 的 `baseUrl` 指向它 → 此刻从界面调 plan/check/apply 必 `E_SERVICE_DOWN`；需现场起隔离服务或统一 config。
2. **9136 四工具无独立界面按钮**，全靠模型在对话里自动调用（tool-registry），用户可发现性差。
3. **check/apply 未逐个界面真调**：apply 还卡在「人工 approval 文件」（`E_STATE_NOT_APPROVED`，Agent 不能自批），无界面确认入口。
4. **InkOS 检索链未进界面写作上下文**：实测注入走 md 档案（`read` 87 次）而非 `memory.db`/FTS5；生产 `memory.db` 合并后**未定位**。
5. **启动方式脆弱**：只有 `explorer` 双击 `.lnk` 能起；直接 Start-Process exe 撞 `main.mjs:275` 单实例锁秒退且零日志。

## 5. 未验证 / 未取得（不得写成成果）

- **R1** 配置改动需重启才生效：未重启 → `fetchProvider` 是否被引擎接受 **未验证**
- **R2** 界面可见性方案（新增 `linkos` 技能 / 覆盖 `disabled`）**都未实施**；`disabled` 能否在 F: 层覆盖 **未验证** → 用户原问题「界面看不到」尚未真正解决
- **R3** 联网搜索是否真不收费：**未验证**，本地无解
- **R7** `scene9136.inkosRoot` 指**隔离测试书** `_isobooks`，不是用户真书 → 现在算出的施工图是测试书的
- **R9** `dsh-inkos-panel` 浏览器半（左栏卡片）**未证**：host 半 ping 200、浏览器半 401 读不到 HTML、UIA 无左栏卡片
- **未取得**：生产 `memory.db` / `ledger.db`（合并后 F: 作品树递归 0 个 `.db`）；`03` 的 DDL 来自**隔离副本**
- **未取得**：生产 9136 服务源码（抓到的是 9137 隔离副本 `服务.py`，与生产同源基线但非同一运行实例）
- **未取得**：`dsh-web-search-hub` 之外是否存在其它 provider 的全库穷举（仅 `@writerx/` 包内抽查 0 命中）
- **口径存疑**：9136 两个 pythonw（22100/25252）监听归属，`Get-NetTCPConnection` 与 `netstat`/uptime 读数冲突

## 6. 全包边界声明

资料打包完成 **≠ 系统验收通过**。本轮未重新设计架构、未重新开发功能、未重复阶段 0/0.5 调查、
未修改任何生产代码/配置/数据库/正式小说、未重启任何服务。

---

## 03_怎么改.md（逐文件六步 + 验收 + 回滚）

# 03 · 怎么改（逐文件六步 + 验收命令 + 回滚）

> 适用对象：拿到本仓库、想给这套系统提改动建议或直接指导施工的外部 AI / 协作者。
> **最重要的一条**：一切可改项在 **D 用户 Profile 层**。`H:\新建文件夹\WriterX Hermes` 是签名安装件，有完整性校验 + 自更新回滚，改它必被覆盖或触发回滚。不要往 `node_modules/`、`dist/`、`H:` 上挂改动。

## 0 · 开工六步（每次改动都按这个走）

1. **定位层**：先读 `01_架构.md` §1 五层表，判断这次改动属于 A/B/C/D/E 哪一层。落在 A/B/C = 挂点错了，回到 D。
2. **读现状**：读 `02_现状与边界.md`，确认这件事是不是已经做过、是不是被明确判断为「不改」（§3 五条）、是不是「未验证 / 未取得」。别重复已完成的验收。
3. **备份**：改任何文件前先复制一份带 `.bak-用途-时间戳` 后缀的副本，记下 sha256。`codegraph`/`cordis.patch.yml` 这类合成配置尤其要备份。
4. **小改**：只改必须改的那一行 / 那一段，不顺手重构相邻配置（手术刀）。改完先做语法 / 内存预校验（`ConvertFrom-Json`、`node --check`、YAML 解析）。
5. **验收**：见 §3 分层验收命令。**代码改完 ≠ 功能验证**；界面改动必须真开界面像用户一样点一遍，不许只用命令 / 接口回话就宣布完成。
6. **留痕 + 回滚**：把改了什么、为什么、落在哪一层写进 CHANGELOG（本仓库由 `github-project-push` 自动出版本），并确认回滚路径可用。

## 1 · 逐文件改法（真实文件 / 真实挂点）

| # | 文件（本机真源） | 仓库内参照 | 改什么 | 怎么改 |
|:--|:--|:--|:--|:--|
| 1 | `F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\cordis.patch.yml` | `src/D_用户Profile/cordis.patch-脱敏.yml` | provider 选择、`disabled` 覆盖、工具行配置 | 定位 `- id: web` / `- id:` / `- insert:` 行，只改该行 `config:`；初始版唯一实改 = 补回 `fetchProvider: http`（575→605 行，+30 行），见 `docs/P2-能力补齐落地.md` |
| 2 | `...\profiles\hermes\package.json` | `src/D_用户Profile/hermes-profile.package.json` | 声明 bundles（当前 3 个：`dsh-base` + `dsh-web-app` + `@writerx/dsh-hermes-app`） | 增 / 删 bundle 声明，改完必须重启 |
| 3 | `...\profiles\hermes\node_modules\@local\dsh-scene9136\index.js` | `src/D_插件/dsh-scene9136.index.js` | 9136 四工具的 `baseUrl` 与 `readApproval()` 硬闸门 | **当前缺口**：baseUrl 指向 9137（停）→ 改为统一 config 或现场起隔离服务；apply 卡在人工 approval 文件，Agent 不能自批，别删这道闸门 |
| 4 | `...\@local\dsh-inkos-bridge\index.js` | `src/D_插件/dsh-inkos-bridge.index.js` | InkOS 6 工具（status / outline / run / truth_*）的书库根与检索链 | 当前注入走 md 档案而非 `memory.db`/FTS5；要先定位生产库再改，别对着隔离副本的路径写死 |
| 5 | `...\@local\dsh-inkos-panel\lib\index.js` + `client.js` | `src/D_插件/dsh-inkos-panel.*.js` | host 半 `/inkos-panel/*` 路由 + 浏览器半左栏卡片 | 浏览器半 401 读不到 HTML、UIA 无左栏卡片 —— 先证「半渲染」再改，别凭代码存在当已可见 |
| 6 | `skills\` 根（junction → `I:\DSHHome\skills`，21 个技能） | `src/D_技能Skills/SKILL-*.md` | 新增 / 改技能 | 放一个 `SKILL.md` 即被扫；**触发符是 `/` 不是 `@`**；无「LinkOS」技能（只有 `linkos-novel` / `inkos-novel-system` / `novel-studio` / `axu-novel`）。用户要的「新增 `linkos` 技能」在初始版**未实施** |
| 7 | 用户预设行 | `docs/P2-B2-用户预设行片段.md` | `fetch` / `disabled` 覆盖 | 用 `wx_preset_copy` 复制内置预设 → 生成 profile patch 一行 → 改该行；**profile 顶层 patch 打不到预设域**，`web_fetch` 三处 `fetch: false` 真正生效的两处在预设域 |
| 8 | 书库 | `docs/00-团队共用底稿.md` · `_MANIFEST.json` | 主书库 / InkOS 合并 | J: `InkOS-Test\books` 已是 junction → F: 主书库；AutoSync 已禁用。别再建第二份书库 |

**明确不改（初始版工程判断，见 `02_现状与边界.md` §3）**：`searchProvider`（本构建只有 `writerx-hub`，「会员专享」在 Hub 服务端，本地改不动）｜放开 `web_fetch` 工具行（挂点在预设域）｜`workflow`/`ralph`/`subagent-fork`（与预设同名行碰撞）｜`存档.md`（全盘 0 命中，是模型编造路径，真实为 `references\档案.md`）｜H: 签名件 / 预设原件 / 正式小说 / 生产 9136 / 9137 生产实例。

## 2 · 分层验收命令

```powershell
# ① 配置语法预校验（改完立刻跑，别等重启）
$cfg = Get-Content 'F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\cordis.patch.yml' -Raw
# YAML 解析 / ConvertFrom-Json 按改动对象选；JS 文件用 node --check

# ② 服务是否真的在跑（只认目标自证，不信启动命令的返回）
(Invoke-WebRequest 'http://127.0.0.1:9136/api/health' -UseBasicParsing).StatusCode   # 生产推演
# 3876 需 URL token 换 HttpOnly cookie，根路径不带 token 返 401 是预期

# ③ 界面验收：只用 ego lite，像客户一样点一遍
ego-browser skill       # 先读当版手册
# 判据：真浏览器里点得到、看得见、能交互；接口 200 / 单测全绿不算验收

# ④ 重启许可：是「签」不是「话」，没全改完+没验完不许说可以重启
pwsh -NoProfile -File I:\DSHHome\scripts\restart-guard.ps1 prepare
pwsh -NoProfile -File I:\DSHHome\scripts\restart-guard.ps1 freeze --Note "改了 cordis.patch.yml 的 web 行"
# 重启回来
pwsh -NoProfile -File I:\DSHHome\scripts\restart-guard.ps1 verify
```

**启动方式**：只有 `explorer` 双击桌面 `.lnk` 能起；直接 `Start-Process` exe 撞 `src/A_引导器壳/main.mjs:275` 单实例锁秒退且零日志。别用后者做验收。

## 3 · 回滚（三条，按改动对象选）

1. **本仓库（架构快照）**：`git show v1` 看初始版完整内容；仓库每次同步只加新 commit + 新 tag，绝不清空历史、绝不 force push，任一版都可单独取回。回滚到某版 = `git checkout v1 -- <文件>`。
2. **本机 D 层配置**：备份 `cordis.patch.yml.bak-能力补齐-20261110-201239`（sha `DD241CC4…8D5081`）；官方回滚脚本 `G:\Users\Administrator\Documents\deepseek-harness\default-workspace\_WriterX能力补齐-20261110\P2-回滚.ps1`（含 sha 自校验 + 回滚前另存 + `-WhatIfOnly` 预演）。**先 `-WhatIfOnly` 再真跑**。
3. **上传产物**：初始版上传不改原安装目录一个字节；要撤回仓库内容，按 CHANGELOG 的基线 commit 回退即可，与本机生产无关。

## 4 · 提建议四条格式（固定）

1. **依据哪个文件**（`01_架构.md` / `src/xxx` / `docs/xxx` / `02_现状与边界.md`）
2. 说的是**现有能力**还是**需要新增**
3. **改动落在哪一层**：A 引导器 / B 产品壳 / C 内嵌引擎 / **D 用户 Profile（含插件·技能）** / E 融合模块（9136·书库）
4. 若建议改 `node_modules/`、`dist/`、`H:` 签名安装件 → 挂点选错，回到 D 层

> 结论分级照抄 `01_架构.md` §5：`[事实]` / `[推断]` / `[未验证]` / `[未取得]`。**「未取得」不许写成「没有」**；生产 `memory.db`/`ledger.db`、生产 9136 源码、3876 全量页面都属未取得，见 `00_读我_AI-FIRST.md`「包里没有什么」。

---

## 03_数据库结构.md（DDL，无数据行）

# 03 · 数据库结构（DDL + 表数，**不含任何数据行**）

> 全部 DDL 用 `sqlite_master` 只读取得；不执行任何 `SELECT` 业务行、不导出任何正文/聊天内容。
> WriterX 侧主要是 **JSON 存储**；SQLite 库来自 InkOS 与 bridge，且生产库**未定位**（见 §3）。

## 1. 表数总览

| 库 | 位置 | schema 对象数 | 实表 | 状态 |
|:--|:--|--:|--:|:--|
| `memory.db`（InkOS 官方记忆层） | `books\<id>\story\memory.db` | **21** | 4 + 1 FTS5 + 4 影子 | 隔离副本取得 |
| `ledger.db`（bridge 旁挂账本） | `books\<id>\story\longform\ledger.db` | **13** | 6 | 隔离副本取得 |
| WriterX JSON 存储 | `dsh-home\storages\workspace.json` 等 | — | — | 已取得**键结构** |

## 2. `memory.db` · DDL

-- 来源：隔离副本 books.isolated-20261110-111949\zhutian-v06\story\memory.db
-- 只读 sqlite_master；共 21 个 schema 对象（4 实表 + 1 FTS5 虚表 + 4 FTS 影子表 + 索引 + 触发器）
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
  valid_from_chapter INTEGER NOT NULL, valid_until_chapter INTEGER,
  source_chapter INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_facts_subject ON facts(subject);
CREATE INDEX idx_facts_valid ON facts(valid_from_chapter, valid_until_chapter);
CREATE INDEX idx_facts_source ON facts(source_chapter);

CREATE TABLE chapter_summaries (
  chapter INTEGER PRIMARY KEY, title TEXT NOT NULL,
  characters TEXT NOT NULL DEFAULT '', events TEXT NOT NULL DEFAULT '',
  state_changes TEXT NOT NULL DEFAULT '', hook_activity TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '', chapter_type TEXT NOT NULL DEFAULT '');

CREATE TABLE hooks (
  hook_id TEXT PRIMARY KEY, start_chapter INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
  expected_payoff TEXT NOT NULL DEFAULT '', payoff_timing TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_hooks_status ON hooks(status);
CREATE INDEX idx_hooks_last_advanced ON hooks(last_advanced_chapter);

CREATE TABLE retrieval_documents (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
  source TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  title_tokens TEXT NOT NULL, body_tokens TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, document_id));
CREATE INDEX idx_retrieval_documents_scope_kind ON retrieval_documents(scope, kind);
CREATE VIRTUAL TABLE retrieval_documents_fts USING fts5(
  title_tokens, body_tokens, content='retrieval_documents', content_rowid='rowid');
-- FTS5 影子表：_config / _data / _docsize / _idx（4 张，由 fts5 自动管理）
-- 触发器：retrieval_documents_ai / _ad / _au（3 个，同步 FTS 外部内容表）


**结构要点**：`facts` 是**时间区间事实表**（`valid_from_chapter`/`valid_until_chapter`，旧事实不删只填失效章）；
`retrieval_documents` + FTS5 是检索加速面，`content_hash` 做增量跳过；`hooks` 表只存字段子集、非权威真源。
权威真值在 `story/*.md` 与 `story/state/*.json`，DB 是可重建派生索引。

## 3. `ledger.db` · DDL

-- 来源：隔离副本 _trash\books\bridge-iso-001-...\story\longform\ledger.db
-- 只读 sqlite_master；共 13 个 schema 对象（6 实表 + 7 自动索引）
CREATE TABLE chapter_commit(
  commit_id TEXT PRIMARY KEY, chapter INTEGER NOT NULL, artifact_hash TEXT NOT NULL,
  applied_at TEXT, entries INTEGER, UNIQUE(chapter, artifact_hash));
CREATE TABLE entity(
  entity_id TEXT PRIMARY KEY, canonical TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]');
CREATE TABLE ledger(
  entry_id TEXT PRIMARY KEY, commit_id TEXT NOT NULL, entity_id TEXT, key TEXT,
  op TEXT CHECK(op IN ('set','add','sub')), amount REAL NOT NULL, chapter INTEGER, evidence TEXT);
CREATE TABLE resource(
  entity_id TEXT NOT NULL, key TEXT NOT NULL, value REAL NOT NULL, updated_ch INTEGER,
  PRIMARY KEY(entity_id,key));
CREATE TABLE fact(
  fact_id TEXT PRIMARY KEY, commit_id TEXT NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL,
  object TEXT NOT NULL, valid_from INTEGER NOT NULL, valid_until INTEGER, source_chapter INTEGER NOT NULL);
CREATE TABLE event(
  event_id TEXT PRIMARY KEY, commit_id TEXT NOT NULL, chapter INTEGER NOT NULL,
  event_type TEXT, subject TEXT, object TEXT, evidence TEXT);


**结构要点**：`chapter_commit` 用 `(chapter, artifact_hash)` 双判据幂等；`ledger`/`resource` 分离流水与余额；
`op` 有 CHECK 约束；`fact` 的 `valid_until` 语义与 A 层差 1 章（合并两库前须统一）。

## 4. WriterX 侧 JSON 存储（只给键结构，不给值）

| 文件 | 顶层键 | 说明 |
|:--|:--|:--|
| `dsh-home\storages\workspace.json` | `unit{name,version}` · `global{initialized,workspaceIds,archivedSessionIds,pinnedSessionIds}` · `tables.workspaces{id→…}` | 工作区登记表 |
| `dsh-home\scene9136\state.json` | `schema` · `candidates{book|ch→{schema,book,chapter,planHash,createdAt,status,versions,request,scenes,semantics}}` · `skeletons[]` · `revisions[]` | 9136 候选施工图状态 |
| `dsh-home\.hub\state.json` | `fingerprint` · `hubOrigin` · `session{token,expiresAt,tier}` · `entitlement{…}` · `refreshToken` · `user{…}` · `installation{installationId,installationSecret}` … | **仅字段名**：`token`/`refreshToken`/`installationSecret` 的值一律 `===REDACTED===`，本包不收其原文 |
| `library-map.json`（工程文档根） | `version` · `roots{}` · `books[]` · `updatedAt` | 书库总账配对表 |

> `.hub\state.json` 与 `.credentials.yaml`、`Network\Cookies` 属**高危凭据载体**：本包只列字段名结构，
> 任何值都不进包。配置文件里出现 `apiKeyEnv: WRITERX_HUB_SESSION_TOKEN` 是**字段名**，不是泄漏。

## 5. 未取得（照实）

- **生产 `memory.db` / `ledger.db` 合并后未定位**：书库 junction 合并后对 F: 主书库递归找 `.db` = **0 个**；
  上表 DDL 全部来自 J: `books.isolated-…` 与 `_trash` 隔离副本。**「未取得」≠「没有生产库」**。
- 未对任何库执行 `SELECT` 取业务行；未统计任何业务表行数写进本文件。
- InkOS 官方 `memory.db` 与 bridge `ledger.db` 是**互不相通的两条链**：Planner 输入清单不含 `story/longform/`，
  B 层账本写了也不影响写作上下文。

---

## 04_接口清单.md（源码抓取，未逐条验证）

# 04 · 接口清单（**字符串抓取，未逐条请求验证，别当可用清单**）

> 来源：`src/B_产品壳/` 内 ASAR `src/hub/*`（Hub 云端）与 `src/D_插件/`（本机插件），
> 以及 9137 隔离副本 `服务.py` 的路由字符串。全部是**从源码文本正则抓到的路径字面量**，
> **没有一条被逐条 HTTP 请求验证过**；`HTTP 200 ≠ 通过`，也不代表当前可达（9137 停、3876 需 token）。

## 1. Hub 云端 / 本地桥（来自 B 层 `src/hub/hub-api.mjs` / `hub-service.mjs` / `update/*` / `feedback.mjs`）

- `/api/v1/access/session`
- `/api/v1/agent/v1`
- `/api/v1/auth/login`
- `/api/v1/auth/password/reset`
- `/api/v1/auth/quota/balance`
- `/api/v1/auth/refresh`
- `/api/v1/auth/register`
- `/api/v1/auth/send-code`
- `/api/v1/client/updates`
- `/api/v1/config`
- `/api/v1/feedback`
- `/api/v1/feedback/mine`
- `/api/v1/hermes/access`
- `/api/v1/image/balance`
- `/api/v1/image/catalog`
- `/api/v1/image/jobs`
- `/api/v1/image/jobs/lookup`
- `/api/v1/llm/balance`
- `/api/v1/llm/catalog`
- `/api/v1/llm/installations`
- `/api/v1/llm/orders`
- `/api/v1/llm/quota/balance`
- `/api/v1/llm/quota/preflight`
- `/api/v1/llm/session`
- `/api/v1/llm/usage`
- `/api/v1/payments/orders`
- `/api/v1/payments/orders/cancel`
- `/api/v1/payments/orders/status`
- `/api/v1/payments/plans`
- `/api/v1/plaza/comments/{id}/helpful`
- `/api/v1/plaza/comments/{id}/reply`
- `/api/v1/plaza/comments/{id}/report`
- `/api/v1/plaza/install-complete`
- `/api/v1/plaza/me`
- `/api/v1/plaza/mine`
- `/api/v1/plaza/nickname`
- `/api/v1/plaza/skills/{id}`
- `/api/v1/startup-notice`
- `/writerx-entitlements/internal/session`
- `/writerx-entitlements/internal/update-tasks`
- `/writerx-entitlements/authorize`

> 注释：`/api/${method}` 是模板串（动态拼），未展开；`/writerx-entitlements/authorize` 是前端 `requireFeature` 的统一判定口。
> 这些是**产品与 Hub 之间的接口**，不是给外部 AI 调用的开放 API。

## 2. 场景推演服务 9136/9137（来自 9137 隔离副本 `服务.py` 字符串 + `dsh-scene9136` 插件调用）

- `/api/health`
- `/api/state`
- `/api/derive`
- `/api/check`
- `/api/ambient_check`
- `/api/ambient`
- `/api/ambient_kinds`
- `/api/aiflavor`
- `/api/baseline`
- `/api/engine`
- `/api/era`
- `/api/events`
- `/api/factors`
- `/api/factors_map`
- `/api/fans`
- `/api/free-ports`
- `/api/gate`
- `/api/history`
- `/api/inject`
- `/api/insert_points`
- `/api/principles`
- `/api/redlines`
- `/api/relations`
- `/api/select`
- `/api/simulate`
- `/api/skills`
- `/api/state`
- `/api/socket/`
- `/api/sucai`
- `/api/sucai_books`
- `/api/sucai_stats`

> 插件 `dsh-scene9136` 实际只用到 5 个：`/api/health`、`/api/state`（status）、`/api/derive`（plan）、
> `/api/check`、`/api/ambient_check`（check）。`/api/socket/*` 未集成。**生产 9136 服务源码未取得**，
> 这份清单抓自 **9137 隔离副本**，与生产同源基线但不是同一运行实例。

## 3. 本机插件 HTTP 路由（来自 `dsh-inkos-panel` / `dsh-inkos-bridge`）

- `/inkos-panel`
- `/inkos-panel/ping`
- `/inkos-panel/books`
- `/books/{bookId}/truth`
- `/books/{bookId}/truth/{name}`

> `/inkos-panel/ping` 实测 HTTP 200、`/inkos-panel/books` 实测返回 7 本（见 `docs/P3`）——这两条是**已实测**，
> 其余仍为字符串抓取未验证。`/books/{id}/truth` 是 bookId 路径参数，非字面量。

## 4. 模型侧工具（不是 HTTP 接口，列此防混）

| 插件 | 工具 |
|:--|:--|
| `@local/dsh-scene9136` | `scene9136_status` · `scene9136_plan` · `scene9136_check` · `scene9136_apply`（4） |
| `@local/dsh-inkos-bridge` | `inkos_status` · `inkos_outline` · `inkos_run` · `inkos_truth_list` · `inkos_truth_read` · `inkos_truth_write`（6） |
| `@local/dsh-inkos-panel` | 无工具（UI + HTTP 路由插件） |

> 工具由模型在对话里自动调用（tool-registry），**无独立界面按钮**。

---

## 05_文件清单.md

# 05 · 文件清单（包内全部文件 + 大小）

> 生成 2026-11-10 21:00:01 · 共 **47** 个文件 · 合计 **572,092** 字节（未压缩，含本文件与清单文件）

| 包内路径 | 字节 |
|:--|--:|
| `00_读我_AI-FIRST.md` | 7,519 |
| `01_架构.md` | 4,974 |
| `02_现状与边界.md` | 5,327 |
| `03_数据库结构.md` | 6,659 |
| `04_接口清单.md` | 3,966 |
| `05_文件清单.md` | 2,834 |
| `06_核心文件导航.md` | 2,236 |
| `_MANIFEST.json` | 2,616 |
| `docs/00-团队共用底稿.md` | 10,109 |
| `docs/00-审计最终报告.md` | 8,227 |
| `docs/B-数据库结构图.md` | 11,226 |
| `docs/B-表结构字段说明.md` | 13,434 |
| `docs/P1-框架差异与付费墙地图.md` | 15,140 |
| `docs/P2-B2-用户预设行片段.md` | 10,002 |
| `docs/P2-能力补齐落地.md` | 13,516 |
| `docs/P3-界面可见性与调用清单.md` | 23,565 |
| `docs/P4-独立QA结果与残留缺口.md` | 13,641 |
| `docs/V1-真实界面最终验收.md` | 5,831 |
| `docs/写作Skill审计.md` | 13,712 |
| `docs/插件接口摘要.md` | 1,390 |
| `docs/整体协同调用链.md` | 4,592 |
| `docs/用户操作指南.md` | 4,565 |
| `docs/系统模块清单与边界.md` | 4,102 |
| `docs/记忆系统审计.md` | 14,068 |
| `docs/问题与缺口清单.md` | 5,756 |
| `src/A_引导器壳/launch.mjs` | 25,165 |
| `src/A_引导器壳/main.mjs` | 11,700 |
| `src/A_引导器壳/package.json` | 232 |
| `src/A_引导器壳/state-file.mjs` | 5,304 |
| `src/A_引导器壳/verify.mjs` | 12,767 |
| `src/B_产品壳/hub-membership.mjs` | 4,046 |
| `src/B_产品壳/hub-profile-patch.mjs` | 12,086 |
| `src/B_产品壳/main.js` | 96,810 |
| `src/B_产品壳/runtime-env.mjs` | 1,677 |
| `src/D_技能Skills/SKILL-axu-novel.md` | 11,634 |
| `src/D_技能Skills/SKILL-inkos-novel-system.md` | 7,676 |
| `src/D_技能Skills/SKILL-linkos-novel.md` | 28,159 |
| `src/D_技能Skills/SKILL-novel-studio.md` | 19,301 |
| `src/D_插件/dsh-inkos-bridge.index.js` | 28,929 |
| `src/D_插件/dsh-inkos-bridge.package.json` | 655 |
| `src/D_插件/dsh-inkos-panel.client.js` | 27,472 |
| `src/D_插件/dsh-inkos-panel.lib.index.js` | 4,245 |
| `src/D_插件/dsh-inkos-panel.package.json` | 637 |
| `src/D_插件/dsh-scene9136.index.js` | 44,038 |
| `src/D_插件/dsh-scene9136.package.json` | 737 |
| `src/D_用户Profile/cordis.patch-脱敏.yml` | 19,569 |
| `src/D_用户Profile/hermes-profile.package.json` | 246 |

## 结构

- 根目录 7 件套：`00_读我_AI-FIRST.md` … `06_核心文件导航.md` + `_MANIFEST.json`
- `src/`：A/B/D 四层源码原文（已脱敏），按真源层建子目录
- `docs/`：项目自带审计 / 施工 / QA / 用户说明 原版（已脱敏）

> 注：C 内嵌 DSH 引擎（`node_modules` 229+33 包）与生产库/大素材按硬约束不收，见 `00_读我`「包里没有什么」。

---

## 06_核心文件导航.md

# 06 · 核心文件导航（点名细读，别全读）

> 20 个关键文件，各一句职责。路径均为**包内路径**（相对 ZIP 根）。

| 包内路径 | 是什么 |
|:--|:--|
| `00_读我_AI-FIRST.md` | 外部 AI 第一站：五真源表、读序、边界、「包里没有什么」 |
| `01_架构.md` | 五层结构、启动与数据流、端口、扩展点（看架构只读这份） |
| `02_现状与边界.md` | 改了什么 / 已知问题 / 没做完 / 未验证 / 未取得 |
| `03_数据库结构.md` | memory.db + ledger.db 全 DDL + 表数 + JSON 键结构（无数据行） |
| `04_接口清单.md` | 源码抓的路由（未逐条验证） |
| `src/A_引导器壳/main.mjs` | 引导器入口：单实例锁(:275)、选 build、记账、import 载荷(:250) |
| `src/A_引导器壳/launch.mjs` | 纯函数：选版本 + 记账规则（最大文件，25KB） |
| `src/A_引导器壳/verify.mjs` | 载荷完整性校验 |
| `src/B_产品壳/main.js` | 产品主进程：spawn dsh web server(3876)、token→cookie、Hub 会话 |
| `src/B_产品壳/hub-profile-patch.mjs` | profile patch 读取/合成 |
| `src/B_产品壳/hub-membership.mjs` | 会员判定桥接 |
| `src/D_用户Profile/cordis.patch-脱敏.yml` | 用户 Profile 真源：3 plugins insert + `id: web` 行（已脱敏结构） |
| `src/D_用户Profile/hermes-profile.package.json` | profile 声明的 3 个 bundle |
| `src/D_插件/dsh-scene9136.index.js` | 9136 四工具 + `readApproval()` 硬闸门（44KB，828 行等价） |
| `src/D_插件/dsh-inkos-bridge.index.js` | InkOS 6 工具（status/outline/run/truth_*） |
| `src/D_插件/dsh-inkos-panel.lib.index.js` | host 半：`/inkos-panel/*` 路由注册 |
| `src/D_插件/dsh-inkos-panel.client.js` | 浏览器半：左栏 sidebar card + overlay panel |
| `src/D_技能Skills/SKILL-novel-studio.md` | 纯 Markdown 写作全流程（不依赖常驻服务/DB） |
| `src/D_技能Skills/SKILL-linkos-novel.md` | LinkOS 账本系（文首声明账本层实测不可用） |
| `docs/P1-框架差异与付费墙地图.md` | 与沟通端 DSH 的逐条 diff + 三类付费墙 + 三档边界 |
| `docs/P4-独立QA结果与残留缺口.md` | 独立 QA 同意/存疑判定 + 残留缺口 R1–R10 |

---

## 关键源码索引（函数 / 类 / 路由 / 配置挂点，带行号）
> 只列索引不嵌全文（全文在仓库 `src/`）。行号对应仓库内同名文件，用于定位改动落点。

### `src/A_引导器壳/launch.mjs`

`src/A_引导器壳/launch.mjs:8`  export const BAD_LIMIT = 10
`src/A_引导器壳/launch.mjs:10`  export const MAX_TRIES = 2
`src/A_引导器壳/launch.mjs:12`  export const MAX_IMPORT_FAILURES = 2
`src/A_引导器壳/launch.mjs:17`  const text = (value, fallback = null) => (typeof value === 'string' ? value : fallback)
`src/A_引导器壳/launch.mjs:19`  function cloneState(state) {
`src/A_引导器壳/launch.mjs:28`  function reasonText(reason) {
`src/A_引导器壳/launch.mjs:32`  function withBad(state, build, reason, at) {
`src/A_引导器壳/launch.mjs:38`  const isBad = (state, build) => state.bad.some(entry => entry.build === build)
`src/A_引导器壳/launch.mjs:41`  function depsOf(deps) {
`src/A_引导器壳/launch.mjs:46`  function safeProbe(probe, build) {
`src/A_引导器壳/launch.mjs:62`  export function normalizeState(raw, installRoot) {
`src/A_引导器壳/launch.mjs:118`  export function decideLaunch(state, { probe, scanBuilds, now, installRoot }) {
`src/A_引导器壳/launch.mjs:127`  const launchOf = (build, trial, result) => {
`src/A_引导器壳/launch.mjs:156`  const finish = (build, result, extra) => {
`src/A_引导器壳/launch.mjs:219`  export function planStartup(read, deps) {
`src/A_引导器壳/launch.mjs:233`  export function createLaunchFlags(launch) {
`src/A_引导器壳/launch.mjs:237`  const isOwnTrial = (state, flags) => isObject(flags) && flags.trial === true && state.pending !== null && state.pending.build === 
`src/A_引导器壳/launch.mjs:242`  const pendingLaunched = (state, flags) => state.pending !== null && (state.pending.tries > 0 || isOwnTrial(state, flags))
`src/A_引导器壳/launch.mjs:252`  export function applyLoginReady(state, flags) {
`src/A_引导器壳/launch.mjs:268`  export function applyEngineStarting(state, flags) {
`src/A_引导器壳/launch.mjs:283`  export function applyHealthy(state, flags) {
`src/A_引导器壳/launch.mjs:312`  export function applyImportFailure(state, flags, deps) {
`src/A_引导器壳/launch.mjs:338`  export function applyImportSuccess(state) {
`src/A_引导器壳/launch.mjs:355`  export function applyStage(state, build, deps, flags = null) {
`src/A_引导器壳/launch.mjs:376`  export function applyUnstage(state, flags = null) {
`src/A_引导器壳/launch.mjs:392`  export function applyMarkBad(state, build, reason, deps, flags = null) {
`src/A_引导器壳/launch.mjs:410`  export function applyRollbackSeen(state) {
`src/A_引导器壳/launch.mjs:423`  export function rollbackTarget(state, flags) {

### `src/A_引导器壳/main.mjs`

`src/A_引导器壳/main.mjs:45`  const now = () => new Date().toISOString()
`src/A_引导器壳/main.mjs:49`  function errorText(error) {
`src/A_引导器壳/main.mjs:57`  function journal(entry) {
`src/A_引导器壳/main.mjs:62`  function showIncomplete() {
`src/A_引导器壳/main.mjs:72`  function giveUp() {
`src/A_引导器壳/main.mjs:77`  function probeWritable(dir) {
`src/A_引导器壳/main.mjs:94`  function readBootJson(name) {
`src/A_引导器壳/main.mjs:98`  function hasStateFile(updateHome) {
`src/A_引导器壳/main.mjs:102`  async function boot() {
`src/A_引导器壳/main.mjs:170`  const guard = (method, fallback, action) => {
`src/A_引导器壳/main.mjs:180`  const account = (apply, event) => guard(event, false, () => {

### `src/A_引导器壳/state-file.mjs`

`src/A_引导器壳/state-file.mjs:7`  export const STATE_SCHEMA = 1
`src/A_引导器壳/state-file.mjs:9`  export const JOURNAL_MAX_BYTES = 1024 * 1024
`src/A_引导器壳/state-file.mjs:15`  function sleepSync(ms) {
`src/A_引导器壳/state-file.mjs:23`  function withRetry(action) {
`src/A_引导器壳/state-file.mjs:39`  export function emptyState(installRoot) {
`src/A_引导器壳/state-file.mjs:53`  export function readStateFile(file, fs) {
`src/A_引导器壳/state-file.mjs:84`  export function readState(file, fs) {
`src/A_引导器壳/state-file.mjs:95`  export function writeStateAtomic(file, state, fs) {
`src/A_引导器壳/state-file.mjs:128`  export function appendJournal(file, entry, fs, { maxBytes = JOURNAL_MAX_BYTES } = {}) {

### `src/A_引导器壳/verify.mjs`

`src/A_引导器壳/verify.mjs:9`  export const ED25519_SPKI_PREFIX = '302a300506032b6570032100'
`src/A_引导器壳/verify.mjs:32`  export function publicKeyFromRaw(raw) {
`src/A_引导器壳/verify.mjs:50`  export function verifyManifestSignature(bytes, sigText, keys) {
`src/A_引导器壳/verify.mjs:69`  function parseHead(text) {
`src/A_引导器壳/verify.mjs:82`  function readOrNull(fs, file, encoding) {
`src/A_引导器壳/verify.mjs:98`  export function readManifestHead(dir, fs, { keys = [] } = {}) {
`src/A_引导器壳/verify.mjs:104`  function readVerifiedManifest(dir, fs, keys) {
`src/A_引导器壳/verify.mjs:136`  function asarEntryOf(text) {
`src/A_引导器壳/verify.mjs:156`  function hashFileSync(fs, file) {
`src/A_引导器壳/verify.mjs:192`  export function probeBuildDir(dir, build, { fs, keys, runtime }) {
`src/A_引导器壳/verify.mjs:241`  export function createProbe({ appDirs, fs, keys, runtime }) {
`src/A_引导器壳/verify.mjs:257`  function isPlainDir(fs, appDir, entry) {
`src/A_引导器壳/verify.mjs:274`  export function scanBuildDirs(appDirs, fs) {

### `src/B_产品壳/hub-membership.mjs`

`src/B_产品壳/hub-membership.mjs:12`  const empty = () => ({ active: false, exp: 0, trial: false })
`src/B_产品壳/hub-membership.mjs:15`  function productHint(value, scoped) {
`src/B_产品壳/hub-membership.mjs:24`  export function normalizeEntitlement(value) {
`src/B_产品壳/hub-membership.mjs:48`  export function reconcileEntitlement(previous, raw, v2Known = false) {
`src/B_产品壳/hub-membership.mjs:57`  export function currentEntitlement(value, now) {

### `src/B_产品壳/hub-profile-patch.mjs`

`src/B_产品壳/hub-profile-patch.mjs:20`  class JsExpression {
`src/B_产品壳/hub-profile-patch.mjs:32`  export function profilePatchPath(dshHome, profile = 'hermes') {
`src/B_产品壳/hub-profile-patch.mjs:37`  export async function readProfilePatch(patchPath) {
`src/B_产品壳/hub-profile-patch.mjs:46`  export function readProfilePatchSync(patchPath) {
`src/B_产品壳/hub-profile-patch.mjs:55`  export function profileRowConfigSync(patchPath, rowId) {
`src/B_产品壳/hub-profile-patch.mjs:65`  export const OPENING_MODES = Object.freeze(['full', 'brief', 'off'])
`src/B_产品壳/hub-profile-patch.mjs:68`  export function openingModeSync(patchPath) {
`src/B_产品壳/hub-profile-patch.mjs:73`  async function writeProfilePatch(patchPath, rows) {
`src/B_产品壳/hub-profile-patch.mjs:89`  export async function upsertProfileRowConfig(patchPath, rowId, fields) {
`src/B_产品壳/hub-profile-patch.mjs:109`  export const NEW_INSTALL_THEME = 'dark'
`src/B_产品壳/hub-profile-patch.mjs:123`  export async function seedNewInstallTheme(dshHome, profile = 'hermes') {
`src/B_产品壳/hub-profile-patch.mjs:147`  function sanitizeLegacyModelAdapters(section) {
`src/B_产品壳/hub-profile-patch.mjs:173`  export async function bridgeLegacySettingsSections(dshHome, renames) {
`src/B_产品壳/hub-profile-patch.mjs:210`  export async function recoverStrandedSettingsImport(dshHome, renames = {}, profile = 'hermes') {

### `src/B_产品壳/main.js`

`src/B_产品壳/main.js:24`  import { createServer } from 'node:net'
`src/B_产品壳/main.js:197`  const dshHome = () => path.join(app.getPath('userData'), 'dsh-home')
`src/B_产品壳/main.js:202`  function userFolder(name) {
`src/B_产品壳/main.js:217`  function defaultLibraryDirectory() {
`src/B_产品壳/main.js:226`  function log(line) {
`src/B_产品壳/main.js:239`  function devUiPatches() {
`src/B_产品壳/main.js:245`  '  disabled: false',
`src/B_产品壳/main.js:247`  '  disabled: false',
`src/B_产品壳/main.js:259`  function shippedPayloadPatches() {
`src/B_产品壳/main.js:267`  function startServer(port) {
`src/B_产品壳/main.js:270`  const child = spawn(NODE_EXE, engineArguments({
`src/B_产品壳/main.js:309`  async function waitReady(port, timeoutMs, child, signal) {
`src/B_产品壳/main.js:343`  function portFree(port) {
`src/B_产品壳/main.js:345`  const probe = createServer()
`src/B_产品壳/main.js:351`  function engineStartCancelled() {
`src/B_产品壳/main.js:356`  async function enginePortTaken(child) {
`src/B_产品壳/main.js:363`  function childExited(child) {
`src/B_产品壳/main.js:367`  function waitForChildExit(child, timeoutMs) {
`src/B_产品壳/main.js:370`  const done = () => { clearTimeout(timer); resolve(true) }
`src/B_产品壳/main.js:376`  function taskkillTree(child) {
`src/B_产品壳/main.js:381`  const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
`src/B_产品壳/main.js:384`  const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
`src/B_产品壳/main.js:391`  function terminateServerChild(child) {
`src/B_产品壳/main.js:396`  const task = (async () => {
`src/B_产品壳/main.js:412`  async function stopServer() {
`src/B_产品壳/main.js:426`  async function bootServer(signal) {
`src/B_产品壳/main.js:510`  function createWindow() {
`src/B_产品壳/main.js:669`  function appUrl() {

### `src/B_产品壳/runtime-env.mjs`

`src/B_产品壳/runtime-env.mjs:8`  export function runtimeEnvironmentOverrides({ nodeExe, pythonBin, env = process.env, platform = process.platform }) {

### `src/D_插件/dsh-inkos-bridge.index.js`

`src/D_插件/dsh-inkos-bridge.index.js:11`  *   export { name, inject, Config, apply }
`src/D_插件/dsh-inkos-bridge.index.js:35`  baseUrl: z.string(),
`src/D_插件/dsh-inkos-bridge.index.js:45`  /** InkOS Studio 的 REST 前缀实测是 /api/v1（不是 /api；/api 会回落到 SPA index.html）。 */
`src/D_插件/dsh-inkos-bridge.index.js:46`  baseUrl: "http://127.0.0.1:4567/api/v1",
`src/D_插件/dsh-inkos-bridge.index.js:68`  const text = (lines) => [{
`src/D_插件/dsh-inkos-bridge.index.js:78`  function resolveConfig(config = {}) {
`src/D_插件/dsh-inkos-bridge.index.js:79`  const pick = (key) => {
`src/D_插件/dsh-inkos-bridge.index.js:88`  baseUrl: pick("baseUrl"),
`src/D_插件/dsh-inkos-bridge.index.js:98`  * @param {string} pathAndQuery - 相对 baseUrl 的路径。
`src/D_插件/dsh-inkos-bridge.index.js:102`  async function inkosHttp(cfg, method, pathAndQuery, body) {
`src/D_插件/dsh-inkos-bridge.index.js:103`  const url = cfg.baseUrl.replace(/\/+$/, "") + pathAndQuery;
`src/D_插件/dsh-inkos-bridge.index.js:131`  function requireTruthFile(file) {
`src/D_插件/dsh-inkos-bridge.index.js:145`  function requireBookId(bookId) {
`src/D_插件/dsh-inkos-bridge.index.js:157`  function runInkos(cfg, argv) {
`src/D_插件/dsh-inkos-bridge.index.js:167`  child = spawn(cfg.nodePath, [cfg.cliPath, ...argv], {
`src/D_插件/dsh-inkos-bridge.index.js:184`  const pump = (stream, key) => {
`src/D_插件/dsh-inkos-bridge.index.js:225`  function describeRun(result, header) {
`src/D_插件/dsh-inkos-bridge.index.js:244`  function inkosTools(cfg) {
`src/D_插件/dsh-inkos-bridge.index.js:429`  const bookArgs = () => {
`src/D_插件/dsh-inkos-bridge.index.js:509`  description: "列出 InkOS 一本书的可写要素清单（GET /api/v1/books/{id}/truth）。每项给 name / size / preview / legacy。legacy=true 的是旧布局 shim，直接写会被 40
`src/D_插件/dsh-inkos-bridge.index.js:539`  description: "读 InkOS 某个要素文件的全文（GET /api/v1/books/{id}/truth/{file}）。支持 outline/ 与 roles/ 下的嵌套路径（中文文件名按段编码）。只读，不花 token、不调模型。",
`src/D_插件/dsh-inkos-bridge.index.js:586`  description: "把整篇 Markdown 写进 InkOS 的一个要素文件（PUT /api/v1/books/{id}/truth/{file}，body {content}）。这是「AI 往 InkOS 填资料」的唯一通道 —— CLI 的 b
`src/D_插件/dsh-inkos-bridge.index.js:661`  function statusLines(value) {
`src/D_插件/dsh-inkos-bridge.index.js:692`  function outlineLines(value) {
`src/D_插件/dsh-inkos-bridge.index.js:712`  function apply(ctx, config) {
`src/D_插件/dsh-inkos-bridge.index.js:719`  export { Config, DEFAULTS, OUTLINE_FILES, apply, describeRun, inkosTools, inject, name, resolveConfig, runInkos, statusLines };

### `src/D_插件/dsh-inkos-panel.client.js`

`src/D_插件/dsh-inkos-panel.client.js:15`  const BASE = "http://127.0.0.1:4567/api/v1";
`src/D_插件/dsh-inkos-panel.client.js:39`  const notify = () => {
`src/D_插件/dsh-inkos-panel.client.js:46`  const setExpanded = (v) => {
`src/D_插件/dsh-inkos-panel.client.js:53`  const setOpen = (v) => {
`src/D_插件/dsh-inkos-panel.client.js:57`  function useGlobal() {
`src/D_插件/dsh-inkos-panel.client.js:61`  const fn = () => bump((n) => n + 1);
`src/D_插件/dsh-inkos-panel.client.js:71`  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
`src/D_插件/dsh-inkos-panel.client.js:72`  async function api(path, init) {
`src/D_插件/dsh-inkos-panel.client.js:87`  const detail = (json && (json.message || json.error)) || text.slice(0, 240);
`src/D_插件/dsh-inkos-panel.client.js:92`  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
`src/D_插件/dsh-inkos-panel.client.js:132`  function InkOSEntry(props) {
`src/D_插件/dsh-inkos-panel.client.js:193`  function InkOSOverlay() {
`src/D_插件/dsh-inkos-panel.client.js:247`  const on = () => setOpen(true);
`src/D_插件/dsh-inkos-panel.client.js:253`  async function refreshShelf() {
`src/D_插件/dsh-inkos-panel.client.js:269`  async function refreshBooks() {
`src/D_插件/dsh-inkos-panel.client.js:274`  const list = (r && r.books) || [];
`src/D_插件/dsh-inkos-panel.client.js:285`  async function loadBook(id) {
`src/D_插件/dsh-inkos-panel.client.js:294`  async function loadFiles(id) {
`src/D_插件/dsh-inkos-panel.client.js:301`  const list = (r && r.files) || [];
`src/D_插件/dsh-inkos-panel.client.js:311`  async function loadContent(id, file) {
`src/D_插件/dsh-inkos-panel.client.js:318`  const text = (r && (r.content !== undefined ? r.content : r.text)) || "";
`src/D_插件/dsh-inkos-panel.client.js:355`  async function save() {
`src/D_插件/dsh-inkos-panel.client.js:375`  async function writeNext() {
`src/D_插件/dsh-inkos-panel.client.js:421`  const chip = (label, color) =>
`src/D_插件/dsh-inkos-panel.client.js:437`  const barBtn = (label, onClick, key, accent) =>
`src/D_插件/dsh-inkos-panel.client.js:798`  function apply(ctx) {

### `src/D_插件/dsh-inkos-panel.lib.index.js`

`src/D_插件/dsh-inkos-panel.lib.index.js:17`  export const name = "local-inkos-panel";
`src/D_插件/dsh-inkos-panel.lib.index.js:18`  export const inject = ["webServer"];
`src/D_插件/dsh-inkos-panel.lib.index.js:24`  function sendJson(res, code, payload) {
`src/D_插件/dsh-inkos-panel.lib.index.js:37`  async function readShelf() {
`src/D_插件/dsh-inkos-panel.lib.index.js:96`  export function apply(ctx) {

### `src/D_插件/dsh-scene9136.index.js`

`src/D_插件/dsh-scene9136.index.js:5`  *   scene9136_status  只读：GET /api/health + /api/state（不碰 /api/socket/*）
`src/D_插件/dsh-scene9136.index.js:6`  *   scene9136_plan    生成施工图：POST /api/derive，固定 events=preview，落"候选状态文件"
`src/D_插件/dsh-scene9136.index.js:7`  *   scene9136_check   辅助检查：POST /api/check | /api/ambient_check（不作硬闸门）
`src/D_插件/dsh-scene9136.index.js:35`  baseUrl: z.string(),
`src/D_插件/dsh-scene9136.index.js:45`  baseUrl: "http://127.0.0.1:9137",
`src/D_插件/dsh-scene9136.index.js:79`  const stamp = () => new Date().toISOString();
`src/D_插件/dsh-scene9136.index.js:82`  const h16 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
`src/D_插件/dsh-scene9136.index.js:85`  class SceneError extends Error {
`src/D_插件/dsh-scene9136.index.js:100`  const text = (lines) => [{ type: "text", text: lines.join("\n") }];
`src/D_插件/dsh-scene9136.index.js:106`  function resolveConfig(config = {}) {
`src/D_插件/dsh-scene9136.index.js:107`  const pickProtocol = (key) => (config[key] === undefined || config[key] === null || config[key] === "" ? PROTOCOL_DEFAULTS[key] : 
`src/D_插件/dsh-scene9136.index.js:109`  baseUrl: String(pickProtocol("baseUrl")).replace(/\/+$/, ""),
`src/D_插件/dsh-scene9136.index.js:131`  async function httpJson(cfg, method, path, body, timeoutMs) {
`src/D_插件/dsh-scene9136.index.js:141`  const response = await fetch(cfg.baseUrl + path, init);
`src/D_插件/dsh-scene9136.index.js:149`  timedOut ? `请求 ${path} 超过 ${timeoutMs}ms 未返回` : `连不上 ${cfg.baseUrl}（${error?.message ?? error}）`,
`src/D_插件/dsh-scene9136.index.js:157`  async function readState(cfg, timeoutMs = Math.min(cfg.timeoutMs, 5000)) {
`src/D_插件/dsh-scene9136.index.js:159`  const res = await httpJson(cfg, "GET", "/api/state", undefined, timeoutMs);
`src/D_插件/dsh-scene9136.index.js:164`  /** 版本信息：serviceVersion 取 /api/state 的「版本」；ruleVersion 取计数表的指纹（数据变了就变）。 */
`src/D_插件/dsh-scene9136.index.js:165`  function versionsOf(state) {
`src/D_插件/dsh-scene9136.index.js:173`  function resolveScenes(args) {
`src/D_插件/dsh-scene9136.index.js:194`  function validateScenes(scenes) {
`src/D_插件/dsh-scene9136.index.js:305`  function deriveBody(book, chapter, scene, forceNew) {
`src/D_插件/dsh-scene9136.index.js:323`  function extractPlan(scene, request, res) {
`src/D_插件/dsh-scene9136.index.js:345`  function checkOrigin(scene, plan) {
`src/D_插件/dsh-scene9136.index.js:360`  function readStateFile(cfg) {
`src/D_插件/dsh-scene9136.index.js:379`  function writeStateFile(cfg, state) {
`src/D_插件/dsh-scene9136.index.js:387`  const candidateKey = (book, chapter) => `${book}|${chapter}`;
`src/D_插件/dsh-scene9136.index.js:390`  function bookDirOf(cfg, book) {

### `src/D_用户Profile/cordis.patch-脱敏.yml`

`src/D_用户Profile/cordis.patch-脱敏.yml:1`  - id: ui-theme
`src/D_用户Profile/cordis.patch-脱敏.yml:4`  - id: writerx-model-adapters
`src/D_用户Profile/cordis.patch-脱敏.yml:17`  - id: qwen3-vl:8b
`src/D_用户Profile/cordis.patch-脱敏.yml:40`  - id: writerx-free
`src/D_用户Profile/cordis.patch-脱敏.yml:51`  - id: deepseek-v4.1-flash-free
`src/D_用户Profile/cordis.patch-脱敏.yml:62`  - id: deepseek-v4-flash-free
`src/D_用户Profile/cordis.patch-脱敏.yml:73`  - id: glm-5.3-flash-free
`src/D_用户Profile/cordis.patch-脱敏.yml:84`  - id: hy4-preview-free
`src/D_用户Profile/cordis.patch-脱敏.yml:95`  - id: dots3-note-prev
`src/D_用户Profile/cordis.patch-脱敏.yml:105`  - id: ur2-gemini-3.5-flash-free
`src/D_用户Profile/cordis.patch-脱敏.yml:116`  - id: ur2-gemini-3.6-flash-free
`src/D_用户Profile/cordis.patch-脱敏.yml:127`  - id: deepseek-v4-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:152`  - id: deepseek-v4.1-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:177`  - id: glm-5.3
`src/D_用户Profile/cordis.patch-脱敏.yml:198`  - id: glm-5.3-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:219`  - id: doubao-seed-2.1-turbo
`src/D_用户Profile/cordis.patch-脱敏.yml:230`  - id: mimo-v2.6-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:241`  - id: mimo-v2.6-pro
`src/D_用户Profile/cordis.patch-脱敏.yml:252`  - id: gpt-6-luna
`src/D_用户Profile/cordis.patch-脱敏.yml:277`  - id: gpt-6.1-terra
`src/D_用户Profile/cordis.patch-脱敏.yml:288`  - id: gemini-3.7-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:306`  - id: gemini-4-argon
`src/D_用户Profile/cordis.patch-脱敏.yml:325`  - id: claude-haiku-5.5
`src/D_用户Profile/cordis.patch-脱敏.yml:350`  - id: grok-4.5
`src/D_用户Profile/cordis.patch-脱敏.yml:361`  - id: grok-4.6
`src/D_用户Profile/cordis.patch-脱敏.yml:372`  - id: grok-4.7
`src/D_用户Profile/cordis.patch-脱敏.yml:393`  - id: opencode-go2/glm-5.3-flash
`src/D_用户Profile/cordis.patch-脱敏.yml:395`  - id: opencode-go2/deepseek-v4.1-flash

---

## 初始版上传交付说明（2026-11-11 16:40 Asia/Shanghai）


- 仓库：`sunxiaohu66322/writerx-hermes-architecture`（PUBLIC），由 DSH skill `github-project-push` 上传。
- 内容 = 现成脱敏离线包 47 文件（八件套 + `src/` 22 + `docs/` 17）+ 仓库根导航（README / llms.txt / 00读我 / 01架构 / 02现状 / 03怎么改 / 自包含包 / 话术）+ 版本记录（CHANGELOG / VERSIONS）。
- 真源分层：A 引导器壳（H: 签名件只读）/ B 产品壳（3876）/ C 内嵌 DSH 引擎（不搬）/ **D 用户 Profile（一切可改项）** / E 融合模块（9136·书库）。WriterX 是 **DSH 套壳**，被改的是收费闸与预设开关。
- 脱敏：密钥/Token/Cookie/密码/会话串/私钥的**值**一律 `===REDACTED===`；配置只给字段名与结构；数据库只给 DDL 与表名、不给业务行。敏感值正则扫描 **0 命中**。高危凭据 `.credentials.yaml`、`Network\Cookies`、`server.log` token 行、`sessions\*.jsonl.zstd`、`storages\session_projcache\*.json` 一个字节未进仓库。
- 排除：`node_modules`、`dist/`、`build/`、缓存、`*.bak-*`、探针、图片视频、模型权重、完整小说正文、聊天原文，路径命中 **0**。
- 生产零改动：未改源码/配置/数据库/正式小说、未重启、未起服务、未装依赖。

## 未取得项（不是「没有」）

- 生产 `memory.db` / `ledger.db`（书库合并后 F: 作品树递归 0 个 `.db`；本仓库 `03_数据库结构.md` 的 DDL 取自 J: 隔离副本）
- 生产 9136 服务源码（抓到的是 9137 隔离副本 `服务.py`）
- Hub 之外是否存在其它 provider 的全库穷举（仅 `@writerx/` 包内抽查）
- 任何业务表行数（未执行 `SELECT`）
- `dsh-inkos-panel` 浏览器半渲染、9136 双 pythonw 监听归属、完整 3876 页面（需 token）

## 已知缺口（初始版，不是验收通过）

9137 无监听而插件 baseUrl 指向它 → 界面 plan/check/apply 当前必失败；apply 卡人工 approval 文件；InkOS 检索链未进界面写作上下文；「界面看不到」的真正解决（新增 `linkos` 技能 / 覆盖 `disabled`）未实施；启动方式脆弱（只有 explorer 双击 .lnk 能起）。完整清单见 `02_现状与边界.md` §4–§5 与 `docs/P4-独立QA结果与残留缺口.md`（R1–R10）。

---

## 提建议四条格式（固定，请照这个回）

1. **依据哪个文件**（`01_架构.md` / `src/xxx` / `docs/xxx` / `02_现状与边界.md` / 本文件某一节）
2. 说的是**现有能力**还是**需要新增**
3. **改动落在哪一层**：A 引导器 / B 产品壳 / C 内嵌引擎 / **D 用户 Profile（含插件·技能）** / E 融合模块（9136·书库）
4. 若建议改 `node_modules/`、`dist/`、`H:` 签名安装件 → 挂点选错，回到 D 层

**别误读**：`InkOS` / `LinkOS` / `9136` / `novel-studio` / `axu-novel` / `linkos-novel` 是本项目合法组成，不是串台；「未收」≠「不存在」、「未取得」≠「没有」；`HTTP 200 ≠ 通过`、`候选 ≠ 正史`。
