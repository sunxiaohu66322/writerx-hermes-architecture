// 引导器的选版本与记账（实施规格 §3、§6）。这里全是纯函数：不碰磁盘、不碰 Electron，
// 版本目录能不能用由调用方注入的 probe 回答，写盘由 main.mjs 通过 state-file.mjs 做。
// 每个 apply* 都返回新的 state（和 flags），不改传进来的对象，这样写盘失败时调用方还能退回原样。
import { createHash } from 'node:crypto'
import path from 'node:path'

/** bad 列表只留最近这么多条（实施规格 §6）。 */
export const BAD_LIMIT = 10
/** pending 被扣到这么多次还没确认健康，下次启动就回到上一版。 */
export const MAX_TRIES = 2
/** 不是试运行的版本连续导入失败这么多次，并且 previous 能用，就回到 previous。 */
export const MAX_IMPORT_FAILURES = 2

const isBuild = value => Number.isSafeInteger(value) && value > 0
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = value => (Number.isSafeInteger(value) && value > 0 ? value : 0)
const text = (value, fallback = null) => (typeof value === 'string' ? value : fallback)

function cloneState(state) {
  return {
    ...state,
    pending: state.pending === null ? null : { ...state.pending },
    bad: state.bad.map(entry => ({ ...entry })),
    rollback: state.rollback === null ? null : { ...state.rollback },
  }
}

function reasonText(reason) {
  return typeof reason === 'string' && reason !== '' ? reason.slice(0, 64) : 'unknown'
}

function withBad(state, build, reason, at) {
  const bad = state.bad.filter(entry => entry.build !== build)
  bad.push({ build, reason: reasonText(reason), at })
  return { ...state, bad: bad.slice(-BAD_LIMIT) }
}

const isBad = (state, build) => state.bad.some(entry => entry.build === build)

// 依赖既可以是 { probe, now }，也可以只给一个 probe 函数（now 用当前时间）。
function depsOf(deps) {
  if (typeof deps === 'function') return { probe: deps, now: () => new Date().toISOString() }
  return { probe: deps?.probe, now: typeof deps?.now === 'function' ? deps.now : () => new Date().toISOString() }
}

function safeProbe(probe, build) {
  try {
    const result = probe(build)
    return isObject(result) ? result : { ok: false, reason: 'probe' }
  } catch {
    return { ok: false, reason: 'probe' }
  }
}

/**
 * 把读到的 state.json 整理成干净的形状：缺的补上、类型不对的丢掉、bad 去重并截到 10 条。
 * pending 不比 active 新的也丢掉（stage 不会写出这种状态，出现了只能是文件被改过）。
 * @param {unknown} raw readState 的结果；null 表示没有或坏了
 * @param {string} installRoot
 * @returns {object} schema 1 的 state
 */
export function normalizeState(raw, installRoot) {
  const source = isObject(raw) && raw.schema === 1 ? raw : {}
  const active = isBuild(source.active) ? source.active : null
  const previous = isBuild(source.previous) && source.previous !== active ? source.previous : null
  let pending = null
  if (isObject(source.pending) && isBuild(source.pending.build) && (active === null || source.pending.build > active)) {
    pending = { build: source.pending.build, tries: count(source.pending.tries), stagedAt: text(source.pending.stagedAt) }
  }
  const bad = []
  for (const entry of Array.isArray(source.bad) ? source.bad : []) {
    if (!isObject(entry) || !isBuild(entry.build)) continue
    const at = bad.findIndex(item => item.build === entry.build)
    if (at !== -1) bad.splice(at, 1)
    bad.push({ build: entry.build, reason: reasonText(entry.reason), at: text(entry.at) })
  }
  let rollback = null
  if (isObject(source.rollback)) {
    const { from, to } = source.rollback
    rollback = {
      from: isBuild(from) ? from : null,
      to: isBuild(to) ? to : null,
      reason: reasonText(source.rollback.reason),
      at: text(source.rollback.at),
      seen: source.rollback.seen === true,
    }
  }
  return {
    schema: 1,
    installRoot,
    active,
    previous,
    pending,
    bad: bad.slice(-BAD_LIMIT),
    rollback,
    importFailures: count(source.importFailures),
  }
}

