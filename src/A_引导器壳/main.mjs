// WriterX Hermes 引导器：运行时层（根目录 resources\app.asar）里的 Electron 入口（实施规格 §6「启动顺序」）。
//
// 它只做四件事：拿单实例锁、选出这次启动哪个载荷 build、把记账方法挂到 globalThis.__hermesBoot、
// 再 import 载荷的 app.asar\src\main.js。选版本和记账的规则全在 launch.mjs（纯函数，有测试），
// state.json 的读写在 state-file.mjs，验签在 verify.mjs。这个文件只是把 Electron 的东西注入进去，
// 尽量薄：它跟运行时层一起发，几乎永远不改，改错了只能靠安装器救。
//
// 必须是 ESM 并在顶层 await 载荷的导入：Electron 会等入口的顶层代码跑完才触发 ready，
// 载荷 main.js 在顶层注册的 whenReady 等逻辑才能照旧生效。载荷也是 ESM，Electron 33 的 Node 20
// 不能 require(esm)，所以只能 import()。
import { app, dialog } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyEngineStarting,
  applyHealthy,
  applyImportFailure,
  applyImportSuccess,
  applyLoginReady,
  applyMarkBad,
  applyRollbackSeen,
  applyStage,
  applyUnstage,
  createLaunchFlags,
  decideLaunch,
  planStartup,
  resolveHomes,
  rollbackTarget,
} from './launch.mjs'
import { appendJournal, readStateFile, writeStateAtomic } from './state-file.mjs'
import { createProbe, scanBuildDirs } from './verify.mjs'

// 载荷目录里的 app.asar 是普通文件：算大小、读清单、写 state 一律用 original-fs，
// 不然 Electron 会把带 .asar 的路径当成虚拟目录。引导器自己的 json 在根 asar 里，反而要用打过补丁的 fs 读。
const ofs = createRequire(import.meta.url)('original-fs')
const BOOT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PRODUCT_NAME = 'WriterX Hermes'
const INCOMPLETE_MESSAGE = '程序文件不完整，请重新安装 WriterX Hermes。'

let journalFile = null

const now = () => new Date().toISOString()
const clone = value => (value === null || value === undefined ? null : JSON.parse(JSON.stringify(value)))

// 日志里不留用户名：报错堆栈里的用户目录换成 ~。
function errorText(error) {
  let message = String(error?.stack ?? error?.message ?? error).slice(0, 2000)
  const home = os.homedir()
  if (home) message = message.split(home).join('~').split(home.replace(/\\/g, '/')).join('~')
  return message
}

// 和壳里的 journal.mjs 同一个文件、同样的行格式 { at, event, ...字段 }，多带 source: 'boot' 区分是谁写的。
function journal(entry) {
  if (journalFile === null) return
  appendJournal(journalFile, { at: now(), event: entry.event, source: 'boot', ...entry }, ofs)
}

function showIncomplete() {
  // Windows 上 showErrorBox 在 ready 之前也能弹（Electron 文档写明可以在 ready 前调用），
  // 这里不能等 ready：入口还在顶层 await 里，ready 要等它跑完才会来。
  try {
    dialog.showErrorBox(PRODUCT_NAME, INCOMPLETE_MESSAGE)
  } catch {
    // 弹不出来也要退出
  }
}

function giveUp() {
  showIncomplete()
  app.exit(1)
}

function probeWritable(dir) {
  const file = path.join(dir, `.writerx-write-test-${process.pid}-${Date.now()}.tmp`)
  let written = false
  try {
    ofs.closeSync(ofs.openSync(file, 'wx'))
    written = true
  } catch {
    written = false
  }
  try {
    ofs.rmSync(file, { force: true })
  } catch {
    // 删不掉的探测文件不影响判断
  }
  return written
}

function readBootJson(name) {
  return JSON.parse(readFileSync(path.join(BOOT_DIR, name), 'utf8'))
}

