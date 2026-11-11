# 写作 Skill 审计 · D Novel Studio / axu-novel

> WriterX 外部审计包 · 04-NovelStudio｜只读核查，未改生产文件｜2026-11-10
> `[事实]`＝实测／文件原文；`[推断]`＝由实测推出；`[口径]`＝委托方给定／文档自述，未独立复核。
> 占位：`<WS>`＝工作区；`<WX_HOME>`＝WriterX Hermes 的 dsh-home 根；`<SKILLS>`＝`<WX_HOME>\dsh-home\skills` 这个 Junction 的目标目录；`<BOOK>`＝书项目目录（与 `<WS>` 同级，另引入）。全文无密钥、口令、凭据，不复制小说正文。

## ① 安装清单

`<SKILLS>\novel-studio\` 实测为 Junction，**24 文件 / 158,762 B**。`[事实]`

| 文件 | 用途 |
|:--|:--|
| `SKILL.md` | 入口：触发词、能力状态、四条约定、craft/engine 两路径（234 行 / 19,301 B） |
| `LICENSE-NOTICE.md` | 授权署名、未搬三样、原件留存与回滚、版本来源 |
| `安装与首跑指南.md` | 待执行的安装／首跑两关／回滚清单（自述「未安装、运行时未测」） |
| `references\开书.md` | 开书七步：三方案、世界与人物、全书故事、自检、黄金三章 |
| `references\排细纲.md` | 分卷纲与细纲九问检查 |
| `references\写一章.md` | 每章循环：处境卡、参照、起草、自检、候选、采用、五类回写 |
| `references\档案.md` | 项目档案结构；旧结构只读盘点＋对照方案 |
| `references\写作质量.md` | 写作质量十项清单（查什么） |
| `references\去AI味.md` | 写后自检怎么跑（流程，只查一次） |
| `references\改稿.md` | 八症状表、三层改稿、冷读 |
| `references\卷末和完本.md` | 卷末五步、版本归档（只挪不删）、完本收尾 |
| `references\引擎与推演.md` | 能力边界：引擎／9136 说明＋账本不可用实测（第五章无命令） |
| `assets\写作规则-默认版.md` | 新书默认写作规则（含处境卡要求） |
| `assets\档案模板\01-项目状态.md` | 当前阶段、已采用章、撰写路径锁 |
| `assets\档案模板\02-设定.md` | 设定三栏分离（作者／人物／读者） |
| `assets\档案模板\03-人物.md` | 结构化人物档案 |
| `assets\档案模板\04-大纲.md` | 全书大纲与当前细纲 |
| `assets\档案模板\05-开书记录.md` | 开书七步确认留痕 |
| `assets\档案模板\06-引擎对接.md` | **新增件**，仅 engine 书填；axu 无 |
| `assets\档案模板\记录-人物现状.md` | 回写之一：会变的人物状态 |
| `assets\档案模板\记录-伏笔.md` | 回写之一：未收伏笔 |
| `assets\档案模板\记录-时间线.md` | 回写之一：影响后面的事 |
| `assets\档案模板\记录-废弃设定.md` | 回写之一：已弃设定归档 |
| `assets\档案模板\记录-资源.md` | 回写之一：资源自记真值 |

**清单差异（保留）**`[事实]`：指南 L13 记「27 文件 / 184,600 B」（`assets` 记 12＝规则 1＋模板 11，另加交付件 4）；`C7` L29 记「26 文件 / 176,011 B」。二者为 2026-11-09 快照、`C8` 后加，与实测不符。以实测 24 为准。

## ② 注册与发现机制

三级 Junction，全部实测 `[事实]`：

```
<WX_HOME>\dsh-home\skills         (Junction) → <SKILLS>
<SKILLS>\novel-studio             (Junction) → <WS>\_并行施工\C-NovelStudio\novel-studio
<BOOK>\.dsh\skills\novel-studio   (Junction) → 同上 staging
```

- 三处 `SKILL.md` SHA256 全等 `BFEEB292…4993C5` → **同一份字节**，非三副本。`[事实]`
- `axu-novel`（20 文件）、`linkos-novel`（21）、`inkos-novel-system`（2）为真实目录，非 Junction。`[事实]`
- 自动发现＝目录存在 `SKILL.md`（frontmatter 带 `name`＋`description`）即进 catalog `[口径]`：未读壳源码复核。运行时强证据 `[事实]`：`真实会话-终态.jsonl` L168 的 `<system-reminder>` 里 `<技能清单标签>` 同时列出三个 novel skill；`skill("novel-studio")` 返回全文（见 ④）。
- **关键补充**：`skill_content` 的 base directory 是 `<BOOK>\.dsh\skills\novel-studio`（书项目级那条），不是 `<SKILLS>` 那条。两链同指 staging，内容一致，但**加载入口按书项目走**。`[事实]`

## ③ Profile（hermes）加载状态

`界面-验收证据02-工具调用.md` L62-65：模型在真实界面确认「**有。** 当前技能目录里有一条叫 `novel-studio` 的技能……**不依赖常驻服务或数据库**，引擎写章和场景推演都是可选项」，并说「同一批还有 `linkos-novel`（账本层实测不可用）、`axu-novel`（4.0 稳定写正文）等，模型能区分」。L74 判「被目标实例识别 ✅」；L25-37 另记 `scene9136_*` 四工具进入 model 侧 tool-registry、`scene9136_status` 真调有原文。jsonl L168 的 catalog 变更是会话内真发生的 system-reminder。`[事实]`

→ hermes 下 novel-studio **已加载且可区分同类 skill**；此处证明「被发现／被列出」，真实调用见 ④。

## ④ 真实调用证据（分级）

**A【已实测被 WriterX 调用】**`[事实]`
- `真实会话-终态.jsonl` L188 `tool/call` seq=186：`{"name":"skill","arguments":"{\"name\":\"novel-studio\"}"}`；L189 `tool/result` seq=187 返回 `<skill_content name="novel-studio">` 及 SKILL 全文。同一轮在 model 的 tool-call block 与 tool/call 各留一份痕，**不是两次独立调用**。11 份 `真实会话-*.jsonl` 中 10 份含该轮；较早快照 `真实会话-解压.jsonl` 只到 seq 161，故无。
- 同轮后续真实动作：`read` 书档案 `设定\角色卡.md`（seq=188）、`scene9136_plan` 两次（seq=194／253，ch98／ch99）、`pwsh` 探 9137 `/api/state`、`write` 落「界面第099章候选片段」（seq=283／289／319，首行「这是候选，不是正史」）。→ **被加载并用于产出候选材料**。
- **边界**：候选基于测试书 `isobook-01`＋9136 施工图，**不是《诸天》正式章节**；未 `scene9136_apply`、未落 `正文/`、未改生产书稿。完整「写章 → 采用 → 回写」闭环**未实测**。

**B【仅界面历史控件，且非 novel-studio】**`[事实]`
- `界面-UIA控件树-01.md` L16 有控件「**调用技能 长篇正文写作**」，原文注「真实历史里模型调用过」；对应 `真实会话-终态.jsonl` seq=18 的 `skill("wx-chapter-write")`。是**另一个技能**，属历史消息控件，本轮未现场再点。
- 该控件树（93 控件）**未查到**「调用技能 novel-studio」控件；novel-studio 的证据是会话里的**工具调用记录**，不是按钮。控件树 L38-39 自列「novel-studio 是否在 @ 技能候选里」为「尚未由本控件树证明」——缺口由 ③ 与 A 补上。

**C【仅安装可发现】**`[事实]` axu-novel／linkos-novel／inkos-novel-system 在 `<SKILLS>` 下、模型能区分（③），但本轮真实会话**未见对这三者的 `skill()` 调用**。

**D【仅设计／文档自述未测】** 保留原文并标时效：
- `安装与首跑指南.md` L3-4：「⚠️ 本指南只用于将来获准安装后执行。**当前状态：staging 未安装、运行时未测。** 本文件里没有任何一步已经被跑过」。L126-134 列三件未测：引擎写章（要花钱＋作者同意）、9136 推演（要先备章节场景配置，且只有人点按钮才触发）、降级处置（要真出现降级章）。
- `C7` L5：「**文档级结构测试**（脚本扫＋人工核对）。**不是运行时测试**」；L18-20 明写「真实跑一章 ❌」「装进 Skill 目录能否被识别 ❌」「engine／9136 真实连通 ❌」。
- **冲突与时点差**`[事实]`：两份写于 2026-11-09；V1 会话在 2026-11-10 03:58 后完成 A 的 `skill()` 调用、`scene9136_status`／`plan` 真调与候选落盘。故「运行时未测」**已被后续证据时效化**；「未安装」字面仍成立（未复制进生产目录，改由 Junction 挂载）。C7「能否被识别」被 A 部分覆盖；「engine 写章／9136 apply／降级处置」**仍未实测**。按「当时如实、后来被覆盖」两层都留。

## ⑤ 三 Skill 关系与有效功能

**同源**`[事实]`：`SKILL.md` L8 与 `LICENSE-NOTICE.md` L5、L16-18 明写「开书七步、每章循环、五类回写、候选与采用制、卷末收口」吸收自「阿序AI 长篇小说工作流 4.0」（axu-novel）。`linkos-novel\SKILL.md` L296 自述「axu-novel 是别人的作品（CC BY-NC 4.0），只读参照……文件名对齐它是为让旧档案直接接上」。`C5` L9-26 列 axu 12 项工艺（5 保留／6 合并／1 舍弃＝《师姐》样章，0 丢失），L30-42 列 linkos 有效件 10 样。

**命名对齐**`[事实]`：`SKILL.md` L26「档案文件名与 axu-novel 完全一致（除 `06-引擎对接.md` 是新增）。axu 原件只读参照，不许改它」。实测模板 11 份中 10 份与 axu 同名，多出的正是 `06-引擎对接.md`（axu 无 `06-`；linkos 叫 `06-账本对接.md`）。旧档案可零迁移接着写（指南步骤 C）；`C8` 只服务 engine 书。

| Skill | 可用 | 不可用／边界 |
|:--|:--|:--|
| `axu-novel` 20 文件 | 4.0 手艺层全套，稳定写正文，纯 Markdown | 只读参照不许改；无机器侧 |
| `linkos-novel` 21 文件 | 开书／细纲／写章／采用／落正文／改稿／去AI味／卷末（第 1–9 步） | **账本层实测不可用**：推正史任何书失败（`sync` 缺章号、`index.json` 不扫目录、无基线快照）、记账本静默记 0 笔仍返 `ok`、投影能跑但为空（L8-31）。文首自荐「稳定写正文请用 axu-novel」 |
| `novel-studio` 24 文件 | `craft`（默认）纯 Markdown 全链路：开书 → 细纲 → 写章 → 自检 → 候选 → 采用 → 回写 → 卷末，**不依赖常驻服务或数据库**（L19、L24） | 桥接账本 ❌ 不用（L22）；引擎写章＝**可选**、要花钱、腔调不受本书规则控制（L20）；**9136＝手动可选项**：要人点按钮且先有章节场景配置（L21）；engine 路径按书锁定，不许按章混用（L44-50） |
| `inkos-novel-system` 2 文件 | `capabilities.json` 自述 15 项能力（doctor／write／recover／craft／longform…），多项 `status: ok` | 该文件 `updated=2026-10-26` 是**自我声明**；linkos 文首是 2026-11-09 实测（账本不可用），后者更新，二者未复跑对齐。以实测为准，勿据 capabilities.json 断言账本可用 |

`[口径]`「9136 手动可选项」「linkos 账本不可用」「novel-studio 纯 Markdown craft 路径」与原文一致，本轮据文件核对，未另起服务验证。

## ⑥ 授权署名

`[事实]` `axu-novel` ＝ **阿序AI 长篇小说工作流 4.0**，**CC BY-NC 4.0**（署名 · 非商业性使用 · 相同方式共享），原作者保留署名。`LICENSE-NOTICE.md` L5-12 规定 `novel-studio` 承继：① 保留原作者署名（写在 LICENSE-NOTICE 第二节与 SKILL.md 文首）；② 不得未经授权商业再分发；③ **对外分发须同时保留本授权说明与署名**。L22-28 列**没搬的三样**：`参照样章-师姐第一章.md`（原作者作品片段）、`去AI味.md` 的《师姐》错例库、axu 整段要求块原文（方法可吸收、表达须自写）。L30-45：**`axu-novel`（20 文件）与 `linkos-novel`（21 文件）两个原件都不许删、不许改**，作回滚来源，并给出 5 步回滚。L20：机器层部分（引擎写章、场景推演接入说明）来自本机 InkOS／9136 实测记录，**不含第三方授权内容**。

→ 外部审查／转发本包须随附 `LICENSE-NOTICE.md` 与署名，不得用于商业再分发。

## ⑦ 证据索引

| # | 文件（占位） | 支撑 |
|:--|:--|:--|
| E1 | `<SKILLS>\novel-studio\SKILL.md` L2-3, L8-9, L15-26, L35-52 | 触发词、能力状态、两路径、命名对齐 |
| E2 | 同目录 `LICENSE-NOTICE.md` L5-20, L22-28, L30-45, L49-56 | 授权署名、未搬三样、原件留存 |
| E3 | 同目录 `安装与首跑指南.md` L3-4, L13, L65, L91, L126-134 | 未安装未测、首跑两关、三件未测 |
| E4 | `<WS>\_并行施工\C-NovelStudio\C5-能力合并对照表.md` L9-26, L30-42, L47-70 | axu 12 项／linkos 有效件／砍掉／新增 |
| E5 | 同目录 `C7-独立测试报告.md` L5, L18-22, L29-39, L58-70 | 非运行时测试、三项没做、红线扫描 |
| E6 | 同目录 `C8-档案读取映射表.md` L9-16, L20-45 | 只服务 engine 书、三条读取通道 |
| E7 | `<WS>\_V1接通\shots\界面-验收证据02-工具调用.md` L18-23, L25-37, L39-60, L62-75 | 真键鼠、tool-registry、status 真调、列表确认 |
| E8 | 同目录 `界面-UIA控件树-01.md` L16-20, L30-39 | 「长篇正文写作」历史控件、未证项 |
| E9 | 同目录 `真实会话-终态.jsonl` L18/19, L168, L178, L188/189, L194, L253, L283-324 | `wx-chapter-write`、catalog、`skill()` 全文、plan、候选落盘 |
| E10 | 同目录 `真实会话-*.jsonl`（11 份） | 10 份含该轮调用；`真实会话-解压.jsonl` 无 |
| E11 | `<SKILLS>\axu-novel\SKILL.md` L1-18 | 4.0 名称、三条约定 |
| E12 | `<SKILLS>\linkos-novel\SKILL.md` L3, L8-31, L296 | 账本三层失败原因、只读参照 |
| E13 | `<SKILLS>\inkos-novel-system\capabilities.json` L1-26 | 15 项能力自述、updated |
| E14 | 本轮 `pwsh` 实测（LinkType／Target、Get-FileHash、计数） | 三级链、SHA256 全等、24 文件／158,762 B |

**未验证项**：未重启服务、未调付费模型、未跑 `scene9136_apply`、未实测完整「写章 → 采用 → 回写」闭环、未独立复核自动发现的壳源码、未复跑 inkos capabilities 与 linkos 账本实测的口径冲突。