/**
 * 选出这次启动哪个 build（实施规格 §6）。
 *
 * 先处理 pending：在 bad 里 → 丢掉；tries ≥ 2 → 记 bad（health）并回滚；probe 不过 → 记 bad（invalid）；
 * 否则启动它，tries 加 1，这次是试运行。
 * 不启动 pending 时依次找：active 能用 → active；previous 能用 → previous（记回滚 missing，active 换成它）；
 * 再在版本目录里挑能用的最大 build 记为 active（全新安装或 state.json 丢了）。都没有 → launch 为 null。
 *
 * 扫目录时先挑不在 bad 里的，实在没有才用 bad 里的：起得来总比让作者重装好。
 * 回滚记录的 to 写这次真正启动的 build（pending 失败而 active 也不在时，to 是 previous 或扫到的那个）。
 *
 * @param {unknown} state readState 的结果，null 表示没有
 * @param {{ probe: (build: number) => { ok: boolean, manifest?: object, root?: string, reason?: string },
 *           scanBuilds: () => number[], now: () => string, installRoot: string }} deps
 * @returns {{ launch: { build: number, trial: boolean, manifest: object, root?: string } | null,
 *             state: object, notice?: { kind: 'rollback', rollback: object } | { kind: 'fresh', build: number } | { kind: 'no-build' },
 *             events: object[] }}
 */
export function decideLaunch(state, { probe, scanBuilds, now, installRoot }) {
  let next = normalizeState(state, installRoot)
  const at = now()
  const events = []
  const results = new Map()
  const check = build => {
    if (!results.has(build)) results.set(build, safeProbe(probe, build))
    return results.get(build)
  }
  const launchOf = (build, trial, result) => {
    const launch = { build, trial, manifest: result.manifest }
    if (typeof result.root === 'string') launch.root = result.root
    return launch
  }
  let cause = null

  if (next.pending !== null) {
    const pending = next.pending
    if (isBad(next, pending.build)) {
      events.push({ event: 'pending-dropped', build: pending.build, reason: 'bad' })
      next = { ...next, pending: null }
    } else if (pending.tries >= MAX_TRIES) {
      events.push({ event: 'pending-failed', build: pending.build, reason: 'health', tries: pending.tries })
      next = { ...withBad(next, pending.build, 'health', at), pending: null }
      cause = { from: pending.build, reason: 'health' }
    } else {
      const result = check(pending.build)
      if (!result.ok) {
        events.push({ event: 'pending-invalid', build: pending.build, reason: result.reason ?? 'invalid' })
        next = { ...withBad(next, pending.build, 'invalid', at), pending: null }
      } else {
        next = { ...next, pending: { ...pending, tries: pending.tries + 1 } }
        events.push({ event: 'launch', build: pending.build, trial: true, tries: pending.tries + 1 })
        return { launch: launchOf(pending.build, true, result), state: next, events }
      }
    }
  }

  const finish = (build, result, extra) => {
    next = { ...next, ...extra }
    let notice
    if (cause !== null) {
      next.rollback = { from: cause.from, to: build, reason: cause.reason, at, seen: false }
      notice = { kind: 'rollback', rollback: { ...next.rollback } }
      events.push({ event: 'rollback', ...cause, to: build })
    }
    events.push({ event: 'launch', build, trial: false })
    const decision = { launch: launchOf(build, false, result), state: next, events }
    if (notice !== undefined) decision.notice = notice
    return decision
  }

  if (next.active !== null) {
    const result = check(next.active)
    if (result.ok) return finish(next.active, result, {})
    events.push({ event: 'active-invalid', build: next.active, reason: result.reason ?? 'invalid' })
  }

  if (next.previous !== null) {
    const result = check(next.previous)
    if (result.ok) {
      // 没有更早的原因时，这次回滚的原因就是 active 不在了；active 本来就没有时不算回滚。
      if (cause === null && next.active !== null) cause = { from: next.active, reason: 'missing' }
      return finish(next.previous, result, { active: next.previous, previous: null, importFailures: 0 })
    }
    events.push({ event: 'previous-invalid', build: next.previous, reason: result.reason ?? 'invalid' })
  }

  let builds = []
  try {
    builds = [...new Set((scanBuilds() ?? []).filter(isBuild))].sort((a, b) => b - a)
  } catch {
    builds = []
  }
  const ordered = [...builds.filter(build => !isBad(next, build)), ...builds.filter(build => isBad(next, build))]
  for (const build of ordered) {
    const result = check(build)
    if (!result.ok) continue
    const changed = build !== next.active
    events.push({ event: 'scan', build })
    const decision = finish(build, result, { active: build, previous: null, importFailures: changed ? 0 : next.importFailures })
    if (decision.notice === undefined) decision.notice = { kind: 'fresh', build }
    return decision
  }

  events.push({ event: 'no-build' })
  return { launch: null, state: next, notice: { kind: 'no-build' }, events }
}

