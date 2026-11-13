# 包 B · Host 后端 交付报告（本地图片资料包改造 v1）

- 目标文件（唯一改动的生产文件）：`H:\新建文件夹\WriterX Hermes\app\1007\dsh\node_modules\@writerx\dsh-client-ui-novel-shelf\lib\index.js`
- 契约：`G:\Users\Administrator\Documents\WriterX\_图片资料包-改造契约-v1.md`（§1 分工 / §2 数据模型 / §3 路由 / §7 验收）
- 施工时间：2026-11-14 00:16–00:40 +08:00
- 改动性质：打包 ESM bundle 直改 js；**未新增任何 import/require**（顶部 11 行 import 原样，仅复用 `node:crypto`(randomBytes)、`node:fs/promises`(readFile/readdir/realpath/stat/mkdir/rm/writeFile)、`node:path`(extname/isAbsolute/isInside 用的 resolve/sep) 等已有符号）

---

## 1. 备份（验收 1）

```
index.js.bak-本地图包改造-B-20261114-001638   211123 字节
```
同级目录，`Copy-Item -LiteralPath` 复制，改前生成。

---

## 2. 新增路由清单（契约 §3，逐字对齐）

全部挂在 `/novel-shelf` 前缀下（`apply()` L3375 起注册，未改）。四条都过 serve 顶部 `assertTrustedRequest`（L3584，loopback 围栏，未绕开）。

| 方法 | 路径 | 入参 | 返回 | 落点 |
|:--|:--|:--|:--|:--|
| GET | `/novel-shelf/image-packs` | `?dir=<书目录>` | `{packs:[...]}`（读 `<dir>/图片包/资料包.json`；坏/缺→`{packs:[]}`，不写不覆盖） | serve if 链 L4152–4155 → `readImagePacks()` L4641 |
| POST | `/novel-shelf/image-packs` | `?dir` + JSON `{packs:[...]}` | `{packs}`（先建 `图片包/` 目录，书目录内安全写） | serve if 链 L4156–4161 → `writeImagePacks()` L4658 |
| GET | `/novel-shelf/local-images` | `?root=<绝对路径>&sub=<root 内相对子目录,可空>` | `{entries:[{name,kind,ext,path}],total}` | serve 顶部早分派 L3638–3642 → `serveLocalImages()` L4712 → `listLocalImages()` L4667 |
| GET | `/novel-shelf/local-image` | `?root&path=<root 内相对路径>` | 图片原始字节，content-type 按扩展名，`x-content-type-options:nosniff`，`cache-control:no-store` | 同上 → `readLocalImage()` L4695 |

**分派位置说明**：`local-images` / `local-image` 不带 `dir`（用 `root`），故在 serve 的 `dir` 必填检查（L3647）**之前**早分派，仿现有 `progress`/`candidate` 的写法；函数内又显式二次调用 `assertTrustedRequest`。`image-packs` 带 `dir`，走正常 if 链，插在 portrait/remove 之后、illustrations 之前。

**错误映射**：`local-*` 自成 try/catch，把 `ShelfRouteError.status` 直接映射为 HTTP（400/404/413/500），沿用 `writeJson`。`image-packs` 复用 serve 外层 catch（L4296 起：BookImageError / ShelfRouteError / HistoryError 分支）。

---

## 3. 护栏实现位置（契约 §3「护栏」7 条，全部写进代码注释 L4557–4575）

