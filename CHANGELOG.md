# 版本变更记录（CHANGELOG）

> 本仓库由 `github-project-push` 版本化同步维护。**每次同步 = 远端历史之上的一个新 commit + 一个 tag**。
> 第三方 AI / 协作者：从最新一条往下读，就能看到这套系统每一次改了什么、为什么改、改动落在哪些文件。
> 看某一版完整差异：`git show <tag>`，或 GitHub 的 `/commits/<tag>` 页。
> 「基线 commit」= 这一版的上一版提交；本版 SHA 用 `git rev-parse <tag>` 取（提交自身不能写自己的 SHA）。
> 本文件与 `VERSIONS.md` 自身的更新不重复计入下面的改动清单。
> 注：`raw.githubusercontent.com` 有 CDN 缓存，刚推完的几分钟内可能读到上一版；
> 想确认最新版，请看仓库根本文件的**网页渲染**或 `/tags` 页（实时），或 `git show <tag>`。

## v4 · 2026-11-14 03:50:19 +08:00 · v4：AI配图→本地图片资料包三包改造（面板/后端/轮播）+4条本地路由+frames三方同构；node --check全0、书稿6/6哈希不变；真机未验

- 标签：`v4` ｜ 基线 commit（上一版）：`a7afee28b` ｜ 密钥终检：**0 命中** ｜ 纳入 **69** 文件 / 排除 **0**
- 本版有意义的改动 **7** 项（A 新增 / M 修改 / D 删除 / R 改名）：
  - `A` `docs/V4-更新说明-20261114.md`
  - `A` `docs/图片资料包-包A交付.md`
  - `A` `docs/图片资料包-包B交付.md`
  - `A` `docs/图片资料包-包C交付.md`
  - `A` `docs/图片资料包-改造契约.md`
  - `A` `docs/图片资料包-集成核对.md`
  - `M` `llms.txt`
- 本版提交 SHA：`git rev-parse v4`；改动记录同步维护在 `VERSIONS.md` 与仓库 tags 页。

## v3 · 2026-11-13 22:57:30 +08:00 · v3：界面四块改造（18步阶段条/候选采用闸门/工序台进度灯/取证按问题取）+ 长会话两件套移植（graph-memory + dsh-session-shift，独立记忆库）+ 插件市场调研31条/50插件体检/两插件改哪里备忘/需求单原文；4文件node --check rc=0、书稿6/6哈希不变、取证第6章25

- 标签：`v3` ｜ 基线 commit（上一版）：`9f73b3215` ｜ 密钥终检：**0 命中** ｜ 纳入 **63** 文件 / 排除 **0**
- 本版有意义的改动 **6** 项（A 新增 / M 修改 / D 删除 / R 改名）：
  - `A` `docs/V3-更新说明-20261113.md`
  - `A` `docs/WhiteX-长会话两插件-改哪里.md`
  - `A` `docs/交接-界面改造需求.md`
  - `A` `docs/插件可移植性体检-20261113.md`
  - `A` `docs/插件市场调研-20261113.md`
  - `M` `llms.txt`
- 本版提交 SHA：`git rev-parse v3`；改动记录同步维护在 `VERSIONS.md` 与仓库 tags 页。

## v2 · 2026-11-13 00:14:10 +08:00 · v2 刷新：D层 cordis.patch.yml 670行/63id 脱敏重建、@local 插件3→6 补10个关键源码、新增V2更新说明与运行态目录登记；A/B 签名件未改；密钥/排除/串台终检0命中

- 标签：`v2` ｜ 基线 commit（上一版）：`938d47742` ｜ 密钥终检：**0 命中** ｜ 纳入 **58** 文件 / 排除 **0**
- 本版有意义的改动 **23** 项（A 新增 / M 修改 / D 删除 / R 改名）：
  - `M` `00_读我_AI-FIRST.md`
  - `M` `01_架构.md`
  - `M` `02_现状与边界.md`
  - `M` `03_怎么改.md`
  - `M` `05_文件清单.md`
  - `M` `06_核心文件导航.md`
  - `M` `README.md`
  - `M` `WriterX-Hermes-自包含包.md`
  - `M` `_MANIFEST.json`
  - `A` `docs/V2-更新说明-20261113.md`
  - `M` `llms.txt`
  - `A` `src/D_插件/armor-llm.armor-core.mjs`
  - `A` `src/D_插件/armor-llm.armor.md`
  - `A` `src/D_插件/armor-llm.lib.index.js`
  - `A` `src/D_插件/armor-llm.package.json`
  - `A` `src/D_插件/armor-llm.proxy.mjs`
  - `A` `src/D_插件/dsh-local-web.index.js`
  - `A` `src/D_插件/dsh-local-web.package.json`
  - `A` `src/D_插件/dsh-style-assets.README.md`
  - `A` `src/D_插件/dsh-style-assets.index.js`
  - `A` `src/D_插件/dsh-style-assets.package.json`
  - `M` `src/D_用户Profile/cordis.patch-脱敏.yml`
  - `M` `给外部AI的开场话术.txt`
- 本版提交 SHA：`git rev-parse v2`；改动记录同步维护在 `VERSIONS.md` 与仓库 tags 页。

## v1 · 2026-11-11 16:43:05 +08:00 · 初始版：WriterX Hermes 改编版架构快照 47 文件 + 仓库根六件套 + 自包含单文件包 + 开场话术 + 版本记录，供外部 AI 看全貌并指导升级

- 标签：`v1` ｜ 基线 commit（上一版）：`bf69ea4e9` ｜ 密钥终检：**0 命中** ｜ 纳入 **47** 文件 / 排除 **0**
- 本版有意义的改动 **5** 项（A 新增 / M 修改 / D 删除 / R 改名）：
  - `A` `03_怎么改.md`
  - `A` `README.md`
  - `A` `WriterX-Hermes-自包含包.md`
  - `A` `llms.txt`
  - `A` `给外部AI的开场话术.txt`
- 本版提交 SHA：`git rev-parse v1`；改动记录同步维护在 `VERSIONS.md` 与仓库 tags 页。

