# WhiteX 长会话两插件 · 装了什么 / 以后去哪改

> 2026-11-13 从正版 DSH 桌面版移植。本文是**给以后改它的人看的地图**，不是操作报告。
> 目标软件：WriterX Hermes（写长篇小说的 DSH 套壳）。
> 目的：让 WhiteX 也有「旧对话能查回」「聊太久自动换会话并带走交接包」这两样。

---

## 一、装了什么，装在哪

| 插件 | 干什么 | 落盘位置 |
|:--|:--|:--|
| `graph-memory` v1.6.0-beta.17 | 把聊过的对话存成可检索的知识胶囊；压缩后还能查回旧内容 | `F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\node_modules\graph-memory\` |
| `@sinclair/typebox`（上面唯一的硬依赖） | graph-memory 内部用来校验数据，缺了它 import 直接失败 | 同目录 `node_modules\@sinclair\typebox\` |
| `@local/dsh-session-shift` v0.2.2 | 上下文快满时自动开新会话，把改动过的文件 / 最近消息 / 停在哪儿打成交接包带过去 | 同目录 `node_modules\@local\dsh-session-shift\` |

**关键：WhiteX 用的是它自己的独立记忆库**，路径
`F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\graph-memory\graph-memory.db`
——跟桌面版那个 81 MB 的「编程记忆库」物理隔开，写小说的记忆和写程序的记忆互不污染。首次启动自动建库，不用手建。

---

## 二、改了哪个文件、哪一段

**唯一改动的配置文件**：
`F:\Users\Administrator\AppData\Roaming\WriterX Hermes\dsh-home\profiles\hermes\cordis.patch.yml`

文件末尾新增了一段（`- insert:` 开头），登记两个插件 + 写死配置：

```
- insert:
    - id: graph-memory
      name: 'graph-memory/dsh'
      config: { dbPath, recallMaxNodes:6, contextCompactionEnabled:true, freshTurnCount:5, ... }
    - id: dsh-session-shift
      name: '@local/dsh-session-shift'
      config: { enabled:true, thresholdRatio:0.9, minTurns:20, agentPreset:'', ... }
