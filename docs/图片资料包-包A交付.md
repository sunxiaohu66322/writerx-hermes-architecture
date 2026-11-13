# 包 A · 前端面板交付（WriterX 本地图片资料包改造）

- 唯一改动文件：`H:\新建文件夹\WriterX Hermes\app\1007\dsh\node_modules\@writerx\dsh-client-ui-creation-tools\lib\client.js`
- 改前备份：`client.js.bak-本地图包改造-A-20261114-002747`（同级目录，`-LiteralPath` 复制，已核验存在）
- 契约：`G:\Users\Administrator\Documents\WriterX\_图片资料包-改造契约-v1.md`（§1 分工 / §2 数据模型 / §3 B 路由 / §4 落书 / §5 面板 / §7 验收）
- 未写其它任何文件；未碰 `@deepseek-ai`、正版 DSH、`chapters/*.md`；未起/重启 Electron。

## 1. 改了哪几段（改后行号范围）

| 段 | 行号（改后） | 内容 | 契约 |
|:--|:--|:--|:--|
| 全局文案 | 全文（注释 / 两处 ToolDialog title / 侧栏菜单 / 事件标签） | 「AI 配图」→「图片资料包」，去掉「生图服务没开即将上线」说明 | §5 名称、§5 第 3 条 |
| STUDIO_MODES | ~7915 起（原 L7793–7821） | 三档 button 改「设为封面 / 设为立绘 / 插入这一段」 | §5 用途三档 |
| 模块注释 + DESCRIPTION / FOOT_HINT / HELD_HINT | ~8346 起（原 L8219–8230） | 改为本地资料包说明，去掉云端进度 / 扣费文案 | §5 |
| **新增落书函数组** | ~1077–1176（插在 `placeImage` 之后、`//#region store.ts` 之前） | `localImageUrl` · `fetchLocalBlob` · `localPlaceError` · `placeLocalImage` | §4 |
| **ImageStudioDialog 整体替换** | **L8410–8712**（原 L8286–9499） | 云端生图面板 → 本地图片资料包面板 | §5 全节 |
| CreationToolsEntry | ~9271 起（原 L10034–10135） | 删 `imageOpen = useImageServiceOpen()`；`soonOf` 不再看云端服务，菜单始终可点 | §5 第 3 条 |
| 入口菜单 hint | ~9237 | 「封面、人物立绘、场景插图」→「登记本机图片文件夹，选图放进书里」 | §5 |
| 导出段 | ~9895 | `exports.ImageStudioDialog` 等**未动** | §7.4 |

## 2. 新增函数（模块级，无新 import/require，只用文件内既有 react / react_jsx_runtime / 浏览器内置 API）

| 函数 | 作用 | 契约 |
|:--|:--|:--|
| `localImageUrl(root, path)` | 拼 `/novel-shelf/local-image?root=..&path=..`（B 早分派、**不带 dir**，与 B 实测实现对齐） | §3 |
| `fetchLocalBlob(root, path)` | `fetch` → `response.blob()`，失败拆中文错误 | §3 / §4 |
| `localPlaceError(reason)` | BOOK_BUSY / BOOK_NOT_OPEN / TOO_LARGE 中文提示 | §4 |
| `placeLocalImage({bookDir,target,blob,frames?,replace?})` | 复用 `createImageBitmap` + `drawJpeg` + `topCrop` / `fitLongEdge` / `avatarRect`；cover→`POST /cover {data}`；portrait→`POST /portrait {name,data,avatar,framing,jobId,replace}`；illustration→`POST /illustration {name,anchor,caption,data,width,height,jobId,replace,frames?}`；`frames` 每帧裁成长边 ≤1600 JPEG → `[{data,width,height}]`；成功后 `notifyBookImages` | §4 全节 |

面板内主流程函数：`reloadBookImages`（`/tree?view=all` 取正文 → 逐文件 `listIllustrations` 汇总已放入的图，区分单图 / 图片包，可删走 `POST /illustration/remove`）、`loadEntries`（`GET /local-images`，支持子目录下钻）、`addPack` / `delPack`（`GET|POST /image-packs`）、`place`（组 target + 取 blob/frames + 落书）。

## 3. 路由对齐（与 B 已落地实现逐条读过）

- `GET /novel-shelf/image-packs?dir=` / `POST .../image-packs?dir=` body `{packs:[...]}` —— B L4152–4160。
- `GET /novel-shelf/local-images?root=&sub=` —— B L3638–3641 早分派、L4715，返回 `{entries:[{name,kind,ext,path}],total}`。
- `GET /novel-shelf/local-image?root=&path=` —— B L4719，缩略图 `<img src>` 与落书 blob 都走它。
- `POST /cover` / `/portrait` / `/illustration`（新增可选 `frames`）—— B `decodeFrames` L4580 校验 base64 JPEG / 长边≤1600 / 尺寸一致，与 A 裁帧一致。
- `GET /illustrations` / `POST /illustration/remove` / `GET /illustration?id=&v=` / `GET /tree?view=all` —— 既有路由，原样复用。

