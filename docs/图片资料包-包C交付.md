# 包 C · 编辑器插图轮播 · 交付报告

> 执行者：包 C 叶子节点（未再委派任何子任务）
> 改造契约：`G:\Users\Administrator\Documents\WriterX\_图片资料包-改造契约-v1.md`（§1 分工 / §2.3 frames 数据模型 / §6 轮播 / §7 验收）
> 唯一改动文件：`H:\新建文件夹\WriterX Hermes\app\1007\dsh\node_modules\@writerx\dsh-client-ui-novel-shelf\lib\client.js`
> 时间：2026-11-14 00:17–00:2x +08:00

## 1. 备份（§7.1）

- 命令：`Copy-Item -LiteralPath <client.js> -Destination <client.js>.bak-本地图包改造-C-<时间戳>`（同级目录）
- **备份文件名**：`client.js.bak-本地图包改造-C-20261114-001747`
- 校验：`EXISTS=True`；源文件 1,595,966 B，备份 1,595,966 B（逐字节长度一致）

## 2. 改了哪几段（改后最终行号）

| 段 | 改后行号 | 改动 | 对应契约 |
|:--|:--|:--|:--|
| `figure(item, lost, handlers, classes)` | **L17464–17519**（原 L17464–17492） | 原有 `<figure><img><figcaption><换一张/删除>` 全部保留；新增轮播块 **L17491–17517** | §6 第 1、4、5 条 |
| `illustrationPlugin` 的 `Decoration.widget`（illustration） | **L17562–17568**（原 L17535–17541） | `key` 追加 frames 指纹；新增 `destroy: stopTicking` | §6 第 2 条（清理机制） |
| `startPictureFeed` | **L17695–17720**（原 L17666–17721，整体 +29 行偏移） | **未改一行**，仅行号偏移 | §6 第 4 条（确认不用改数据装载） |
| `reload()` 里 `items = (await listIllustrations(dir, path)).items ?? []` | **L17716** | **未改**，原样透传 | §6 第 4 条 |
| `placeIllustrations(paragraphs, items, docEnd)` | **L6516–6530** | **未改**。逐行核过：只读 `item.id` / `item.anchor` 生成 `Map<id,{pos,lost}>`，不裁剪、不映射、不重建 item 对象 → `frames` 完整保留 | §6 第 4 条（若裁剪才补透传，实际无需补） |
| `illustrationUrl` L6780 / `pictureUrls.illustration` L17752 / `ticking` L17450 / `stopTicking` L17461 | — | **全部未改**，直接复用 | §6 第 1 条 |
| 人物立绘 `portraitCard` / `portraitPlugin`、占位 `placeholder` | — | **未动一行** | §7.4 / 红线 |

### 2.1 figure 轮播块（L17491–17517）做了什么

```js
const frames = Array.isArray(item.frames) ? item.frames.filter((frame) => frame && frame.id) : [];
if (frames.length > 0) {
  const seq = [item, ...frames];                       // 完整序列 = 主图 + 附加帧（§2.3 约定）
  const urls = seq.map((frame) => handlers.src(frame)); // 复用 pictureUrls.illustration → illustrationUrl(dir, id, version)
  // …… badge：右下角 1/N 小字（内联样式，无新 CSS 文件）
  const show = (at) => { image.src = urls[at]; /* 同步 aspectRatio */ badge.textContent = `${at+1} / ${urls.length}`; };
  let at = 0;
  const timer = window.setInterval(() => { at = (at + 1) % urls.length; show(at); }, 3500);
  const previousStop = node.stopTicking;
  node.stopTicking = () => { window.clearInterval(timer); previousStop?.(); }; // 包装既有钩子，不覆盖
}
```

