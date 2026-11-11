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