/**
 * 启动时怎么对待读到的 state.json（实施规格 §6 启动顺序第 2、3 步）。
 * - ok：照它选版本；选完和读到的一样就不用写回；
 * - missing / corrupt：按全新安装处理（扫目录），选完写回；
 * - error：文件在、却读不了（被占用、没权限，重试后还是不行）。照样扫目录选一个起得来的版本，但这一整次启动都
 *   不写 state.json：拿一份猜出来的状态盖掉真文件，会丢掉 active / previous / pending / bad / 回滚记录，
 *   下次能读的时候就回不去了。writable 为 false 时，记账方法一律拒绝或不落盘。
 * @param {{ state: object | null, status: 'ok' | 'missing' | 'corrupt' | 'error' } | null} read readStateFile 的结果
 * @param {Parameters<typeof decideLaunch>[1]} deps 同 decideLaunch
 * @returns {{ decision: ReturnType<typeof decideLaunch>, writable: boolean, persist: boolean }}
 *   persist：这次选完要不要把 decision.state 写回
 */
export function planStartup(read, deps) {
  const status = isObject(read) ? read.status : 'missing'
  const writable = status !== 'error'
  const decision = decideLaunch(status === 'ok' ? read.state : null, deps)
  const unchanged = status === 'ok' && JSON.stringify(read.state) === JSON.stringify(decision.state)
  return { decision, writable, persist: writable && !unchanged }
}

/**
 * 这次启动的记账标记（只在内存里，不写盘）：refunded 表示这次的试运行计数已经退回，healthy 表示已确认健康，
 * engineAttempted 表示这次启动已经开始起过引擎（之后再回到登录页不再退计数）。
 * @param {{ build: number, trial: boolean }} launch
 * @returns {{ build: number, trial: boolean, refunded: boolean, healthy: boolean, engineAttempted: boolean }}
 */
export function createLaunchFlags(launch) {
  return { build: launch.build, trial: launch.trial === true, refunded: false, healthy: false, engineAttempted: false }
}

const isOwnTrial = (state, flags) => isObject(flags) && flags.trial === true && state.pending !== null && state.pending.build === flags.build

// pending 是不是已经启动过了。不能只看 tries：停在登录页时 loginReady 会把这次的计数退回 0，
// 但这个 build 正在跑；这时被换掉、撤掉，作者登录后 markHealthy 就转不了正（撤掉的话下次还会悄悄回到旧版）。
// 所以这次启动正在试运行的 pending 一律算启动过，flags 由调用方（main.mjs）传进来。
const pendingLaunched = (state, flags) => state.pending !== null && (state.pending.tries > 0 || isOwnTrial(state, flags))

/**
 * 停在登录页（没登录，引擎不会起来）：试运行把这次扣的计数退回。重复调用只退一次。
 * 这次启动已经起过引擎（engineAttempted）就不退：引擎起不来时壳会退回登录页，那一页的 surface-ready
 * 也会走到这里；要是照样退回，起不来的新版本每次都只算「没登录」，永远到不了两次失败、回不到上一版。
 * @param {object} state
 * @param {{ build: number, trial: boolean, refunded: boolean, healthy: boolean, engineAttempted?: boolean }} flags
 * @returns {{ state: object, flags: object, changed: boolean }}
 */
export function applyLoginReady(state, flags) {
  if (!isOwnTrial(state, flags) || flags.refunded || flags.healthy || flags.engineAttempted === true || state.pending.tries <= 0) {
    return { state, flags, changed: false }
  }
  const next = cloneState(state)
  next.pending.tries -= 1
  return { state: next, flags: { ...flags, refunded: true }, changed: true }
}