- **URL 拼法**：`handlers.src(frame)` = `pictureUrls.illustration(dir, frame)` = `illustrationUrl(dir, frame.id, frame.version)`（L17752 / L6780）。frame 自带 `{id,version,width,height}`，伪装成 `{id,version}` 即可，未新增任何函数/import。
- **轮播间隔**：**3500 ms**（契约建议 3–4 秒），`setInterval` 循环取模，无上限帧数限制。
- **指示**：右下角 `1 / N` 小字（`position:absolute;right:6px;bottom:6px`，半透明黑底白字 11px，`pointer-events:none`，`aria-hidden`）。锚点靠 CSS `.-lWQkW_illustration{...position:relative}`（文件内已存在，实测确认），未引入新 CSS 文件、未加内联 `position:relative` 覆盖既有布局。
- **单张图（frames 空 / 缺省 / 非数组）**：`frames.length === 0` → 整个块跳过，**不建定时器、不加 badge、不动 DOM 顺序**，行为与改动前完全一致。
- **换一张 / 删除按钮**：事件绑定与 `handlers.onReplace(item)` / `handlers.onRemove(item)` 原样保留，未改签名、未改行为。
- **未加播放/暂停**（契约 §6 明确「不要加播放/暂停也可，保持只读展示」），取只读展示。

### 2.2 定时器清理机制（§6 第 2 条）

链路：`figure` 把 `clearInterval(timer)` 挂到 `node.stopTicking`（包装而非覆盖既有钩子，先 `previousStop?.()` 兜底）→ illustration 的 `Decoration.widget` 补 **`destroy: stopTicking`** → `stopTicking(node)` = `node.stopTicking?.()`（L17461–17463，既有）。

- 与 `placeholder`（pending，L17585）和 `portraitCard`（L17662）用的是**同一个** `destroy: stopTicking` 机制，未另造一套。
- **改动前 illustration 的 widget 没有 `destroy`** —— 这是必须补的一环：不补则 `node.stopTicking` 永不被调用，interval 在 figure 卸载/重建时泄漏并叠加。
- `stopTicking` 用 `?.()`，单张图（无 `node.stopTicking`）安全跳过，不影响旧插图。
- **防叠加的第二道**：widget `key` 从 `ill:id:version:lost:caption` 追加 `:${item.frames?.length ?? 0}:${item.frames?.[0]?.id ?? ""}`。若包 B 更新某条 entry 的 frames 而 version/caption 未变，key 变化 → ProseMirror 重建 DOM → 旧 widget 走 `destroy` 清掉旧 interval → 新 figure 用新序列、新 N。不补这一道会复用旧 DOM、旧定时器继续跑旧序列。

### 2.3 透传核对（§6 第 4 条）

完整链路逐段读过，**确认无需改动**：

```
reload() L17716  items = (await listIllustrations(dir,path)).items ?? []   ← 原样取，不 map
   ↓
push()  L17704  setMeta(illustrationKey, { items, pending })                ← 原对象引用
   ↓
decorations() L17556  placeIllustrations(paragraphs, data.items, end)       ← 只读 id/anchor 出 Map
   ↓
L17559  for (const item of data.items) → figure(item, ...)
```

`placeIllustrations`（L6516–6530）体内只有 `out.set(item.id, {...})`，**不产生新 item、不裁剪字段**，故 `item.frames` 原样到 `figure`。`startPictureFeed` **一行未改**（仅因前段插入 27+1=28 行导致行号从 17666 → 17695 的偏移）。

## 3. 验收（§7）

### 3.1 `node --check <文件>` 原文

```
NODE=C:\Program Files\nodejs\node.exe
v25.2.1
--- node --check ---

EXIT=0
```