| # | 护栏 | 实现 |
|:--|:--|:--|
| 1 | root 绝对路径 + stat 是目录，不存在→404 | `localImageRoot()` L4590–4606：`isAbsolute` + `realpath` + `stat().isDirectory()`，ENOENT→404 |
| 2 | sub/path 禁 `..`/绝对路径/盘符；realpath 校验落在 root 内（软链/junction 逃出去→400） | `localImageTarget()` L4613–4638：段级 `..`/空段/`[A-Za-z]:`/前导 `/` 拒绝 → 词法 `isInside` → `realpath` 真实落点再 `isInside`，越界 400 |
| 3 | 图片扩展名白名单（大小写不敏感），其它文件不列、读时 400 | `LOCAL_IMAGE_TYPES` Map L4567–4574（.jpg/.jpeg/.png/.webp/.gif/.bmp → mime）；`listLocalImages` L4686 只列白名单；`readLocalImage` L4698 非白名单 400 |
| 4 | 单图 ≤8MB（超→413） | `LOCAL_IMAGE_BYTES` L4575；`localImageTarget({mustBeFile:true})` L4633 按 stat.size，`readLocalImage` L4707 读后再按实际字节复核，均 413 |
| 5 | 单目录最多 500 项 | `LOCAL_IMAGE_DIR_LIMIT` L4576；`listLocalImages` L4681 `entries.length>=500` 截断；隐藏项（`.` 开头）跳过，按目录优先+名称排序，分包可下钻 |
| 6 | image-packs POST 只写书目录内 | `writeImagePacks()` L4658：`safeTarget(dir,"图片包",true)`（内含 `confined` L1785 + `realpath` 防软链 L1792）建目录，`safeTarget(dir,"图片包/资料包.json",true)` 定位，`writeAtomic` 写入；不写书外 |
| 7 | 新增只读路由仍过 `assertTrustedRequest` | serve 顶部 L3584 统一调用未动；`serveLocalImages` L4714 再显式调一次；`image-packs` 走 serve 主链天然过 |

---

## 4. frames 扩展（契约 §2.3 / §3「落书三路由复用+扩展」）

主体 cover/portrait/illustration 逻辑**保持不动**，只加 frames：

| 函数 | 改后行号 | 改动 |
|:--|:--|:--|
| `decodeFrames()`（新增） | L4580–4588 | 可选 `body.frames` 逐张 `decodeJpeg(…, ILLUSTRATION_BYTES)`（4MB、JPG、jpegSize），长边≤`ILLUSTRATION_EDGE`(1600)、与 `width/height` 一致；非数组→400；`undefined`→`[]`（老请求兼容） |
| `isFrame`（新增） | L4578 | 帧记录合法性（id 12 位 hex + version），老索引没 frames 一律 `[]`、不报 409 |
| `listIllustrations()` | L3186–3200（改在 L3190–3194） | items 每条 `frames: Array.isArray(item.frames)?filter(isFrame):[]`，透传给编辑器轮播（包 C） |
| `readIllustration()` | L3241–3259 | 主图按 `entry.id` 找；找不到再在所有 entry 的 `frames` 里按 `frame.id` 找，返回该帧 `.jpg` 字节 + **该帧自己的 version**；找不到 404 |
| `writeIllustration()` | L3268–3329 | ① `frameImages = decodeFrames(body.frames)` L3277；② `replace=true` 时旧 entry 的 `frames` 连同主图一起 `trashHiddenFile(copy:true)` + `after(rm)` L3289–3297；③ 每帧 `frameId=randomBytes(6).toString("hex")` 另存 `.hermes/illustrations/<frameId>.jpg`，和主图一起走 `updateIndex` 的 `stage`（沿用 `publishTogether`/`settle` 原子语义）L3299–3311；④ entry 写 `frames:[{id,version,width,height}]`，**只存附加帧**，单张不写 frames 字段（不改老索引结构）L3312–3324 |
| `removeIllustration()` | L3333–3357 | 删图时把 `entry.frames` 对应 jpg 一并进回收站 + `after(rm)` L3347–3353 |

约定：完整序列 = `[主图, ...frames]`（契约 §2.3），主图 `id` 仍是第一帧 id。老数据无 frames → 单张处理，全流程不报 409、不改索引结构。

---

## 5. IMAGE_BODY_LIMIT 调整

- `IMAGE_BODY_LIMIT = 8MB` L4550 **保持不变**（portrait POST L4136、其它既有路由不受影响）。
- 新增 `ILLUSTRATION_BODY_LIMIT = 40 * 1024 * 1024` L4556，**只用于 `POST /novel-shelf/illustration`**（L4175，原 `readBody(req, IMAGE_BODY_LIMIT)` 改为 `readBody(req, ILLUSTRATION_BODY_LIMIT)`）。
- 理由（写在 L4551–4555 注释）：主图≤4MB + 整包多帧每帧≤4MB + base64 约 1/3 膨胀，8MB 装不下「主图+多帧」一次 JSON；每帧字节仍由 `decodeJpeg` 的 `ILLUSTRATION_BYTES`(4MB) 单独闸住，放宽的只是 JSON 请求体上限，cover/portrait 不动。