function hasStateFile(updateHome) {
  return ofs.existsSync(path.join(updateHome, 'update', 'state.json'))
}

async function boot() {
  const homes = resolveHomes({
    execPath: process.execPath,
    localAppData: process.env.LOCALAPPDATA,
    isWritable: probeWritable,
    hasState: hasStateFile,
    // 8.3 短路径、联接、subst 盘符启动时 execPath 写法不同；取真实路径，安装 id 和 updateHome 才稳定。
    realpath: dir => ofs.realpathSync.native(dir),
  })
  const updateDir = path.join(homes.updateHome, 'update')
  const stateFile = path.join(updateDir, 'state.json')
  journalFile = path.join(updateDir, 'journal.jsonl')

  let runtimeId
  let keys
  try {
    runtimeId = readBootJson('runtime.json').id
    const keyFile = readBootJson('update-keys.json')
    keys = (Array.isArray(keyFile?.keys) ? keyFile.keys : []).map(key => key?.raw).filter(raw => typeof raw === 'string' && raw !== '')
  } catch (error) {
    journal({ event: 'boot-config-unreadable', message: errorText(error) })
    return giveUp()
  }
  if (typeof runtimeId !== 'string' || runtimeId === '') {
    journal({ event: 'boot-config-unreadable', message: 'runtime id missing' })
    return giveUp()
  }
  // 没有公钥就验不了任何载荷：probe 全部不过，下面自然走到「程序文件不完整」。
  if (keys.length === 0) journal({ event: 'no-public-keys' })

  const read = readStateFile(stateFile, ofs)
  if (read.status === 'corrupt' || read.status === 'error') journal({ event: 'state-unreadable', status: read.status, code: read.error })
  const probe = createProbe({ appDirs: homes.appDirs, fs: ofs, keys, runtime: runtimeId })
  const deps = { probe, scanBuilds: () => scanBuildDirs(homes.appDirs, ofs), now, installRoot: homes.installRoot }
  const plan = planStartup(read, deps)
  // state.json 在却读不了：这一整次启动都不写它（见 launch.mjs planStartup），免得拿猜出来的状态盖掉真的。
  const writable = plan.writable
  if (!writable) journal({ event: 'state-readonly-session' })

  const persist = state => {
    if (!writable) return false
    try {
      writeStateAtomic(stateFile, state, ofs)
      return true
    } catch (error) {
      journal({ event: 'state-write-failed', code: String(error?.code ?? 'unknown') })
      return false
    }
  }

  let decision = plan.decision
  for (const entry of decision.events) journal(entry)
  if (plan.persist && !persist(decision.state) && decision.launch?.trial) {
    // 试运行的计数记不下来，就不能试运行：不然起不来的新版本每次都会被当成第一次试，永远回不到上一版。
    journal({ event: 'trial-skipped', build: decision.launch.build })
    decision = decideLaunch({ ...decision.state, pending: null }, deps)
    for (const entry of decision.events) journal(entry)
  }

  const { launch } = decision
  if (launch === null) return giveUp()

  let current = decision.state
  let flags = createLaunchFlags(launch)
  const root = launch.root
  const { build, version } = launch.manifest

  // 每个方法都同步、不抛出：出错只记日志，返回失败的结果。
  const guard = (method, fallback, action) => {
    try {
      return action()
    } catch (error) {
      journal({ event: 'boot-method-failed', method, message: errorText(error) })
      return fallback
    }
  }
  // 健康记账：写盘失败也照样采用内存里的新状态，下一次写成功时一起落盘，前后不会对不上。
  // flags 不管 state 变没变都采用：engineStarting 不退计数时也要记下「这次起过引擎」。
  const account = (apply, event) => guard(event, false, () => {
    const result = apply(current, flags)
    if (result.flags !== undefined) flags = result.flags
    if (!result.changed) return true
    current = result.state
    journal({ event, build })
    return persist(current)
  })

  globalThis.__hermesBoot = {
    schema: 1,
    runtime: runtimeId,
    installRoot: homes.installRoot,
    updateHome: homes.updateHome,
    appDirs: [...homes.appDirs],
    root,
    build,
    version,
    get previous() {
      return guard('previous', null, () => rollbackTarget(current, flags))
    },
    trial: launch.trial,
    // false：state.json 在却读不了，这次启动只读（stage / unstage / markBad 都会返回 state-unreadable）。
    writable,
    get rollback() {
      return guard('rollback', null, () => clone(current.rollback))
    },
    publicKeys: [...keys],
    loginReady: () => account((state, launchFlags) => applyLoginReady(state, launchFlags), 'trial-refunded'),
    engineStarting: () => account((state, launchFlags) => applyEngineStarting(state, launchFlags), 'trial-recharged'),
    markHealthy: () => account((state, launchFlags) => applyHealthy(state, launchFlags), 'healthy'),
    stage: target => guard('stage', { ok: false, reason: 'error' }, () => {
      if (!writable) return { ok: false, reason: 'state-unreadable' }
      const result = applyStage(current, target, { probe, now }, flags)
      if (!result.ok) {
        journal({ event: 'stage-refused', build: target, reason: result.reason })
        return { ok: false, reason: result.reason }
      }
      // 登记没落盘就当没登记：不然界面说「下次启动生效」，下次启动却不认。
      if (!persist(result.state)) return { ok: false, reason: 'state-write-failed' }
      current = result.state
      journal({ event: 'stage', build: target })
      return { ok: true }
    }),
    unstage: () => guard('unstage', { ok: false, reason: 'error' }, () => {
      if (!writable) return { ok: false, reason: 'state-unreadable' }
      const result = applyUnstage(current, flags)
      if (!result.ok) return { ok: false, reason: result.reason }
      if (!result.changed) return { ok: true }
      if (!persist(result.state)) return { ok: false, reason: 'state-write-failed' }
      journal({ event: 'unstage', build: current.pending?.build ?? null })
      current = result.state
      return { ok: true }
    }),
    markBad: (target, reason) => guard('markBad', { ok: false, reason: 'error' }, () => {
      if (!writable) return { ok: false, reason: 'state-unreadable' }
      const result = applyMarkBad(current, target, reason, { now }, flags)
      if (!result.ok) return { ok: false, reason: result.reason }
      current = result.state
      journal({ event: 'mark-bad', build: target, reason: String(reason ?? '').slice(0, 64) })
      return persist(current) ? { ok: true } : { ok: false, reason: 'state-write-failed' }
    }),
    readState: () => guard('readState', null, () => clone(current)),
    rollbackSeen: () => account(state => applyRollbackSeen(state), 'rollback-seen'),
  }

  app.setName(PRODUCT_NAME)
  app.setVersion(version)

  try {
    await import(pathToFileURL(path.join(root, 'app.asar', 'src', 'main.js')).href)
  } catch (error) {
    const result = guard('importFailure', null, () => applyImportFailure(current, flags, { probe, now }))
    const saved = result !== null && persist(result.state)
    if (result !== null) current = result.state
    journal({ event: 'import-failed', build, trial: launch.trial, action: result?.action ?? 'exit', message: errorText(error) })
    // 只有记账落了盘才自动重启：记不下来还重启，会一直重启同一个起不来的版本。
    if (saved && result.action === 'relaunch') {
      app.relaunch()
      app.exit(1)
      return
    }
    return giveUp()
  }

  // 导入失败只算连续的，导入成功就清零（见 launch.mjs applyImportSuccess）。
  guard('importSuccess', null, () => {
    const result = applyImportSuccess(current)
    if (!result.changed) return
    current = result.state
    persist(current)
  })
}

// 拿不到单实例锁就直接退出，不读也不写 state.json：双击两次不该白白用掉一次试运行。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  await boot()
}