- 语法检查跑过**两次**（改动中途一次、最终一次），两次均 `EXIT=0`，**stdout/stderr 全空**。
- **UNDIC / 实验特性 warning：本次未出现**（契约 §7.2 说可能有，实测没有，照实写）。
- 文件完整性：改后 1,597,412 B；`CRLF_LINES=36023`、`LF_ONLY_LINES=0`（全 CRLF，无孤立 LF）；首 3 字节 `119,105,110` = `win`，**无 BOM**、UTF-8 未变。
- 未引入任何新 `import` / `require` / 外部包；只用了文件里已有的 `document` / `window.setInterval` / `window.clearInterval` / 可选链 / `.filter` / 模板串，`react` 与 `react_jsx_runtime` 未动。
- 未删任何无关既有逻辑：portrait 装饰、placeholder 占位、`ticking`、`stopTicking`、`placeIllustrations` 定位算法全部原样。
- 未碰 `@deepseek-ai\`、正版 DSH(I 盘/19387)、`chapters/*.md` 正文、`index.js`（包 B 文件）、`.hermes/illustrations/index.json`。
- **未自行拉起 / 重启 Electron(WTX)**（§8 真机验收由主会话统一做）。

### 3.2 没做成 / 没验证（照实列，不写成已完成）

1. **真机视觉与定时切换未验证**：没有重启 WTX 打开编辑器看轮播是否真的逐帧切换、badge 是否显示在右下角、多帧尺寸切换时布局是否跳动。任务书明确禁止子智能体自行拉起 Electron，留给主会话统一真机验收。
2. **`listIllustrations` 是否真的返回 `frames` 未验证**：这依赖包 B 对 `index.js` 的 `listIllustrations` 扩展（契约 §3）。本包只读不改后端，未调用过真实接口、未读过 `.hermes/illustrations/index.json` 实例数据。若 B 未落 frames，本包轮播块会因 `frames.length===0` 静默退化为单图（不会报错，但也不会轮播）。
3. **`illustrationUrl(dir, frame.id, frame.version)` 对附加帧是否可取到图未验证**：依赖包 B 的 `readIllustration` 按 `entry.frames[].id` 命中返回对应 `.jpg`（契约 §3）。B 未通之前，切到第 2 帧会拿到 404/空图。
4. **多插图同屏并发未实测**：每个 figure 各自的 timer 理论上互不干扰、各自挂自己的 `node.stopTicking`，但未在真浏览器里同时挂 2+ 个多帧插图验证无串台、无焦点抢占、无内存增长。
5. **未做单元 / 集成测试**：打包产物无源码、无构建、无测试框架；本包唯一能跑的静态验证是 `node --check`（已过）。没写测试桩去 mock `handlers.src` / `window.setInterval`。
6. **`frames` 变化但 version/caption 全不变的场景未端到端验证**：key 指纹已按 §2.2 补上，逻辑上会重建 DOM，但没有真实数据触发过这条路径。
7. **播放/暂停未加**（契约标为可选，取只读展示，属主动取舍不是遗漏）。
8. **未验证 `image.loading = "lazy"` 与轮播 `image.src` 切换的交互**：惰性加载在已可见的 figure 上通常不阻碍 src 替换，但真机未看。
9. **换一张 / 删除在多帧插图上的行为未验证**：按钮代码原样保留、`onReplace(item)` 传的仍是主图 item（含 frames），但「换一张」后包 B 是否连同 frames 一起替换、替换期间旧 timer 是否随 widget 销毁清掉，需真机 + B 的 `replace=true` 语义一起验。

## 4. 给主会话的集成核对提示（§8 属主会话，这里只提示）

- C 读的结构 = `item.frames?: [{id, version, width, height}]`，完整序列 = `[item(主图), ...item.frames]`，与契约 §2.3 一致；请核 A 写入 / B 存储是否同构。
- C 拼接 URL 走的是既有 `pictureUrls.illustration(dir, {id,version})`，**要求 B 的 `readIllustration` 能用 frame.id 取到图**（契约 §3 第 5 行）。
- C 依赖 `listIllustrations` 的 items 每条带 `frames`（无则 `[]` 或缺省），C 对缺省做了兼容。

## 5. 结论

包 C 契约 §6 的代码部分已全部落地，`node --check` 0 错误、0 warning，备份齐。**轮播能否在真机上真正动起来，取决于包 B 的 `frames` 落库与按 frame.id 读图是否同时到位**；本包未做真机验收，按令停在这里。