/**
 * 登录后引擎开始启动：之前退回的计数再扣上。不管退没退过，都记下「这次起过引擎」（flags.engineAttempted），
 * 之后的 loginReady 不再退计数。调用方必须采用返回的 flags，哪怕 changed 为 false。
 * @param {object} state
 * @param {{ build: number, trial: boolean, refunded: boolean, healthy: boolean, engineAttempted?: boolean }} flags
 * @returns {{ state: object, flags: object, changed: boolean }}
 */
export function applyEngineStarting(state, flags) {
  const attempted = flags.engineAttempted === true ? flags : { ...flags, engineAttempted: true }
  if (!isOwnTrial(state, flags) || !flags.refunded || flags.healthy) return { state, flags: attempted, changed: false }
  const next = cloneState(state)
  next.pending.tries += 1
  return { state: next, flags: { ...attempted, refunded: false }, changed: true }
}

/**
 * 工作台画出来了（引擎就绪、页面就绪、登录态已读出）：试运行转正（previous = 原 active，active = 这一版，
 * pending 清空），导入失败计数清零。
 * @param {object} state
 * @param {{ build: number, trial: boolean, refunded: boolean, healthy: boolean }} flags
 * @returns {{ state: object, flags: object, changed: boolean }}
 */
export function applyHealthy(state, flags) {
  if (flags.healthy) return { state, flags, changed: false }
  const nextFlags = { ...flags, healthy: true, refunded: false }
  const next = cloneState(state)
  let changed = false
  if (isOwnTrial(state, flags)) {
    next.previous = state.active !== flags.build ? state.active : state.previous
    next.active = flags.build
    next.pending = null
    changed = true
  }
  if (next.importFailures !== 0) {
    next.importFailures = 0
    changed = true
  }
  return { state: changed ? next : state, flags: nextFlags, changed }
}

/**
 * 载荷的 main.js 导入失败（实施规格 §6「导入失败」）。
 * - 试运行：立刻记 bad（import），回到 active，action 为 relaunch；
 * - 不是试运行：importFailures 加 1。到 2 次并且 previous 能用 → 记 bad（import）、回到 previous、relaunch；
 *   还没到 2 次 → relaunch 再试一次（下一次失败就会到 2，不会无限重启）；
 *   到了 2 次但 previous 不能用 → action 为 exit：弹框后退出，不再自动重启。
 * @param {object} state
 * @param {{ build: number, trial: boolean }} flags
 * @param {{ probe: (build: number) => { ok: boolean }, now?: () => string } | ((build: number) => { ok: boolean })} deps
 * @returns {{ state: object, flags: object, changed: true, action: 'relaunch' | 'exit', rollback?: object }}
 */
export function applyImportFailure(state, flags, deps) {
  const { probe, now } = depsOf(deps)
  const at = now()
  let next = cloneState(state)
  if (isOwnTrial(state, flags)) {
    next = { ...withBad(next, flags.build, 'import', at), pending: null }
    next.rollback = { from: flags.build, to: next.active, reason: 'import', at, seen: false }
    return { state: next, flags, changed: true, action: 'relaunch', rollback: { ...next.rollback } }
  }
  next.importFailures = count(next.importFailures) + 1
  if (next.importFailures < MAX_IMPORT_FAILURES) return { state: next, flags, changed: true, action: 'relaunch' }
  const previous = next.previous
  if (previous !== null && previous !== flags.build && safeProbe(probe, previous).ok) {
    next = { ...withBad(next, flags.build, 'import', at), active: previous, previous: null, importFailures: 0 }
    next.rollback = { from: flags.build, to: previous, reason: 'import', at, seen: false }
    return { state: next, flags, changed: true, action: 'relaunch', rollback: { ...next.rollback } }
  }
  return { state: next, flags, changed: true, action: 'exit' }
}

/**
 * 载荷的 main.js 导入成功：导入失败只算连续的，所以计数清零。只停在登录页的启动不会调 markHealthy，
 * 不在这里清零的话，隔几天偶尔失败一次也会凑满 2 次，把作者送回上一版。
 * @param {object} state
 * @returns {{ state: object, changed: boolean }}
 */
