# WriterX Hermes（改编版） · 架构快照仓库

> **当前 v2**（2026-11-13 刷新；v1 = 初始版，tag `v1`）｜由 DSH skill `github-project-push` 上传｜用途：给看不到本机、打不开端口的外部 AI（ChatGPT / Claude / 其它）读懂这套系统「是什么 / 由哪几层组成 / 数据怎么流 / 现在做到哪一步 / 哪些还没做 / 怎么改」。
> 这是**结构化架构快照**，不是可直接运行的部署包，也不是完整源码压缩包。上传时原安装目录 `H:\新建文件夹\WriterX Hermes` 一个字节未改。

## 0 · 版本记录（第三方 AI 请先读这里）

- [CHANGELOG.md](CHANGELOG.md) —— 每一次改了什么、为什么改、改动落在哪些文件，**从最新一条往下读即看全历史**
- [VERSIONS.md](VERSIONS.md) —— vN 索引表（时间 / 说明 / 基线 commit / 改动数）
- 看某一版完整差异：`git show v1` / `git show v2`，或 GitHub 的 `/commits/v1` 页
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
| **D 用户 Profile** | `F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\` | `cordis.patch.yml`（v2 = 670 行 / 63 个 `- id:`）+ `@local/` 六插件 + `skills\`（junction → `I:\DSHHome\skills`） | `src/D_用户Profile/`、`src/D_插件/`、`src/D_技能Skills/` |
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
| [05_文件清单.md](05_文件清单.md) | 离线包 58 文件 + 大小（只统计离线快照那部分，不含仓库导航与版本文件） |
| [06_核心文件导航.md](06_核心文件导航.md) | 20 个关键文件，各一句职责（带真实行号） |
| [llms.txt](llms.txt) | 全文索引 + 关键源码 / 报告链接，机器友好 |
| [WriterX-Hermes-自包含包.md](WriterX-Hermes-自包含包.md) | **无需联网的单文件全文**（对方打不开链接时直接把这个当附件发） |
| [给外部AI的开场话术.txt](给外部AI的开场话术.txt) | 复制给对方的首轮提示词（含 3 条具体任务） |

`src/` = A/B/D 三层已脱敏源码原文｜`docs/` = 审计 / 施工 / QA / 用户说明原版（已脱敏）｜`_MANIFEST.json` = 机器可读清单。

> 本仓库 = **离线包 58 文件**（v1 47 + v2 新增 10 插件源码 + 1 份更新说明） + 仓库导航（`README.md` / `llms.txt` / `03_怎么改.md` / 自包含包 / 话术）+ 版本记录（`CHANGELOG.md` / `VERSIONS.md`）。离线包里的 `00_读我` 说「只能读附件」，在这个仓库里同样成立 —— 只是附件换成了仓库文件。

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

## 5 · 已知缺口（v1 沿用，v2 未重验 —— 不是验收通过）

1. `9137` 无监听而 `dsh-scene9136` 的 baseUrl 指向它 → 界面调 plan/check/apply 当前必失败。
2. `check/apply` 未逐个界面真调；apply 卡在「人工 approval 文件」，Agent 不能自批，无界面确认入口。
3. InkOS 检索链未进界面写作上下文（实测注入走 md 档案而非 `memory.db`/FTS5）；生产 `memory.db` / `ledger.db` 合并后**未定位** —— `03` 的 DDL 取自隔离副本。
4. 用户原问题「界面看不到」的真正解决（新增 `linkos` 技能 / 覆盖 `disabled`）**都未实施**，判为未完成。
5. 启动方式脆弱：只有 `explorer` 双击 `.lnk` 能起；直接 Start-Process exe 撞 `main.mjs:275` 单实例锁秒退且零日志。
6. 生产 9136 服务源码未取得（抓到的是 9137 隔离副本 `服务.py`，同源基线但非同一运行实例）；3876 全量页面需 token，未取得。

完整清单见 `02_现状与边界.md` §4–§5 与 `docs/P4-独立QA结果与残留缺口.md`（R1–R10）。\n\n**v2 新增（静态比对，不是功能验收）**：D 层 `cordis.patch.yml` 576 → **670 行 / 63 个 `- id:`**（主题 / 模型档 / 插件桥 / provider 路由四类）；`@local/` 插件 **3 → 6**（+`dsh-armor-llm` / `dsh-local-web` / `dsh-style-assets`）；新增一批 `writerx-*` **运行态数据目录**（只登记不收包）。A/B 签名件 sha 与 v1 全等、**未改**。以上新增配置行是否被引擎加载、新插件是否可调用、9136/9137 状态 —— **v2 未重启、未点界面、未复测，全部未验证**。完整对照见 [docs/V2-更新说明-20261113.md](docs/V2-更新说明-20261113.md)。

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