```

**为什么配置全写成静态值**：WhiteX 的 patch 从来没用过 `!!js` / `dshHomePath()` 这类表达式，桌面版自带的 `cordis.patch.yml` 里全是它们。照抄会让加载器不认，所以路径写死、表达式全去掉。

**备份**（改前原样复制，可一键回退）：
`...\profiles\hermes\_bak-装插件-20261113-193229\cordis.patch.yml.bak`
`...\profiles\hermes\package.json.bak-装插件-20261113-193229`

---

## 三、以后想调，改哪里

| 想改什么 | 改哪个键 | 说明 |
|:--|:--|:--|
| 旧内容召回多少条 | `graph-memory` → `recallMaxNodes` | 现在 6，调大更全但更费 token |
| 关掉「压缩后自动补旧记忆」 | `contextCompactionEnabled` → `false` | 关了就退回普通压缩 |
| 换记忆库位置 | `dbPath` | 必须是绝对路径；换盘符记得把旧 db 一起搬 |
| 交接触发得早/晚 | `dsh-session-shift` → `thresholdRatio` | 现在 0.9（真快满才换）。调小 = 更早换 |
| 少于几轮不自动交接 | `minTurns` | 现在 20，防止刚聊两句就换 |
| 彻底关掉自动交接 | `enabled` → `false` | 手动 `POST /api/handoff/run` 仍可用 |
| 交接包存哪 | `handoffDir` | 现在 `.dsh/handoff`，相对当前工作目录 |
| 交接出来的新会话用哪个预设 | `agentPreset` | **必须是空串**。源码默认 `'redteam'` 是桌面版红队专用，WhiteX 没这个预设 |

改完 **必须重启 WhiteX** 才生效（配置是启动时读的）。重启后看
`...\node_modules\@local\dsh-inkos-panel\host-loaded.log` 有没有新的 `apply()` 记录。

**⚠️ 2026-11-13 收尾实况（务必先读）**：我做完配置后尝试重启，用三种方式
（`Start-Process` 无参 / 带工作目录 / `Invoke-Item` 等价双击）都拉不起窗口，
进程 `ExitCode=0` 立即自退、无报错。已做 A/B 归因：**临时换回装插件前的旧配置，
同样起不来** → 与本次插件改动无关，是我这个无图形界面的会话拉不起 Electron 窗口。
配置已恢复成「装插件后」版本，插件与依赖都在位，**只差主人在桌面手动双击
`WriterX Hermes.lnk` 一次**。

主人双击后请帮我确认三件事：
1. `host-loaded.log` 出现一条新的 `apply() entered`（时间戳晚于 11:22:24Z）；
2. `F:\...\WriterX Hermes\dsh-home\graph-memory\` 目录自动出现（独立记忆库建库成功）；
3. 聊几十轮后不再弹「上下文已压缩」提示、或压缩后仍能用 `graph-memory` 查回旧内容。

若双击后仍起不来，那是另一个独立问题，与本节两插件无关，单独报我。

**回滚的备用快照**：`G:\Users\Administrator\Documents\WriterX\_装插件后-cordis.patch.yml.snapshot`
（与当前生效的 `cordis.patch.yml` 逐字节一致，万一被壳重写可一键贴回）。

---

## 四、怎么回退（全删干净）

1. 关掉 WhiteX
2. 把 `_bak-装插件-20261113-193229\cordis.patch.yml.bak` 覆盖回 `cordis.patch.yml`
3. 删掉三个目录：`node_modules\graph-memory`、`node_modules\@sinclair`、`node_modules\@local\dsh-session-shift`
4. （可选）删掉 `dsh-home\graph-memory\` 整个独立记忆库
5. 重开 WhiteX —— 回到装之前的状态，一行残留都没有

---

## 五、兼容性实测（装之前验过的，不是猜的）

```
WTX 内置 node        v22.23.2   ≥ graph-memory 要求的 22.13
node:sqlite          SQLITE_OK  DatabaseSync,StatementSync,...  （graph-memory 的存储引擎）
YAML 解析            YAML_OK    12 个顶层条目，7 个 insert 插件，两个新插件都登记上了
graph-memory 入口    GM_OK      apply,inject,name
session-shift 入口   SS_OK      enabled=true ratio=0.9 preset=[] minTurns=20
@sinclair/typebox     已补齐    1074 文件 / 1,907,776 B
```

WTX 的 runtime 与桌面版是**同一套 `@deepseek-ai/*` 0.2.0-rc.2**，所以两个插件的框架依赖天然满足。

---

## 六、我复核后否决的「其他候选」（别照着装）

体检子智能体报了「直接可搬 3 个」，我逐个复核后**三个都不建议直接装**：

| 插件 | 子智能体结论 | 我复核出的硬伤 |
|:--|:--|:--|
| `dsh-checkpoint-rewind` 0.6.33 | 直接可搬 | 源码有 **8 处 systemPrompt / 模型注入命中**，会动会话前缀；且拉进 10+ 个 `@deepseek-ai/*` peer。写作场景不需要回档，风险大于收益 |
| `@linxin666/dsh-chat-recovery` 0.3.5 | 直接可搬 | `dsh.client.inject` 里点名 `@deepseek-ai/dsh-client-runtime` —— **WTX runtime 里没有这个包**（实测 False），装了客户端半边加载失败 |
| `@deepseek-ai/dsh-compaction-image-offload` | 直接可搬 | 倒是干净、WTX 自带，**但它是「压缩时把图片卸载」**，写小说几乎不传图，装了等于没装 |

另外**明确不搬**的一类（43 个里的大头）：8 个插件通过 `ctx.systemPrompt.section` 往提示词里塞东西
（`dsh-master-rules` 注入 MASTER.md 铁律+红队调度、`pojia` 注入破甲/R18、`v3-scheduler`、`call-optimize`、`recall`、
`taskgraph-focus`、两个 agent 预设），另有 5 个改模型路由 / 推理档位。**这些会冲掉 WhiteX 自己的写作人设和 hub 模型链路**，一律不碰。

---

## 七、还有两处「发现但没动」（按只解决被提问题的规矩）

1. `@local/dsh-local-web` 的 `scriptPath` 硬编码指向 `I:\DSHHome\...\modsearch\dist\main.js`
   —— 也就是 WhiteX 的网页搜索其实**反向依赖正版 DSH 的安装目录**。要做真正独立自包含的包，得把 modsearch 复制进 WhiteX 自己目录并改这一行。本轮没动。
2. `dsh-inkos-panel` 的 `LIBRARY_ROOT` 硬编码 F 盘，旧路由按相对目录名取书；前端若传 G 盘绝对路径给 pipeline/artifacts 会落空。本轮界面改造只给 `gatherEvidence` 局部加了绝对路径支持，其余未扩。

---

## 八、对应的调研报告（另一个文件）

- 插件市场调研：`G:\Users\Administrator\Documents\WriterX\_插件市场调研-20261113.md`
- 桌面插件可移植性体检：`G:\Users\Administrator\Documents\WriterX\_插件可移植性体检-20261113.md`（43,350 B，覆盖 50 个依赖）