export function applyImportSuccess(state) {
  if (count(state.importFailures) === 0) return { state, changed: false }
  return { state: { ...cloneState(state), importFailures: 0 }, changed: true }
}

/**
 * 更新器组装、自检都通过后登记待切换的版本：pending = { build, tries: 0, stagedAt }。
 * 拒绝：不是正整数（invalid-build）、不比 active 新（not-newer）、在 bad 里（bad）、
 * 已有 pending 启动过（trial-running：再登记会把它的计数清零，正在试运行的那一版也转不了正）、probe 不过（probe 的原因）。
 * 「启动过」既看 tries，也看 flags：这次启动正在试运行的 pending 被 loginReady 退回到 0 也算。
 * @param {object} state
 * @param {number} build
 * @param {{ probe: (build: number) => { ok: boolean, reason?: string }, now?: () => string } | ((build: number) => { ok: boolean, reason?: string })} deps
 *   也可以直接传 probe 函数
 * @param {{ build: number, trial: boolean } | null} [flags] 这次启动的记账标记（createLaunchFlags）
 * @returns {{ ok: boolean, reason?: string, state: object, changed: boolean }}
 */
export function applyStage(state, build, deps, flags = null) {
  const { probe, now } = depsOf(deps)
  const refuse = reason => ({ ok: false, reason, state, changed: false })
  if (!isBuild(build)) return refuse('invalid-build')
  if (state.active !== null && build <= state.active) return refuse('not-newer')
  if (isBad(state, build)) return refuse('bad')
  if (pendingLaunched(state, flags)) return refuse('trial-running')
  const result = safeProbe(probe, build)
  if (!result.ok) return refuse(typeof result.reason === 'string' ? result.reason : 'invalid')
  const next = cloneState(state)
  next.pending = { build, tries: 0, stagedAt: now() }
  return { ok: true, state: next, changed: true }
}

/**
 * 撤掉还没启动过的 pending。已经启动过的不能撤（launched）：tries 大于 0，或者它就是这次启动正在试运行的那一版
 * （loginReady 退回计数后 tries 是 0，但它正在跑）。没有 pending 时什么也不做。
 * @param {object} state
 * @param {{ build: number, trial: boolean } | null} [flags] 这次启动的记账标记（createLaunchFlags）
 * @returns {{ ok: boolean, reason?: string, state: object, changed: boolean }}
 */
export function applyUnstage(state, flags = null) {
  if (state.pending === null) return { ok: true, state, changed: false }
  if (pendingLaunched(state, flags)) return { ok: false, reason: 'launched', state, changed: false }
  return { ok: true, state: { ...cloneState(state), pending: null }, changed: true }
}

/**
 * 把一个 build 记进 bad（只留最近 10 条）。它正好是 pending 时一并清掉；已经启动过的 pending
 * （含这次正在试运行、计数被退回的）被清掉，下次会回到 active，所以同时写回滚记录。
 * @param {object} state
 * @param {number} build
 * @param {string} reason
 * @param {{ now?: () => string }} [deps]
 * @param {{ build: number, trial: boolean } | null} [flags] 这次启动的记账标记（createLaunchFlags）
 * @returns {{ ok: boolean, reason?: string, state: object, changed: boolean }}
 */
export function applyMarkBad(state, build, reason, deps, flags = null) {
  const { now } = depsOf(deps)
  if (!isBuild(build)) return { ok: false, reason: 'invalid-build', state, changed: false }
  const at = now()
  const launched = state.pending !== null && state.pending.build === build && pendingLaunched(state, flags)
  let next = withBad(cloneState(state), build, reason, at)
  if (next.pending !== null && next.pending.build === build) {
    if (launched) next.rollback = { from: build, to: next.active, reason: reasonText(reason), at, seen: false }
    next = { ...next, pending: null }
  }
  return { ok: true, state: next, changed: true }
}

/**
 * 回滚提示已经给作者看过了。
 * @param {object} state
 * @returns {{ state: object, changed: boolean }}
 */
export function applyRollbackSeen(state) {
  if (state.rollback === null || state.rollback.seen) return { state, changed: false }
  const next = cloneState(state)
  next.rollback.seen = true
  return { state: next, changed: true }
}