---

## 6. node --check 原文（验收 2）

```
NODE=node
--- node version ---
v25.2.1
--- check again with explicit marker ---
STDOUT_STDERR=[]
EXITCODE=0
```

首轮复验同样 `EXIT=0`、零输出。**0 错误，无 UNDIC 实验特性 warning**（本机系统 Node v25.2.1；WTX 内置 node.exe 在猜测的 3 个路径下均未找到，按契约 §7「系统 node 均可」用系统 node 验收）。
改后文件 5035 行、CRLF、无 BOM；顶部 11 行 import 逐行复核无新增。

---

## 7. 未做成 / 未验证（如实列，验收 7 / 契约 §7.6）

- **未做真机重启 WTX / Electron**（按本包红线「不要自己拉起/重启 Electron」），四条新路由与 frames 落书链路**没有做运行时 HTTP 实测**，只做了静态代码复核 + `node --check` 语法验收。
- **未真调接口**：没有实际请求 `image-packs`/`local-images`/`local-image`/`illustration`，因此「坏/缺资料包.json 回退 `{packs:[]}`、目录列 500 截断、8MB 413、扩展名 400、软链/junction realpath 逃逸 400」都是代码级实现，未构造真实 junction / 大文件 / 坏 JSON 做黑盒验证。
- **frames 落书/换图/删图的回收站与原子回退语义**：沿用既有 `publishTogether`/`settle`/`trashHiddenFile(copy:true)`+`after(rm)` 组合，逻辑复核通过，但未跑一次真实「整包插入 → replace → remove」端到端。
- **40MB body 上限**未做真实大包压力测试（未验证 WTX 的 HTTP 层是否另有更小上限拦截）。
- **未改任何书目录 `index.json` / `chapters/*.md`**（真机验收由主会话统一做）；本包只动 `index.js` 这一个生产文件 + 一份备份 + 本报告。
- **未与包 A（client.js 面板）/ 包 C（编辑器轮播）联调**：三包并行，写入范围不相交；路由名/参数、`frames` 结构按契约 §3/§2.3 对齐，集成核对点属契约 §8 由主会话完成。
- **未发现需回滚的问题**：备份完好；若运行时实测发现问题，可直接从 `.bak-本地图包改造-B-20261114-001638` 恢复。

---

## 8. 改动清单汇总

| 段 | 行号（改后） | 内容 |
|:--|:--|:--|
| listIllustrations | L3186–3200 | items 带 frames |
| readIllustration | L3241–3259 | 按 frame.id 读帧 + 帧 version |
| writeIllustration | L3268–3329 | frames 校验/落 stage/旧帧回收/entry.frames |
| removeIllustration | L3333–3357 | 删图连帧进回收站 |
| serve 早分派 | L3638–3642 | local-* 不带 dir，dir 检查前分派 |
| serve if 链 | L4151–4161 | image-packs GET/POST |
| serve illustration POST | L4172–4176 | body 上限改 40MB |
| 新常量+helpers | L4550–4732 | ILLUSTRATION_BODY_LIMIT / 白名单 / isFrame / decodeFrames / localImageRoot / localImageTarget / readImagePacks / writeImagePacks / listLocalImages / readLocalImage / serveLocalImages |

**新增函数**：`decodeFrames`、`localImageRoot`、`localImageTarget`、`readImagePacks`、`writeImagePacks`、`listLocalImages`、`readLocalImage`、`serveLocalImages`（8 个）+ 常量 `ILLUSTRATION_BODY_LIMIT`/`LOCAL_IMAGE_TYPES`/`LOCAL_IMAGE_BYTES`/`LOCAL_IMAGE_DIR_LIMIT`/`isFrame`。无新 import，未删任何既有逻辑。