## 4. 面板要求逐条

- ✅ 左栏：资料包清单 + 包内图纸缩略图网格（`/local-image`），空态「还没有登记资料包」；子目录可下钻。
- ✅ 右栏：登记资料包（显示名 + 本机文件夹绝对路径 + 备注 → POST 追加；可删登记项，删登记不动磁盘）；用途三档沿用 `STUDIO_MODES`；选图方式「单张 / 整包轮播」。
- ✅ 整包仅 illustration：第一张作主图、其余作 frames；封面/立绘选多张提示「封面/立绘请用单张」；`pickMode` 切到非 scene 自动回 single。
- ✅ 场景插图沿用 `request.paragraph.file / anchor`，未动 `IMAGE_STUDIO_OPEN_EVENT` 事件名与 payload 形状（`creationToolsStore.openImage(sessionId, detail, focus)` 原样）。
- ✅ 底部「本书已放入的图」读 `listIllustrations`，展示单图 / 图片包 N 张，可删。
- ✅ 「打开图库文件夹」改为展示登记 root 路径文本 + 「复制路径」，不留死链。
- ✅ 主流程不再调 `imageCreate / imageCatalog / imageBalance / imageSetPlacement / imageRead`；`onPurchase` / `onLogin` 保留 props 兼容签名、无主分支使用；旧 `imageObjectUrl` / `imageBlob` / `placeImage` 保留兜底未删。
- ✅ 去掉生图余额、按张扣费、购买生图包、画风/模型、画幅、参考图、云端进度文案（新面板内零命中）。
- ✅ 未删起名 / 拆书 / 蒸馏共用外壳与 store；`Stage` / `Gallery` / `RecordActions` / `StylePicker` / `NamingDialog` / `NovelDecomposeDialog` / `StyleDistillDialog` 定义全部保留（新面板不再渲染前四个）。

## 5. node --check 原文

``
命令：node --check "H:\新建文件夹\WriterX Hermes\app\1007\dsh\node_modules\@writerx\dsh-client-ui-creation-tools\lib\client.js"
stdout+stderr：[]   ← 空输出
EXIT=0
``

无 UNDIC 实验特性 warning（本文件未触发），0 错误。另做静态一致性核查 30 项全 OK（新面板内无云端桥调用、事件名/payload 未变、旧函数全在、无新增 require、`AI 配图` 全文零命中）。

## 6. 没做成 / 没验证（如实）

1. **未做真机验收**：按令不拉起 / 重启 Electron（WTX），未打开面板点过按钮；语法与静态核查通过 ≠ 界面可用。
2. **未实测 HTTP 路由返回**：B 三条新路由由包 B 并行实现，本包只读其代码对齐参数，没有真发 `GET /image-packs` / `GET /local-images` / `GET /local-image`，也没有真 POST 落书一次；跨包集成由主会话统一验。
3. **未验证编辑器轮播真的切换**：`frames` 已按 §2.3 结构产出（只存除主图外的附加帧），但编辑器 `figure()` 的轮播是包 C 的职责，未跑。
4. **未验证「本书已放入的图」整本汇总在真书上的表现**：实现走 `/tree?view=all` 递归取正文 + 逐文件 `listIllustrations`，正文很多时是并发请求；真书目录结构与性能未实测。
5. **旧模块级残留字面量**：通用错误码表 `ERROR_TEXT.IMAGE_QUOTA_EXHAUSTED`（L652）、`LABELS`（L1307）、以及旧工作台纯逻辑 `costLine` / `studioPrefs` / `Stage` 文案里仍有「生图余额 / 购买生图包 / 生成插图」等字样 —— 它们是起名 / 拆书 / 蒸馏共用的通用表与保留未删的旧函数，按红线「不删无关既有逻辑」保留；**新面板主流程不调用这些分支**。
6. **「打开图包文件夹」未接系统文件管理器**：按契约允许的替代做法，展示 root 路径 + 复制按钮，没有系统跳转。
7. **props 兼容**：`CreationToolsOverlay` 仍向本面板传 `onPurchase` / `onLogin`（签名保留），面板内不使用；未改 overlay 传参（避免动别的工具）。

---
结论：包 A 代码改造完成、语法与静态核查通过；功能是否真正可用待主会话重启 WTX 后与 B / C 一起真机验收。