/**
 * 回滚目标：试运行还没转正时是 active，否则是 previous。
 * @param {object} state
 * @param {{ build: number, trial: boolean }} flags
 * @returns {number | null}
 */
export function rollbackTarget(state, flags) {
  return isOwnTrial(state, flags) ? state.active : state.previous
}

/**
 * 安装根的短 id：安装根转小写后 sha256 的前 12 位十六进制（实施规格 §3）。
 * @param {string} installRoot
 * @returns {string}
 */
export function installId(installRoot) {
  return createHash('sha256').update(installRoot.toLowerCase(), 'utf8').digest('hex').slice(0, 12)
}

/**
 * 定出安装根、更新目录和找版本目录的顺序（实施规格 §3）。
 * 安装根可写 → updateHome 就是安装根；否则放到 `%LOCALAPPDATA%\WriterX Hermes\payload\<id>`。
 * 连 LOCALAPPDATA 都拿不到时退回安装根（之后写不进去，更新器会在预检里拦下）。
 * appDirs：先 `<安装根>\app`，再 `<updateHome>\app`，相同的只留一个。安装根在前：装在 Program Files 时，
 * 安装器放进受保护目录的那一版，不会被 %LOCALAPPDATA% 里同号的一份顶替（那里同一用户的任何程序都能写，
 * 而启动时只核对清单签名和 app.asar，node.exe、dsh\、python\ 要到后台全量检查才核对）。更新出来的版本只在
 * %LOCALAPPDATA% 里有，照样能找到。
 *
 * 两处补充（实施规格 §3 没写到的情况）：
 * - 安装根先取真实路径（realpath）：同一份安装从 8.3 短路径、目录联接或 subst 盘符启动时，`process.execPath`
 *   的写法不同，算出来的 id 也不同，会换到另一个 updateHome、找不到 state.json，悄悄退回安装器里的旧版本。
 * - updateHome 选定后不再随权限摇摆：装在 Program Files 的，偶尔「以管理员身份运行」一次安装根就变得可写。
 *   所以 LOCALAPPDATA 那边已经有 `update\state.json` 时，即使安装根可写也继续用它，不然这次启动读的是另一份
 *   （没有的）state.json，提权的更新器还会在 Program Files 里另起一条版本线。
 * @param {{
 *   execPath: string, localAppData?: string | null, isWritable: (dir: string) => boolean,
 *   hasState?: (updateHome: string) => boolean, realpath?: (dir: string) => string,
 * }} options hasState：`<updateHome>\update\state.json` 在不在；realpath：Electron 里传 original-fs 的 realpathSync.native。
 *   两个都可以不传（不传就是不检查 / 不规整）；出错按「没有」「不规整」处理。
 * @returns {{ installRoot: string, updateHome: string, appDirs: string[], installWritable: boolean, id: string }}
 */
export function resolveHomes({ execPath, localAppData, isWritable, hasState, realpath }) {
  let installRoot = path.dirname(execPath)
  if (typeof realpath === 'function') {
    try {
      const real = realpath(installRoot)
      if (typeof real === 'string' && real !== '') installRoot = real
    } catch {
      // 规整不了就用原样：同一种写法启动时结果照旧稳定
    }
  }
  const id = installId(installRoot)
  let installWritable = false
  try {
    installWritable = isWritable(installRoot) === true
  } catch {
    installWritable = false
  }
  const localHome = typeof localAppData === 'string' && localAppData !== ''
    ? path.join(localAppData, 'WriterX Hermes', 'payload', id)
    : null
  let localInUse = false
  if (localHome !== null && installWritable && typeof hasState === 'function') {
    try {
      localInUse = hasState(localHome) === true
    } catch {
      localInUse = false
    }
  }
  const updateHome = localHome === null || (installWritable && !localInUse) ? installRoot : localHome
  const appDirs = [path.join(installRoot, 'app')]
  const updateApp = path.join(updateHome, 'app')
  if (updateApp.toLowerCase() !== appDirs[0].toLowerCase()) appDirs.push(updateApp)
  return { installRoot, updateHome, appDirs, installWritable, id }
}
