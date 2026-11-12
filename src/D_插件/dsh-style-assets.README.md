# @local/dsh-style-assets — 文风资产库存储底座（阶段一）

三层结构（原始拆书 → 归一化候选 → 正式文风资产），统一数据契约：外部 ChatGPT 与本地 API 输出完全同一份标准 JSON Schema，ID 全部为全局唯一 UUID。

## 数据根

正式数据根 = `dshHomePath("writerx-style-assets")`（优先走真实持久化路径接口；接口不可达时按同一规则回退：`$DSH_HOME` → `~/.dsh`）。**测试一律 `openStore({ dataRoot })` 显式注入独立临时目录，绝不写真实 DSH_HOME。**

## 目录

```text
<writerx-style-assets>/
├── schema/          三份标准 JSON Schema（随库初始化复制）
├── inbox/analysis/  外部待导入 JSON（成功即移走，失败留此并报原因）
├── inbox/reports/   外部待导入配套 MD
├── analyses/        第一层：原始拆书档案（只进不改，永不直接当文风用）
├── reports/         配套人工阅读报告（analysisId 命名）
├── candidates/      第二层：归一化候选（人工确认闸门）
├── styles/          第三层：正式资产 <uuid>/{meta.json, versions/V*.json, sources.json}
└── registry.json    全库索引
```

## 用法（编程接口）

```js
import { openStore, newId } from "@local/dsh-style-assets";

const store = await openStore({ dataRoot });     // 或不传 dataRoot 走 dshHomePath
await store.init();

await store.importInboxAnalysis("style-analysis-xxx.json", { reportFile: "style-analysis-xxx.md" });
await store.importAnalysis(obj, { report: "# 拆书分析报告…" });   // 编程直灌
await store.createCandidate({ kind: "new-style", members: { analysisIds: [...] },
  proposed: { draftVersion: "V1.0", draft: { name, category, features, prompt, forbidden } } });
await store.publishCandidate(candidateId);        // 作者确认后调用；V1.0 快照不可变
await store.proposeVersion({ styleId, changes: { features: {...} }, analysisIds: [...] });
await store.publishCandidate(newCandidateId);     // V1.1；V1.0 文件不动
await store.archiveStyle(styleId);                // 归档只写 meta.json
await store.exportAssets(backupDir);              // 整库导出
await store.restoreAssets(backupDir, { dryRun: false });  // 基础恢复
```

## 硬规则（实现已内置）

1. `analyses/` 只进不改：重复 analysisId 拒绝导入且不覆盖旧文件（E_DUPLICATE_ANALYSIS_ID）。
2. 已发布版本快照不可覆盖（COPYFILE_EXCL，E_VERSION_EXISTS）；归档状态只写 meta.json。
3. 合并/拆分/覆盖/发布永不自动执行——`publishCandidate` 只在候选 proposed/confirmed 时可用，由上层（作者确认流程）调用。
4. 不把整本小说原文复制进库：Schema 只收来源信息、章节位置与 ≤2000 字证据摘句。
5. 所有写盘：临时文件（wx 独占创建）+ rename / COPYFILE_EXCL，进程中断不产生半写文件。

## 测试

```powershell
& 'H:\新建文件夹\WriterX Hermes\app\1007\node\node.exe' test\stage1.test.mjs
```

九项验收在 `%TEMP%\writerx-style-assets-test\<uuid>\` 独立临时目录跑，真实数据根只在最后的生产初始化脚本里显式建立。

## 阶段一不含

AI 拆书、文风融合界面、写作注入链、DSH 工具注册、卷/段落/场景覆盖解析（仅按数据契约预留 analysisId/styleId/UUID 字段）。
