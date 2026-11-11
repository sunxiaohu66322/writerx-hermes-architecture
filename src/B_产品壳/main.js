// WriterX Hermes desktop shell.
//
// Owns the dsh web server as a child process running on a REAL Node runtime —
// the bundled portable Node binary in the packaged app, the system Node in dev —
// and opens one product window on it. The server deliberately does NOT run
// under Electron's Node (utilityProcess): harness native modules such as
// node-pty are compiled against a Node ABI, Electron ships a different ABI,
// and the load fails at boot. All product data lives under
// %APPDATA%/WriterX Hermes/dsh-home (DSH_HOME), isolated from any other dsh
// deployment on the machine. The WriterX Hub lifecycle (login, session
// tokens, catalog) runs here in the main process; the renderer never talks
// to Hub directly.
//
// The engine boots the `hermes` PROFILE (see profile.mjs): the harness's own
// web GUI bundles plus the product bundle @writerx/dsh-hermes-app, whose rows
// insert the product plugins. Product behavior lives in those plugins, not
// here — this file is a launcher.

import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, Notification, powerSaveBlocker, shell, WebContentsView } from 'electron'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { createHubService } from './hub/hub-service.mjs'
import { createImageLibrary } from './hub/image-library.mjs'
import { startEntitlementBridge } from './hub/entitlement-bridge.mjs'
import { bridgeLegacySettingsSections, openingModeSync, profilePatchPath, profileRowConfigSync, recoverStrandedSettingsImport, seedNewInstallTheme } from './hub/profile-patch.mjs'
import { ensureProfile, isNewProfile, PROFILE_NAME } from './profile.mjs'
import { REPO_ROOT, resolveProductPackages } from './product-packages.mjs'
import { writerxPublicDiagnostic } from './public-copy.mjs'
import { createDecomposeNotifications } from './decompose-notifications.mjs'
import { createKeepAwake, isPageSource } from './keep-awake.mjs'
import { createStartupNotice } from './hub/startup-notice.mjs'
import { createAuthenticatedLifecycle, isHermesAdmitted } from './authenticated-lifecycle.mjs'
import { formatBootInfo, formatBuildInfo, readBuildInfo } from './build-info.mjs'
import { createEngineOutputReader } from './engine-output.mjs'
import { runtimeEnvironmentOverrides } from './runtime-env.mjs'
import { engineArguments, shippedPayloadPatch } from './engine-patches.mjs'
import { defaultImageLibraryLocation, defaultLibraryLocation, systemFolder } from './library-location.mjs'
import {
  installPlazaSkillOnHost as installPlazaSkillOnHostRequest,
  listPlazaInstalledOnHost,
  plazaInstalledManifest,
  plazaInstalledManifestOnHost as readPlazaInstalledManifest,
} from './plaza-install.mjs'
import { createUpdateService } from './update/service.mjs'
import { createRequestFetch, isAllowedDownloadUrl } from './update/download.mjs'
import { releaseHeldLocks } from './update/lock.mjs'
import { engineUpdateTasks } from './update/engine-tasks.mjs'
import { createRedactor, defaultRedactIdentity } from './update/diagnostics.mjs'
import { buildFeedbackDiag, feedbackClientJson, normalizeFeedbackInput, osName, platformName } from './feedback.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The boot (apps/desktop/boot/main.mjs, the installed app's resources/app.asar)
// picks a build, imports this file from app\<build>\app.asar, and leaves this
// launch's facts and health accounting here. A development run
// (`electron apps/desktop`) and a packaged app without the boot have none.
const BOOT = globalThis.__hermesBoot ?? null

// Where this build's payload (dsh, node, python, build-info.json) lives:
// - boot launch: the build directory the boot chose, app\<build>
// - packaged without the boot (macOS, the old single-asar layout): resources/
// - development: none; the repository supplies everything
// Chosen by whether there is a payload, not by app.isPackaged: a boot started
// through a plain electron.exe reports isPackaged false yet runs a real payload.
const PAYLOAD_ROOT = typeof BOOT?.root === 'string' && BOOT.root !== ''
  ? BOOT.root
  : app.isPackaged ? process.resourcesPath : null

// The running release: the boot's signed manifest, else this package's own
// version. Only a boot launch knows its build number.
const APP_VERSION = typeof BOOT?.version === 'string' && BOOT.version !== '' ? BOOT.version : app.getVersion()
const APP_BUILD = Number.isSafeInteger(BOOT?.build) && BOOT.build > 0 ? BOOT.build : null

// ── product identity ───────────────────────────────────────────────────────
// Rename here, then in electron-builder.yml. The app data directory name is
// derived from app.name, which is set from PRODUCT.name below.
const PRODUCT = {
  name: 'WriterX Hermes',
  windowTitle: 'WriterX Hermes — AI 写作工作台',
  defaultPort: 3876,   // first port to try
  maxPortRetries: 20,  // consecutive ports after that
  startupTimeoutMs: 60_000,
  // Engine starts that end without readiness (a crash, a hang) before the start fails: another port does
  // not help with those. A port someone else took (EADDRINUSE) does not count.
  maxEngineStarts: 2,
  maxRelaunches: 2,
  // Hub origin; WRITERX_HUB_BASE overrides it (the local dev stack is
  // http://127.0.0.1:8787).
  hubBaseUrl: process.env.WRITERX_HUB_BASE ?? 'https://hub.writerx.top',
  // Route the model through WriterX 云 (Hub's LLM gateway). OFF until the Hub
  // gateway speaks the agent protocol (tools / tool_calls); until then people
  // configure their own model in 设置 → 模型 (harness ui-settings-models).
  // The Hub agent channel serves the 内置免费 / 按次专供 models to the engine
  // (`hub` route); WRITERX_HUB_MODEL_ROUTE=0 keeps the route off (BYOK only).
  hubModelRoute: process.env.WRITERX_HUB_MODEL_ROUTE !== '0',
}

// The Node runtime that runs the server:
// - payload: <payload>/node — node.exe on Windows, bin/node on macOS
//            (downloaded by `npm run bundle:server`)
// - dev:     npm's own node under `npm start`, else `node` on PATH
const NODE_EXE = PAYLOAD_ROOT !== null
  ? path.join(PAYLOAD_ROOT, 'node', ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node']))
  : (process.env.DSH_NODE_EXE ?? process.env.npm_node_execpath ?? 'node')

// The dsh server entry:
// - payload: the CLI inside the engine closure, <payload>/dsh/node_modules/
//            @deepseek-ai/dsh/lib/bin.js (produced by `npm run bundle:server`;
//            the closure's own node_modules is where every plugin resolves)
// - dev:     the harness submodule's built CLI (harness/apps/cli/lib/bin.js)
const CLOSURE_MODULES = PAYLOAD_ROOT !== null ? path.join(PAYLOAD_ROOT, 'dsh', 'node_modules') : undefined
const SERVER_ENTRY = CLOSURE_MODULES !== undefined
  ? path.join(CLOSURE_MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  : (process.env.DSH_SERVER_ENTRY ?? path.join(REPO_ROOT, 'harness', 'apps', 'cli', 'lib', 'bin.js'))

// The product's own harness packages, linked into the profile:
// - payload: inside the engine closure, <payload>/dsh/node_modules/@writerx/<pkg>
//            (copied there by `npm run bundle:server`, so their bare imports of
//            @deepseek-ai/* resolve by the ordinary directory walk)
// - dev:     the repository's packages/ tree (built in place)
const PRODUCT_PACKAGES = resolveProductPackages(CLOSURE_MODULES)

const ICON_FILE = path.join(__dirname, '../build/icon.ico')

/** Height of the frameless title bar (the page's bar and the OS controls overlay agree on it). */
const TITLEBAR_HEIGHT = 44

app.setName(PRODUCT.name)

let server = null
let bootChild = null
let bootPort = 0
let serverPort = 0
let serverReady = false
let relaunches = 0
let quitting = false
let mainWindow = null
// The opening (千字归一) covers the window while WriterX starts; the surface it
// opens onto (sign-in or the workbench) loads underneath in mainWindow.
let openingView = null
let openingRevealTimer = null
let openingFinishTimer = null
// Window-control colors a page asked for while the opening covered it.
let pendingTitleBarOverlay = null
// Those waiting for the window to be clear of the opening (the launch announcement).
let surfaceClearWaiters = []
// This launch's announcement (WriterX's startup notice), handed to the workbench once the opening is gone.
const startupNotice = createStartupNotice({ fetch: () => hub.startupNotice(), whenSurfaceClear })
// 生成期间电脑不睡眠（keep-awake.mjs）：页面报「会话在生成」「风格蒸馏」「联网取正文」「热榜风向」，后台拆书走拆书那条 IPC。
const keepAwake = createKeepAwake({ powerSaveBlocker, log })
let taskNotifications = null
let serverLog = null
let hub = null
// The updater (src/update/service.mjs); a development run gets one that says 开发版不检查更新.
let updates = null
// The 必须更新 dialog goes up at most once per launch.
let minimumAsked = false
let entitlementBridge = null
let entitlementPolicy = null
let plazaReconcileTimer = null
let plazaReconcileFlight = null
let appLifecycle = null
let quitCleanupFlight = null
let quitCleanupComplete = false
// Unloads the shell starts itself (sign-out, a surface swap) after the documents had their chance to
// save: the page's unsaved-edit veto must not cancel them — Electron would do it silently and leave the
// window on a workbench whose engine is gone. Quitting is covered by `quitting`.
let unloadOverrides = 0
// The author's close went through settleWorkbench (and the question, when edits were left).
let closeApproved = false
let closeSettling = null
// Account operations the page started (sign-in, sign-up, 同步账号): each reconciles the surface itself.
let accountFlights = 0
let returningToWorkbench = null
let pythonEnvironment = null
const intentionalStops = new WeakSet()
const terminationFlights = new WeakMap()
const engineLaunchUrls = new WeakMap()
// Engines that said their port was taken (listen EADDRINUSE), and when each one's output has ended.
const portTaken = new WeakSet()
const outputEnded = new WeakMap()
let startupStatus = {
  stage: '正在准备 WriterX Hermes',
  detail: '正在检查本地写作环境。',
  startedAt: Date.now(),
  // Which band of the opening's ring this stage fills (opening-timeline.js BANDS).
  phase: 'prepare',
}

const dshHome = () => path.join(app.getPath('userData'), 'dsh-home')

// Folders Windows could not resolve this run: each is logged once (without the path).
const unresolvedFolders = new Set()
/** 文档 / 图片 for a default location; the same folder under home when Windows cannot resolve it (launch goes on). */
function userFolder(name) {
  return systemFolder({
    name,
    getPath: key => app.getPath(key),
    home: homedir(),
    platform: process.platform,
    onFallback: error => {
      if (unresolvedFolders.has(name)) return
      unresolvedFolders.add(name)
      log(`${name} folder unavailable (${error instanceof Error ? error.message : String(error)}); using the one in the home folder`)
    },
  })
}

/** A portable Windows build starts beside its executable; protected installations use Documents. */
function defaultLibraryDirectory() {
  const executable = app.getPath('exe')
  return defaultLibraryLocation({ packaged: app.isPackaged, platform: process.platform, executable, documents: userFolder('documents'),
    installed: existsSync(path.join(path.dirname(executable), `Uninstall ${PRODUCT.name}.exe`)),
    protectedRoots: [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.SystemRoot, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')],
  })
}

/** Append one line to %APPDATA%/WriterX Hermes/server.log and the console. */
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  serverLog?.write(stamped + '\n')
}

/**
 * Developer chrome: the product bundle switches off the harness's 「轨迹」 view
 * and the 「Session log」 download for authors; WRITERX_DEV_UI=1 turns them
 * back on through a `--patch` overlay applied after the bundle layers (the
 * profile's own cordis.patch.yml stays the person's file, untouched).
 * @returns the overlay file, or none.
 */
function devUiPatches() {
  if (process.env.WRITERX_DEV_UI !== '1') return []
  const overlay = path.join(dshHome(), 'dev-ui.patch.yml')
  writeFileSync(overlay, [
    '# WRITERX_DEV_UI=1: the engineer\'s chrome back on (written by the shell at each start).',
    '- id: ui-trajectory',
    '  disabled: false',
    '- id: session-log-download',
    '  disabled: false',
    '',
  ].join('\n'))
  return [overlay]
}

/**
 * A shipped payload never rebuilds client bundles, so the engine's bundle poll is stretched out of the way
 * (src/engine-patches.mjs: the updater's hard links would otherwise hot-swap every plugin in the open workbench).
 * A development run keeps live bundle reloads.
 * @returns the overlay file, or none.
 */
function shippedPayloadPatches() {
  if (PAYLOAD_ROOT === null) return []
  const overlay = path.join(dshHome(), 'shipped-payload.patch.yml')
  writeFileSync(overlay, shippedPayloadPatch())
  return [overlay]
}

/** Spawn the dsh web server on `port`; attaches logging immediately. */
function startServer(port) {
  log(`starting dsh server (profile ${PROFILE_NAME}) on port ${port}${process.env.WRITERX_DEV_UI === '1' ? ' (WRITERX_DEV_UI: developer chrome on)' : ''}`)
  // The overlays go right after --profile (engineArguments): behind --port they reached the web app, not the launcher.
  const child = spawn(NODE_EXE, engineArguments({
    entry: SERVER_ENTRY, profile: PROFILE_NAME, port, patches: [...shippedPayloadPatches(), ...devUiPatches()],
  }), {
    env: {
      ...process.env,
      ...runtimeEnvironmentOverrides({ nodeExe: NODE_EXE, pythonBin: pythonEnvironment?.bin }),
      WRITERX_PYTHON_ROOT: pythonEnvironment?.root ?? '',
      DSH_HOME: dshHome(),
      WRITERX_LIBRARY_DEFAULT: defaultLibraryDirectory(),
      DSH_TELEMETRY_DISABLED: '1',
      WRITERX_HERMES_VERSION: APP_VERSION,
      // Left out (an inherited value too) when this launch has no build number.
      WRITERX_HERMES_BUILD: APP_BUILD === null ? undefined : String(APP_BUILD),
      WRITERX_ENTITLEMENTS_URL: entitlementBridge?.url ?? '',
      WRITERX_ENTITLEMENTS_TOKEN: entitlementBridge?.token ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  // Attach before readiness so a boot-time crash is never silent.
  const noteTaken = line => { if (/\bEADDRINUSE\b/u.test(line)) portTaken.add(child) }
  const stdout = createEngineOutputReader({
    port,
    onReadyUrl: url => engineLaunchUrls.set(child, url),
    onLine: line => { noteTaken(line); log(`[server] ${line}`) },
  })
  const stderr = createEngineOutputReader({ port, onLine: line => { noteTaken(line); log(`[server:err] ${line}`) } })
  outputEnded.set(child, new Promise(resolve => child.once('close', resolve)))
  child.stdout.on('data', chunk => stdout.write(chunk))
  child.stdout.on('end', () => stdout.end())
  child.stderr.on('data', chunk => stderr.write(chunk))
  child.stderr.on('end', () => stderr.end())
  return child
}

/**
 * Probe until the web server answers on `port`, the child exits, or the
 * timeout elapses.
 */
async function waitReady(port, timeoutMs, child, signal) {
  const deadline = Date.now() + timeoutMs
  const url = `http://127.0.0.1:${port}/`
  while (Date.now() < deadline) {
    if (signal.aborted) return false
    if (childExited(child)) {
      log(`server exited during boot (code ${child.exitCode}) — not ready`)
      return false
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now())))]),
      })
      // The official announcement is emitted only after Loader settlement.
      // A cold 404 or an unrelated listener is never readiness. New Connection
      // returns 401 until the window exchanges the announced token for a cookie.
      if (engineLaunchUrls.has(child) && (res.status === 200 || res.status === 401)) return true
    } catch {
      if (signal.aborted) return false
      // Connection refused: server still booting. Keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return false
}

/**
 * Whether nothing listens on `port` yet: bind and release it. Probing with a
 * GET is not enough — another WriterX Hermes (a second window, a dev copy
 * beside the installed one) answers on its port and would pass as ours while
 * our engine dies with EADDRINUSE and gets relaunched into the same wall.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function portFree(port) {
  return new Promise(resolve => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

function engineStartCancelled() {
  return Object.assign(new Error('engine start cancelled'), { code: 'ENGINE_START_CANCELLED' })
}

/** Whether a stopped engine said its port was taken; its last lines may still be on the way. */
async function enginePortTaken(child) {
  let timer
  await Promise.race([outputEnded.get(child), new Promise(resolve => { timer = setTimeout(resolve, 1000) })])
  clearTimeout(timer)
  return portTaken.has(child)
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return Promise.resolve(true)
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(true) }
    const timer = setTimeout(() => { child.off('exit', done); resolve(childExited(child)) }, timeoutMs)
    child.once('exit', done)
  })
}

function taskkillTree(child) {
  if (process.platform !== 'win32' || child.pid === undefined) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    let timer
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
    timer = setTimeout(finish, 2000)
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      killer.once('error', finish)
      killer.once('exit', finish)
    } catch { finish() }
  })
}

function terminateServerChild(child) {
  if (child === null || childExited(child)) return Promise.resolve()
  const current = terminationFlights.get(child)
  if (current !== undefined) return current
  intentionalStops.add(child)
  const task = (async () => {
    if (process.platform === 'win32') await taskkillTree(child)
    else try { child.kill() } catch { /* already exiting */ }
    if (!(await waitForChildExit(child, 1500))) {
      try { child.kill('SIGKILL') } catch { /* already exiting */ }
      await taskkillTree(child)
    }
    if (!(await waitForChildExit(child, 3500))) {
      throw Object.assign(new Error('无法确认本地工作台进程已停止'), { code: 'ENGINE_STOP_FAILED' })
    }
  })()
  terminationFlights.set(child, task)
  task.finally(() => { if (terminationFlights.get(child) === task) terminationFlights.delete(child) }).catch(() => {})
  return task
}

async function stopServer() {
  serverReady = false
  if (plazaReconcileTimer !== null) clearInterval(plazaReconcileTimer)
  plazaReconcileTimer = null
  const children = [...new Set([bootChild, server].filter(Boolean))]
  await Promise.all(children.map(child => terminateServerChild(child)))
  if (children.includes(bootChild)) bootChild = null
  if (bootChild === null) bootPort = 0
  if (children.includes(server)) server = null
  if (server === null) serverPort = 0
  relaunches = 0
}

/** Pick a free port, spawn the server, and wait for it. */
async function bootServer(signal) {
  if (serverReady && server !== null && !childExited(server)) return
  if (signal.aborted) throw engineStartCancelled()
  // A trial launch that waited on the sign-in page was not charged; from here it counts again.
  reportToBoot('engineStarting')
  // 0.1.7 bridge: settings.yaml sections whose owning row was renamed by the
  // product must carry the new key before the engine's legacy import runs.
  try {
    for (const line of await bridgeLegacySettingsSections(dshHome(), { 'llm-pi-ai': 'writerx-model-adapters', 'writerx-creation': 'writerx-creation-workflow', 'writerx-library': 'ui-book-library' })) {
      log(`legacy settings bridged: ${line}`)
    }
    for (const rowId of await recoverStrandedSettingsImport(dshHome(), { 'llm-pi-ai': 'writerx-model-adapters', 'writerx-creation': 'writerx-creation-workflow', 'writerx-library': 'ui-book-library' })) {
      log(`stranded legacy settings recovered: ${rowId}`)
    }
  } catch (error) {
    log(`legacy settings bridge failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Prepare after the local startup surface is visible, not before the first window.
  // Cancellation on logout/exit also reaches the interpreter preparation process.
  if (pythonEnvironment === null && ((process.platform === 'win32' && process.arch === 'x64')
    || (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)))) {
    const pythonSource = PAYLOAD_ROOT !== null ? path.join(PAYLOAD_ROOT, 'python') : path.join(REPO_ROOT, 'apps/desktop/resources/python')
    if (existsSync(path.join(pythonSource, 'writerx-python.json'))) {
      setStartupStage('正在准备技能运行环境', '首次启动需准备内置 Python，无需安装系统软件。', { phase: 'python' })
      try {
        const presetPackage = PRODUCT_PACKAGES.find(pkg => pkg.name === '@writerx/dsh-hermes-presets')
        const { preparePython } = await import(pathToFileURL(path.join(presetPackage.dir, 'python/runtime.mjs')).href)
        pythonEnvironment = await preparePython({ source: pythonSource, dataRoot: path.join(app.getPath('userData'), 'python-runtime'), signal })
        log(`managed Python ${pythonEnvironment.version} ready`)
      } catch (error) {
        if (signal.aborted) throw engineStartCancelled()
        log(`managed Python unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  setStartupStage('正在准备写作引擎', '正在检查本地运行环境与写作组件。', { phase: 'engine' })
  let unready = 0
  for (let attempt = 0; attempt < PRODUCT.maxPortRetries; attempt++) {
    if (signal.aborted) throw engineStartCancelled()
    const port = PRODUCT.defaultPort + attempt
    if (!(await portFree(port))) {
      log(`port ${port} is taken — trying the next one`)
      continue
    }
    if (signal.aborted) throw engineStartCancelled()
    setStartupStage('正在启动本地写作引擎', '正在加载 WriterX 写作组件、技能与工作区服务。', { phase: 'starting' })
    const child = startServer(port)
    bootChild = child
    bootPort = port
    const ready = await waitReady(port, PRODUCT.startupTimeoutMs, child, signal)
    if (signal.aborted) {
      await terminateServerChild(child)
      if (bootChild === child) { bootChild = null; bootPort = 0 }
      throw engineStartCancelled()
    }
    if (ready) {
      bootChild = null
      bootPort = 0
      server = child
      serverPort = port
      serverReady = true
      log(`server ready on port ${port}`)
      setStartupStage('写作引擎已就绪', '正在打开你的 WriterX 工作台。', { phase: 'opening' })
      child.once('exit', code => onServerExit(child, code))
      if (childExited(child)) queueMicrotask(() => onServerExit(child, child.exitCode))
      startPlazaReconcileLoop()
      void reconcilePlazaInstallReceipts()
      return
    }
    log(`server did not become ready on port ${port}`)
    await terminateServerChild(child)
    if (bootChild === child) { bootChild = null; bootPort = 0 }
    // Someone took the port between the probe and the engine's listen: the next one. A crash or a hang
    // would only repeat on every port (20 × 60 s of opening): one more try, then the start fails.
    if (await enginePortTaken(child)) continue
    unready += 1
    if (unready >= PRODUCT.maxEngineStarts) {
      log(`engine did not become ready ${unready} times — giving up`)
      throw new Error('写作引擎连着两次没能启动。请重新打开 WriterX Hermes；还不行的话，重启电脑后再试。')
    }
  }
  throw new Error('no usable port found — giving up')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: PRODUCT.windowTitle,
    show: false,
    ...existsSync(ICON_FILE) ? { icon: ICON_FILE } : {},
    autoHideMenuBar: true,
    // First paint on the palette the pages are about to use (the in-app 外观
    // setting, which on "system" follows the OS), so neither a white nor a
    // black flash precedes the page.
    backgroundColor: shellDark() ? '#111113' : '#fafafa',
    // Frameless like WriterX: no OS title bar. The OS window controls
    // (minimize / maximize / close) are overlaid at the top-right; the page
    // draws its own bar underneath (the product title bar plugin, or the
    // login page's drag strip) and keeps the overlay's colors in step with
    // its palette through the preload bridge.
    titleBarStyle: 'hidden',
    titleBarOverlay: shellDark()
      ? { color: '#111113', symbolColor: '#c8ccd2', height: TITLEBAR_HEIGHT }
      : { color: '#fafafa', symbolColor: '#3d4249', height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The sandboxed preload cannot read files; it reads the running release back from its argv.
      additionalArguments: [
        `--writerx-hermes-version=${APP_VERSION}`,
        ...APP_BUILD === null ? [] : [`--writerx-hermes-build=${APP_BUILD}`],
      ],
    },
  })
  // 窗口关了，防休眠立即放，不等 60 秒（keep-awake.mjs）。
  mainWindow.on('closed', () => { mainWindow = null; openingView = null; releaseSurfaceWaiters(); keepAwake.stop() })
  // 页面换了（重载、换页），它报过的「在生成」都作废；新页面会重新报。
  // 页面内跳转（pushState）不算换页，不会触发 did-navigate。id 先记下：窗口关了就读不到了。
  const contentsId = mainWindow.webContents.id
  mainWindow.webContents.on('did-navigate', () => { keepAwake.clear(contentsId) })
  // The editor holds back an unload while a document has unsaved edits (its beforeunload). A browser
  // would ask; Electron cancels the close, the quit or the navigation without a word, so the shell
  // answers for it: its own unloads settle the documents first and go through, the author's close is
  // settled below, and anything else asks the author here.
  mainWindow.webContents.on('will-prevent-unload', event => {
    if (quitting || closeApproved || unloadOverrides > 0) { event.preventDefault(); return }
    const choice = dialog.showMessageBoxSync(mainWindow, unsavedEditsQuestion({ pending: 0, unprotected: 0 }, '仍然离开'))
    if (choice === 1) event.preventDefault()
  })
  mainWindow.on('close', event => {
    if (quitting || closeApproved || mainWindow === null || !onWorkbenchPage(mainWindow.webContents.getURL())) return
    event.preventDefault()
    if (closeSettling === null) closeSettling = closeAfterSettling().finally(() => { closeSettling = null })
  })
  // A page process that died leaves the window blank: load the surface again (bounded, see recoverRenderer).
  // 它报过的「在生成」也一起作废，重新加载的页面会再报。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    keepAwake.clear(contentsId)
    void recoverRenderer(details).catch(error => log(`window page recovery failed: ${error instanceof Error ? error.message : String(error)}`))
  })
  for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) mainWindow.on(event, fitOpening)
  // Outbound links (a vendor's key console, docs) open in the system browser;
  // nothing opens a second app window, and the app never navigates away from
  // its own surfaces (the engine's origin, the login page).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`http://127.0.0.1:${serverPort}/`) || url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  // Dev aid: WRITERX_DEBUG_EVAL='<js expression>' runs in the page 3s after
  // each load and logs the result (e.g. measuring the title bar, clicking a
  // row to screenshot a state). Development runs only: a packaged build ignores
  // it, so an inherited environment variable cannot run script in the author's
  // signed-in window.
  // Companion: WRITERX_DEBUG_SHOT='<dir>' — after the eval resolves, replays
  // the frames the eval stashed on `window.__shotFrames` ([{ name, js }]),
  // capturing a full-page PNG per frame into <dir> (native chrome included,
  // which DOM serialization cannot see).
  if (!app.isPackaged && typeof process.env.WRITERX_DEBUG_EVAL === 'string' && process.env.WRITERX_DEBUG_EVAL !== '') {
    const expression = process.env.WRITERX_DEBUG_EVAL
    const shotDir = process.env.WRITERX_DEBUG_SHOT
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            const v = await mainWindow?.webContents.executeJavaScript(expression, true)
            log(`debug eval: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
            if (typeof shotDir === 'string' && shotDir !== '' && mainWindow !== null) {
              await mkdir(shotDir, { recursive: true })
              // Trusted input only routes to a focused window.
              mainWindow.show()
              mainWindow.focus()
              log(`debug shots: window focused=${mainWindow.isFocused()}`)
              const frames = await mainWindow.webContents.executeJavaScript(
                'globalThis.__shotFrames ?? []', true,
              )
              for (const frame of Array.isArray(frames) ? frames : []) {
                const rv = await mainWindow.webContents.executeJavaScript(String(frame.js), true)
                log(`debug shot ${String(frame.name)}: ${typeof rv === 'string' ? rv : JSON.stringify(rv)}`)
                // Optional trusted input burst (renderer-dispatched events are
                // untrusted and never scroll): { wheel: { x, y, deltaY, count } }
                const wheel = frame.wheel
                if (wheel !== undefined && typeof wheel === 'object') {
                  // Chromium targets wheel gestures at the cursor's last known
                  // spot — park it first or the burst goes nowhere.
                  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: wheel.x, y: wheel.y })
                  await new Promise(r => setTimeout(r, 120))
                  for (let i = 0; i < wheel.count; i++) {
                    mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x: wheel.x, y: wheel.y, deltaY: wheel.deltaY })
                    await new Promise(r => setTimeout(r, 30))
                  }
                  log(`debug shot ${String(frame.name)}: wheel ×${wheel.count} sent`)
                }
                await new Promise(r => setTimeout(r, 400))
                const img = await mainWindow.webContents.capturePage()
                writeFileSync(path.join(shotDir, `${String(frame.name)}.png`), img.toPNG())
              }
              log(`debug shots: ${Array.isArray(frames) ? frames.length : 0} frame(s) into ${shotDir}`)
              // Optional burst series: WRITERX_DEBUG_SERIES='<count>:<intervalMs>' —
              // capture <count> pageshots <intervalMs> apart (reproducing states
              // that only appear during a human's real scroll gesture).
              const series = /^(\d+):(\d+)$/.exec(process.env.WRITERX_DEBUG_SERIES ?? '')
              if (series !== null) {
                const count = Number(series[1])
                const interval = Number(series[2])
                for (let i = 0; i < count; i++) {
                  await new Promise(r => setTimeout(r, interval))
                  const img = await mainWindow.webContents.capturePage()
                  writeFileSync(path.join(shotDir, `s-${String(i).padStart(3, '0')}.png`), img.toPNG())
                }
                log(`debug shots: series ${count}×${interval}ms done`)
                const rec = await mainWindow.webContents.executeJavaScript(
                  'JSON.stringify(globalThis.__recordSamples ?? null)', true,
                ).catch(() => 'null')
                log(`debug series record: ${typeof rec === 'string' ? rec : JSON.stringify(rec)}`)
              }
            }
          } catch (e) {
            log(`debug eval failed: ${e}`)
          }
        })()
      }, 3000)
    })
  }
  // Brand isolation: the engine's page title ("DeepSeek Harness") must never
  // reach the window chrome or the taskbar.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow.setTitle(PRODUCT.windowTitle)
  })
  mainWindow.setTitle(PRODUCT.windowTitle)
}

/** The app URL (the dsh web surface on the spawned server). */
function appUrl() {
  return `http://127.0.0.1:${serverPort}/`
}

/**
 * Ask the local Plaza Host to install the exact server-authorized revision.
 * This runs in the trusted main process so the renderer cannot claim an
 * install completed and then submit campaign heat without the Host actually
 * verifying and atomically replacing the skill directory.
 */
async function installPlazaSkillOnHost(id, intent) {
  return installPlazaSkillOnHostRequest({ port: serverPort, id, intent })
}

async function plazaInstalledManifestOnHost(expected) {
  return readPlazaInstalledManifest({ port: serverPort, expected })
}

async function reconcilePlazaInstallReceipts() {
  if (!serverReady || serverPort <= 0) return
  if (plazaReconcileFlight !== null) return plazaReconcileFlight
  let installedPromise
  const task = hub.reconcilePlazaInstalls(async expected => {
    installedPromise ??= listPlazaInstalledOnHost({ port: serverPort })
    return plazaInstalledManifest(await installedPromise, expected)
  }).catch((error) => {
    log(`plaza receipt reconciliation deferred: ${error instanceof Error ? error.message : String(error)}`)
  })
  plazaReconcileFlight = task
  task.finally(() => { if (plazaReconcileFlight === task) plazaReconcileFlight = null }).catch(() => {})
  return task
}

function startPlazaReconcileLoop() {
  if (plazaReconcileTimer !== null) return
  // install-intent lives for ten minutes. Rechecking prepared transactions
  // every 30 seconds closes the loop when a 60s client timeout fired just
  // before the Host committed its manifest.
  plazaReconcileTimer = setInterval(() => { void reconcilePlazaInstallReceipts() }, 30_000)
}

/**
 * The login page's theme: the product's own ui-theme.preference (the app's
 * setting), never the bare OS scheme — a person who set 深色 inside the app
 * expects a dark login too. Absent/unreadable settings mean system.
 */
function loginTheme() {
  // 0.1.7: the preference lives in the profile patch's ui-theme row override;
  // settings.yaml only exists until the engine's one-time legacy import.
  try {
    const pref = profileRowConfigSync(profilePatchPath(dshHome()), 'ui-theme')?.preference
    if (pref === 'dark' || pref === 'light') return pref
  } catch { /* fall through to the legacy document */ }
  try {
    const settings = yamlLoad(readFileSync(path.join(dshHome(), 'settings.yaml'), 'utf8'))
    const pref = settings?.['ui-theme']?.preference
    return pref === 'dark' || pref === 'light' ? pref : 'system'
  } catch {
    return 'system'
  }
}

/** Whether the shell's own surfaces (window canvas, window controls) paint dark: the same preference, resolved. */
function shellDark() {
  const theme = loginTheme()
  return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
}

function setStartupStage(stage, detail, { reset = false, phase } = {}) {
  startupStatus = {
    stage,
    detail,
    startedAt: reset ? Date.now() : startupStatus.startedAt,
    phase: phase ?? startupStatus.phase,
  }
  if (openingView !== null && !openingView.webContents.isDestroyed()) {
    openingView.webContents.send('opening:stage', { ...startupStatus })
  }
}

/** The 开场动画 setting (设置 → 通用 → 开场动画): full, brief or off; full when unset. */
function openingMode() {
  try { return openingModeSync(profilePatchPath(dshHome())) } catch { return 'full' }
}

/** Keep the opening exactly over the window's content. */
function fitOpening() {
  if (openingView === null || mainWindow === null || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  openingView.setBounds({ x: 0, y: 0, width, height })
}

/**
 * Cover the window with the opening. Launching the app plays the full intro
 * (the setting may ask for less); signing in and reconnecting are not a launch
 * and get the brief variant. An opening already up just takes the new stage.
 */
async function showOpening(variant) {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  if (openingView !== null) {
    openingView.webContents.send('opening:stage', { ...startupStatus })
    return
  }
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'opening-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Transparent: the reveal opens a hole in the scene onto the surface underneath.
  view.setBackgroundColor('#00000000')
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', event => { event.preventDefault() })
  // A dead opening would cover the window and never report it has played: take it away.
  view.webContents.on('render-process-gone', () => { if (openingView === view) closeOpening() })
  openingView = view
  mainWindow.contentView.addChildView(view)
  fitOpening()
  await view.webContents.loadFile(path.join(__dirname, 'opening.html'), {
    search: `?theme=${loginTheme()}&opening=${openingMode()}&variant=${variant}`,
  })
  if (openingView === view && !view.webContents.isDestroyed()) view.webContents.send('opening:stage', { ...startupStatus })
}

/** A landing place for the opening's mark: a sane rectangle reported by the surface, or nothing. */
function markRect(value) {
  if (value === null || typeof value !== 'object') return null
  const { x, y, width, height } = value
  const ok = [x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) && width >= 8 && height >= 8 && width <= 400 && height <= 400
  return ok ? { x, y, width, height } : null
}

/** The surface underneath has painted: let the opening open onto it. */
function revealOpening(target = null) {
  if (openingView === null || openingFinishTimer !== null) return
  clearTimeout(openingRevealTimer)
  openingRevealTimer = null
  openingView.webContents.send('opening:reveal', { target })
  // The page says when the reveal has played; a stuck page never keeps the window covered.
  openingFinishTimer = setTimeout(closeOpening, 4000)
}

/** Reveal anyway after `ms` if the surface never reports itself (a failed boot must stay visible). */
function revealOpeningLater(ms) {
  if (openingView === null || openingFinishTimer !== null) return
  clearTimeout(openingRevealTimer)
  openingRevealTimer = setTimeout(() => { openingRevealTimer = null; revealOpening(null) }, ms)
}

function closeOpening() {
  clearTimeout(openingRevealTimer)
  clearTimeout(openingFinishTimer)
  openingRevealTimer = null
  openingFinishTimer = null
  const view = openingView
  openingView = null
  if (view === null) return
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view)
    if (pendingTitleBarOverlay !== null) applyTitleBarOverlay(pendingTitleBarOverlay)
    // Hand the keyboard to the surface, without activating a window left in the background
    // (on Windows a minimized window can still report itself focused, and focusing it restores it).
    if (mainWindow.isFocused() && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.webContents.focus()
  }
  pendingTitleBarOverlay = null
  if (!view.webContents.isDestroyed()) view.webContents.close()
  releaseSurfaceWaiters()
}

/** Resolves once no opening covers the window (at once when none does). */
function whenSurfaceClear() {
  return openingView === null ? Promise.resolve() : new Promise(resolve => { surfaceClearWaiters.push(resolve) })
}

function releaseSurfaceWaiters() {
  const waiters = surfaceClearWaiters
  surfaceClearWaiters = []
  for (const resolve of waiters) resolve()
}

// Surface changes are not activation requests. Only the initial local paint
// reveals the window; refresh, sign-in completion and recovery preserve the
// user's minimized/hidden state (isVisible() is also false when minimized).
async function showStartupSurface(stage = '正在启动写作引擎', detail = '正在加载本地写作组件。', { revealInitially = false, phase = 'prepare' } = {}) {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  setStartupStage(stage, detail, { reset: true, phase })
  await showOpening(revealInitially ? 'launch' : 'resume')
  if (mainWindow === null || mainWindow.isDestroyed()) return
  // What was under the opening (the sign-in page just used, a workbench whose
  // engine died) is over; the next surface loads fresh.
  const contents = mainWindow.webContents
  const current = contents.getURL()
  if (current !== '' && current !== 'about:blank') {
    // Cut short (another navigation): the old page stays under the opening until the next surface replaces it.
    await navigateMainWindow(() => contents.loadURL('about:blank')).catch(error => {
      log(`clearing the window failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  if (mainWindow === null || mainWindow.isDestroyed()) return
  if (revealInitially && !mainWindow.isMinimized()) mainWindow.show()
}

/** Whether the window shows the sign-in page (loaded from the shell's own files). */
function onLoginPage(url) {
  return url.startsWith('file://') && url.includes('/login.html')
}

/** Whether the window shows an engine's workbench — any port: the page of an engine that just died counts too. */
function onWorkbenchPage(url) {
  return /^http:\/\/127\.0\.0\.1:\d+\//.test(url)
}

/** How long the workbench may take to write its pending edits before the engine stops or the window closes. */
const SETTLE_BUDGET_MS = 3000
/** The editor's listener: packages/client/ui-novel-shelf/src/client/index.ts (SETTLE_EVENT). */
const SETTLE_EVENT = 'writerx:settle-documents'

/**
 * Ask the workbench to write the edits it still holds while the engine answers (立即重启, quit,
 * sign-out, the author closing the window). Resolves with how many open documents keep unsaved edits
 * and how many of those have no recovery copy; a page that does not answer in time counts as one of
 * each, since nothing is known about it.
 * @returns {Promise<{ pending: number, unprotected: number }>}
 */
async function settleWorkbench(budgetMs = SETTLE_BUDGET_MS) {
  const contents = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (contents === null || contents.isDestroyed() || !onWorkbenchPage(contents.getURL())) return { pending: 0, unprotected: 0 }
  const script = `(async () => {
    const work = []
    window.dispatchEvent(new CustomEvent(${JSON.stringify(SETTLE_EVENT)}, { detail: { budgetMs: ${budgetMs}, waitUntil: promise => { work.push(promise) } } }))
    const answers = await Promise.all(work.map(promise => Promise.resolve(promise).catch(() => ({ pending: 1, unprotected: 1 }))))
    return answers.reduce((sum, row) => ({ pending: sum.pending + (Number(row && row.pending) || 0), unprotected: sum.unprotected + (Number(row && row.unprotected) || 0) }), { pending: 0, unprotected: 0 })
  })()`
  let timer
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs + 1000) })
  try {
    const answer = await Promise.race([contents.executeJavaScript(script).catch(() => null), late])
    if (answer === null || typeof answer !== 'object') return { pending: 1, unprotected: 1 }
    return { pending: Number(answer.pending) || 0, unprotected: Number(answer.unprotected) || 0 }
  } finally {
    clearTimeout(timer)
  }
}

/** The question before leaving edits that could not be written. `pending` 0 means the count is unknown. */
function unsavedEditsQuestion({ pending, unprotected }, proceed) {
  return {
    type: 'warning',
    title: PRODUCT.name,
    message: pending > 1 ? `还有 ${pending} 份文稿的修改没存进文件` : '还有文稿的修改没存进文件',
    detail: unprotected > 0
      ? '有的修改没能在本机留下恢复副本，现在离开会丢掉它们。建议先回去点「下载修改备份」。'
      : '可能是正在等你核对的冲突，或者刚才没能保存。这些修改已在本机留了恢复副本，下次打开这份文稿时可以找回。',
    buttons: ['返回查看', proceed],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
}

/**
 * The author closed the window: write what can still be written, ask only when edits are left (a
 * conflict waiting for them, a save that failed), then close for real.
 */
async function closeAfterSettling() {
  const window = mainWindow
  if (window === null || window.isDestroyed()) return
  try {
    const left = await settleWorkbench()
    if (window.isDestroyed()) return
    if (left.pending > 0) {
      const { response } = await dialog.showMessageBox(window, unsavedEditsQuestion(left, '仍然关闭'))
      if (response !== 1 || window.isDestroyed()) return
    }
  } catch (error) {
    log(`close: settling the documents failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (window.isDestroyed()) return
  closeApproved = true
  window.close()
  // A renderer that never answers its unload handlers must not keep the window (and the app) alive.
  setTimeout(() => { if (!window.isDestroyed()) window.destroy() }, 5000).unref?.()
}

/** A navigation the shell starts itself; settling happened before the engine stopped, recovery copies keep the rest. */
async function navigateMainWindow(load) {
  unloadOverrides += 1
  try {
    return await load()
  } finally {
    unloadOverrides -= 1
  }
}

/** Stop the engine — after the workbench wrote what it could while the engine still answered. */
async function settleThenStopServer() {
  if (serverReady) {
    const left = await settleWorkbench()
    if (left.pending > 0) log(`engine stop: ${left.pending} open document(s) keep unsaved edits in their recovery copies`)
  }
  await stopServer()
}

/**
 * The sign-in page. `reason`: the workbench could not be shown; the page says so (login.js `notice`), and
 * signing in again starts the engine afresh.
 */
async function showLoginSurface(_status, reason) {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  if (reason !== undefined) log(`workbench not shown, back to the sign-in page: ${reason instanceof Error ? reason.message : String(reason)}`)
  const current = mainWindow.webContents.getURL()
  if (onLoginPage(current) && reason === undefined) {
    revealOpening(null)
    return
  }
  const window = mainWindow
  try {
    await navigateMainWindow(() => window.loadFile(path.join(__dirname, 'login.html'), { search: `?theme=${loginTheme()}${reason === undefined ? '' : '&notice=workbench'}` }))
  } finally {
    // A page that failed to load never reports itself: the opening must not stay over it.
    revealOpeningLater(1500)
  }
}

async function showWorkbenchSurface() {
  if (!serverReady || serverPort <= 0) throw new Error('workbench server is not ready')
  if (mainWindow === null || mainWindow.isDestroyed()) return
  const url = appUrl()
  if (mainWindow.webContents.getURL().startsWith(url)) {
    revealOpening(null)
    return
  }
  const launchUrl = server === null ? undefined : engineLaunchUrls.get(server)
  if (!launchUrl) throw new Error('workbench authentication is not ready')
  // Official Connection mints an HttpOnly cookie and redirects to clean `/`.
  // Do not persist or pass the launch credential through renderer IPC.
  try {
    const window = mainWindow
    await navigateMainWindow(() => window.loadURL(launchUrl))
  } catch {
    // Electron navigation errors contain the failed URL, including its token.
    throw new Error('无法打开已认证的 WriterX 工作台，请重新登录后重试。')
  } finally {
    revealOpeningLater(15000)
  }
}

/** Renderer crashes this close together count as one run of trouble; this many stop the automatic reloads. */
const RENDERER_CRASH_WINDOW_MS = 5 * 60_000
const RENDERER_CRASH_LIMIT = 3
let rendererCrashes = []

/**
 * The window's page process died (crashed, killed, out of memory): the window would stay blank. Load the
 * surface again — the editor keeps recovery copies of unsaved edits. A page that keeps dying stops the
 * automatic reloads and asks, so a crash that comes back at once cannot loop.
 */
async function recoverRenderer(details) {
  const window = mainWindow
  if (quitting || closeApproved || window === null || window.isDestroyed()) return
  const contents = window.webContents
  const url = contents.getURL()
  const surface = onWorkbenchPage(url) ? 'the workbench' : onLoginPage(url) ? 'the sign-in page' : null
  log(`window page gone (${details?.reason ?? 'unknown'}, exit ${details?.exitCode ?? '?'}) on ${surface ?? 'a blank page'}`)
  // Under the opening: the next surface loads over it anyway.
  if (surface === null) return
  const now = Date.now()
  rendererCrashes = [...rendererCrashes.filter(at => now - at < RENDERER_CRASH_WINDOW_MS), now]
  if (rendererCrashes.length >= RENDERER_CRASH_LIMIT) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'error',
      title: PRODUCT.name,
      message: '窗口里的页面反复出错',
      detail: `几分钟内已经自动重新加载了 ${rendererCrashes.length - 1} 次。没存进文件的修改在本机留有恢复副本，下次打开那份文稿时可以找回。可以再加载一次，或者退出后重新打开 WriterX Hermes。`,
      buttons: ['重新加载', '退出 WriterX Hermes'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (quitting || window.isDestroyed()) return
    if (response === 1) {
      app.quit()
      return
    }
    rendererCrashes = []
  }
  if (!contents.isDestroyed()) contents.reload()
}

/** Tell the boot how this launch is going. Its methods never throw; a broken one still must not stop the shell. */
function reportToBoot(method) {
  if (BOOT === null || typeof BOOT[method] !== 'function') return
  try {
    BOOT[method]()
  } catch {
    // The boot journals its own failures.
  }
}

/**
 * A surface under the opening painted. The sign-in page means this launch
 * stops short of the engine, so a trial is not charged for it; the workbench
 * on the running engine means the build works (impl spec §6 健康确认). The
 * opening's fallback reveal timers prove nothing and never come through here.
 */
function reportSurfaceHealth(url) {
  if (onLoginPage(url)) reportToBoot('loginReady')
  else if (serverReady && serverPort > 0 && url.startsWith(appUrl())) {
    reportToBoot('markHealthy')
    // A trial launch kept a newer version waiting until now; the builds it replaced can go too.
    void updates?.launchHealthy().catch(error => log(`updater after health: ${error instanceof Error ? error.message : String(error)}`))
  }
}

/** Reconcile login/admission, engine listener, and the visible surface. */
function loadAppSurface(status) {
  if (appLifecycle === null) return Promise.resolve()
  return appLifecycle.reconcile(status)
}

/** Admission came back while the sign-in page was up: the same way in as a launch with a confirmed account. */
function returnToWorkbench() {
  if (returningToWorkbench !== null) return returningToWorkbench
  returningToWorkbench = (async () => {
    // The notice comes from the admission check; its model session is exchanged right behind it in the
    // same account queue. The engine reads that credential, so wait for it before starting the engine.
    await hub.renewSession()
    const status = await hub.status()
    if (!isHermesAdmitted(status) || status.session === null || quitting || accountFlights > 0
      || mainWindow === null || mainWindow.isDestroyed() || !onLoginPage(mainWindow.webContents.getURL())) return
    log('Hermes admission confirmed again on the sign-in page; reopening the workbench')
    await showStartupSurface('正在恢复 WriterX 工作台', '账号已验证，正在启动本地写作引擎。')
    await loadAppSurface(status)
  })().catch(error => {
    log(`reopening the workbench failed: ${error instanceof Error ? error.message : String(error)}`)
  }).finally(() => { returningToWorkbench = null })
  return returningToWorkbench
}

/**
 * Only the product window's top frame (login, startup and workbench pages all
 * load there) may reach the writerx:* bridge; the handlers act on the signed-in
 * account, so a subframe or any other webContents is refused.
 */
function fromMainFrame(event) {
  return mainWindow !== null && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
}

/** Wrap one IPC handler: Hub failures serialize as { ok:false, code, message }. */
function hubHandler(handler, feature) {
  return async (event, ...args) => {
    if (!fromMainFrame(event)) return { ok: false, code: 'FORBIDDEN', message: '请求来源不受信任' }
    try {
      if (feature !== undefined) {
        if (entitlementPolicy === null) throw Object.assign(new Error('暂时无法确认会员权益'), { code: 'ENTITLEMENT_UNAVAILABLE' })
        entitlementPolicy.assertFeature(await hub.entitlements(), feature)
      }
      return { ok: true, status: await handler(...args) }
    } catch (error) {
      return {
        ok: false,
        code: error instanceof Error && 'code' in error ? error.code : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/** Register the writerx:* IPC surface the preload bridge exposes. */
function registerHubIpc() {
  ipcMain.handle('writerx:open-login', async event => {
    if (!fromMainFrame(event)) return false
    const status = await hub.logout()
    await loadAppSurface(status)
    return true
  })
  taskNotifications = createDecomposeNotifications({ Notification, getWindow: () => mainWindow })
  // The opening's own channels: accepted from the opening page only.
  const fromOpening = event => openingView !== null && event.sender === openingView.webContents
    && event.senderFrame === openingView.webContents.mainFrame
  ipcMain.handle('opening:status', event => fromOpening(event) ? { ...startupStatus } : null)
  ipcMain.on('opening:finished', event => { if (fromOpening(event)) closeOpening() })
  ipcMain.handle('opening:titlebar-overlay', (event, overlay) => fromOpening(event) ? applyTitleBarOverlay(overlay) : false)
  // The surface under the opening (sign-in, the workbench's title bar) has
  // painted, and says where its own mark is so the opening's mark lands there.
  ipcMain.handle('writerx:surface-ready', (event, info) => {
    if (!fromMainFrame(event)) return false
    reportSurfaceHealth(mainWindow.webContents.getURL())
    revealOpening(markRect(info?.mark))
    return true
  })
  ipcMain.handle('writerx:decompose-notify', (event, input) => {
    if (!fromMainFrame(event)) return false
    return taskNotifications.notify(input)
  })
  ipcMain.handle('writerx:decompose-background-active', (event, active) => {
    if (!fromMainFrame(event)) return false
    // 后台拆书在跑，电脑也不自动睡（keep-awake.mjs）。
    keepAwake.set(event.sender.id, 'decompose', active)
    return taskNotifications.setActive(active)
  })
  // 生成期间电脑不睡眠：页面报「会话在生成」「风格蒸馏」「联网取正文」「热榜风向」开了或停了（keep-awake.mjs）。
  ipcMain.handle('writerx:keep-awake', (event, source, active) => {
    if (!fromMainFrame(event) || !isPageSource(source)) return false
    return keepAwake.set(event.sender.id, source, active)
  })
  ipcMain.handle('writerx:status', hubHandler(() => hub.status()))
  // The launch announcement: { title, content } once the opening has gone, null when there is none.
  ipcMain.handle('writerx:startup-notice', hubHandler(() => startupNotice.current()))
  ipcMain.handle('writerx:startup-notice-dismissed', event => {
    if (!fromMainFrame(event)) return false
    startupNotice.dismiss()
    return true
  })
  // The models page: catalog (free/premium, agent capability), balance
  // (credits / daily free left / premium usability / cost table), preflight.
  ipcMain.handle('writerx:catalog', hubHandler((options) => hub.catalog(options)))
  ipcMain.handle('writerx:quota-balance', hubHandler(() => hub.quotaBalance()))
  ipcMain.handle('writerx:quota-preflight', hubHandler((model, estimatedCalls, estimates) => hub.quotaPreflight(model, estimatedCalls, estimates)))
  // The account page: membership plans, the WeChat checkout (one live order
  // per device, resumed across restarts), and the read-only ledgers.
  ipcMain.handle('writerx:account-sync', hubHandler(async () => {
    accountFlights += 1
    try {
      const status = await hub.accountSync()
      void reconcilePlazaInstallReceipts()
      // An explicit sync may discover that beta admission was closed or
      // revoked. Re-evaluate the window surface instead of leaving a stale
      // workbench visible with silently disabled cloud credentials.
      await loadAppSurface(status)
      return status
    } finally {
      accountFlights -= 1
    }
  }))
  // 广场社区（身份 / 笔名 / 评论互动 / 我的投稿）——refreshToken 只在主进程。
  // Community authorship belongs to the signed-in account, not to feature
  // membership. The Hub verifies ownership/bans and only exposes another
  // author's full prompt/bundle behind the separate member detail endpoints.
  ipcMain.handle('writerx:plaza-me', hubHandler(() => hub.plazaMe()))
  ipcMain.handle('writerx:plaza-nickname', hubHandler(nickname => hub.plazaSetNickname(nickname)))
  ipcMain.handle('writerx:plaza-comment', hubHandler((id, content, rating) => hub.plazaCommentPost(id, content, rating)))
  ipcMain.handle('writerx:plaza-helpful', hubHandler(commentId => hub.plazaCommentHelpful(commentId)))
  ipcMain.handle('writerx:plaza-reply', hubHandler((commentId, content) => hub.plazaCommentReply(commentId, content)))
  ipcMain.handle('writerx:plaza-report', hubHandler((commentId, reason) => hub.plazaCommentReport(commentId, reason)))
  ipcMain.handle('writerx:plaza-mine', hubHandler(() => hub.plazaMine()))
  ipcMain.handle('writerx:plaza-install', hubHandler(id => hub.plazaInstall(
    id,
    intent => installPlazaSkillOnHost(id, intent),
    plazaInstalledManifestOnHost,
  )))
  ipcMain.handle('writerx:plaza-submit-bundle', hubHandler((meta, zipBase64) => hub.plazaSubmitBundle(meta, zipBase64)))
  // zip 直投/导入的选文件链：主进程读盘（渲染不碰路径），取消回 null。
  ipcMain.handle('writerx:plaza-pick-zip', hubHandler(async () => {
    const picked = await dialog.showOpenDialog(mainWindow ?? BrowserWindow.getAllWindows()[0], {
      title: '选择技能包（.zip）',
      filters: [{ name: '技能包（.zip）', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    const file = picked.filePaths[0]
    if (picked.canceled || file === undefined) return null
    const info = await stat(file)
    if (info.size > 4 * 1024 * 1024) {
      const tooLarge = new Error('技能包超过 3 MiB 上限——精简一下再投')
      tooLarge.code = 'TOO_LARGE'
      throw tooLarge
    }
    return { zipBase64: (await readFile(file)).toString('base64'), fileName: path.basename(file) }
  }))
  ipcMain.handle('writerx:payments-plans', hubHandler(() => hub.paymentsPlans()))
  ipcMain.handle('writerx:payments-create', hubHandler((planId, phone) => hub.paymentsCreate(planId, phone)))
  ipcMain.handle('writerx:payments-pending', hubHandler(() => hub.paymentsPending()))
  ipcMain.handle('writerx:payments-cancel', hubHandler(() => hub.paymentsCancel()))
  ipcMain.handle('writerx:pack-balance', hubHandler(() => hub.packBalance()))
  ipcMain.handle('writerx:my-orders', hubHandler(() => hub.myOrders()))
  ipcMain.handle('writerx:my-usage', hubHandler(() => hub.myUsage()))
  // 反馈工单（设置 →「反馈与支持」）：内容在这里再核对一遍（feedback.mjs）。版本、通道、系统由这里补，屏幕和当前模型
  // 只有页面知道。问题勾了「附带诊断信息」才现打诊断包，打不出来不挡提交。日志只记错误码，不记描述和图片。
  ipcMain.handle('writerx:feedback-submit', hubHandler(async input => {
    const ticket = normalizeFeedbackInput(input)
    const client = feedbackClientJson({
      version: APP_VERSION, channel: updates?.snapshot?.()?.channel ?? '', os: osName(), platform: platformName(), screen: ticket.screen, model: ticket.model,
    })
    let diag = null
    if (ticket.attachDiag) {
      const environment = updates?.diagnostics?.() || `WriterX Hermes ${APP_VERSION}（${process.platform}-${process.arch}）\n${osName()}`
      try {
        diag = await buildFeedbackDiag({ environment, logPath: path.join(app.getPath('userData'), 'server.log'), redact: createRedactor(defaultRedactIdentity()) })
      } catch (error) {
        log(`feedback diag skipped: ${error instanceof Error ? error.name : 'unknown'}`)
      }
    }
    try {
      return await hub.feedbackSubmit({ kind: ticket.kind, text: ticket.text, client, images: ticket.images, diag })
    } catch (error) {
      log(`feedback submit failed code=${String(error?.code ?? 'UNKNOWN').slice(0, 40)}`)
      throw error
    }
  }))
  ipcMain.handle('writerx:feedback-mine', hubHandler(cursor => hub.feedbackMine(Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null)))
  ipcMain.handle('writerx:feedback-image', hubHandler(async id => {
    if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('图片不存在'), { code: 'NOT_FOUND' })
    const file = await hub.feedbackImage(id)
    return { mime: file.mime, bytes: new Uint8Array(file.bytes) }
  }))
  // AI 配图（生图）：刷新令牌、Hub 请求、图库文件都只在主进程；页面拿到的只有图库记录与图片字节
  // （契约见 packages/shared/image-gen/README.md「桌面壳的桥」）。参数由 image-library.mjs 按白名单校验。
  ipcMain.handle('writerx:image-catalog', hubHandler(options => hub.imageCatalog({ force: options?.force === true })))
  ipcMain.handle('writerx:image-balance', hubHandler(() => hub.imageBalance()))
  ipcMain.handle('writerx:image-create', hubHandler(async input => (await openImageLibrary()).create(input)))
  ipcMain.handle('writerx:image-list', hubHandler(async query => (await openImageLibrary()).list(query)))
  ipcMain.handle('writerx:image-read', hubHandler(async (jobId, kind) => (await openImageLibrary()).read(jobId, kind)))
  ipcMain.handle('writerx:image-cancel', hubHandler(async jobId => (await openImageLibrary()).cancel(jobId)))
  ipcMain.handle('writerx:image-retry', hubHandler(async jobId => (await openImageLibrary()).retry(jobId)))
  ipcMain.handle('writerx:image-withdraw', hubHandler(async requestKey => (await openImageLibrary()).withdraw(requestKey)))
  ipcMain.handle('writerx:image-remove', hubHandler(async jobId => (await openImageLibrary()).remove(jobId)))
  ipcMain.handle('writerx:image-placement', hubHandler(async (jobId, state) => (await openImageLibrary()).setPlacement(jobId, state)))
  ipcMain.handle('writerx:image-check-text', hubHandler(async (jobId, expected) => (await openImageLibrary()).checkText(jobId, expected)))
  ipcMain.handle('writerx:image-save-as', hubHandler(jobId => saveImageAs(jobId)))
  ipcMain.handle('writerx:image-reveal', hubHandler(jobId => revealImage(jobId)))
  ipcMain.handle('writerx:image-copy', hubHandler(jobId => copyImage(jobId)))
  // 浏览器打开支付页: only web URLs leave the app.
  ipcMain.handle('writerx:open-external', (event, url) => {
    if (!fromMainFrame(event)) return false
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
      return true
    }
    return false
  })
  ipcMain.handle('writerx:send-code', hubHandler((email, purpose) => hub.sendCode(email, purpose)))
  ipcMain.handle('writerx:reset-password', hubHandler((input) => hub.resetPassword(input)))
  ipcMain.handle('writerx:login', hubHandler(async (email, password) => {
    accountFlights += 1
    try {
      const status = await hub.login(email, password)
      if (isHermesAdmitted(status)) {
        await showStartupSurface('账号验证完成', '正在启动 WriterX 本地写作引擎。')
      }
      void reconcilePlazaInstallReceipts()
      await loadAppSurface(status)
      return status
    } finally {
      accountFlights -= 1
    }
  }))
  ipcMain.handle('writerx:register', hubHandler(async (input) => {
    accountFlights += 1
    try {
      const status = await hub.register(input)
      if (isHermesAdmitted(status)) {
        await showStartupSurface('账号创建完成', '正在启动 WriterX 本地写作引擎。')
      }
      void reconcilePlazaInstallReceipts()
      await loadAppSurface(status)
      return status
    } finally {
      accountFlights -= 1
    }
  }))
  ipcMain.handle('writerx:logout', hubHandler(async () => {
    const status = await hub.logout()
    await loadAppSurface(status)
    return status
  }))
  // The page's title bar reports its rendered colors whenever the theme
  // flips, so the OS controls overlay never sits on the wrong palette.
  ipcMain.handle('writerx:titlebar-overlay', (event, overlay) => {
    if (!fromMainFrame(event)) return false
    // While the opening covers the window, its palette owns the controls; the page's turn comes when it opens.
    if (openingView !== null) {
      pendingTitleBarOverlay = overlay
      return true
    }
    return applyTitleBarOverlay(overlay)
  })
}

/** Recolor the OS window controls (Windows only; on macOS the traffic lights keep their own rendering). */
function applyTitleBarOverlay(overlay) {
  if (mainWindow === null || mainWindow.isDestroyed() || typeof mainWindow.setTitleBarOverlay !== 'function') return false
  const color = typeof overlay?.color === 'string' ? overlay.color : undefined
  const symbolColor = typeof overlay?.symbolColor === 'string' ? overlay.symbolColor : undefined
  if (color === undefined && symbolColor === undefined) return false
  try {
    mainWindow.setTitleBarOverlay({ ...color === undefined ? {} : { color }, ...symbolColor === undefined ? {} : { symbolColor }, height: TITLEBAR_HEIGHT })
    return true
  } catch (error) {
    log(`titlebar overlay update failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

// ── AI 配图：图库（docs/hermes-image-generation-plan.md §3–§4） ─────────────

/** The image library's start (null before hub init). */
let imageLibraryFlight = null
/** That start failed (disk full, no permission, the drive it lives on is gone): the next use starts it again. */
let imageLibraryFailed = false

/** Electron's own decoder for the library's previews, thumbnails and the small images sent to the Hub. */
const imageTools = {
  size(bytes) {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    return image.isEmpty() ? null : image.getSize()
  },
  jpeg(bytes, edge, quality) {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const scale = Math.min(1, edge / Math.max(width, height))
    const fitted = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }) : image
    return fitted.toJPEG(quality)
  },
}

/**
 * Where the library lives: WRITERX_IMAGE_LIBRARY (smokes, tests) first; a portable copy keeps it in 图库 beside
 * the executable (and 作品), an installed copy or a protected / unwritable install directory in 文档\WriterX\图库.
 */
async function imageLibraryRoot() {
  const override = process.env.WRITERX_IMAGE_LIBRARY
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override)
  const documents = userFolder('documents')
  const fallback = path.join(documents, 'WriterX', '图库')
  const chosen = defaultImageLibraryLocation({
    packaged: app.isPackaged,
    platform: process.platform,
    installRoot: typeof BOOT?.installRoot === 'string' && BOOT.installRoot !== '' ? BOOT.installRoot : path.dirname(app.getPath('exe')),
    documents,
    installed: !portableInstall(),
    protectedRoots: [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.SystemRoot, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')],
  })
  if (chosen === fallback) return chosen
  try {
    await mkdir(chosen, { recursive: true })
    const probe = path.join(chosen, `.write-probe-${process.pid}`)
    await writeFile(probe, '')
    await rm(probe, { force: true })
    return chosen
  } catch {
    return fallback
  }
}

/** Start the library after the account is known: it resumes unfinished images for the signed-in account. */
function startImageLibrary() {
  imageLibraryFailed = false
  const flight = (async () => {
    const root = await imageLibraryRoot()
    const library = createImageLibrary({
      root,
      hub: hub.image,
      tools: imageTools,
      log,
      emit: record => {
        if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('writerx:image-library', record)
      },
    })
    await library.start()
    log('image library ready')
    return library
  })()
  imageLibraryFlight = flight
  flight.catch(error => {
    log(`image library unavailable (${error?.code ?? 'ERROR'})`)
    if (imageLibraryFlight === flight) imageLibraryFailed = true
  })
}

async function openImageLibrary() {
  if (imageLibraryFlight === null) throw Object.assign(new Error('图库还没准备好，稍后再试'), { code: 'IMAGE_LIBRARY_UNAVAILABLE' })
  // Last start failed: start it again now that it is wanted (once at a time), not only after a restart.
  if (imageLibraryFailed) startImageLibrary()
  try {
    return await imageLibraryFlight
  } catch {
    throw Object.assign(new Error('图库文件夹打不开（磁盘满了、没有权限，或者它所在的盘没接上）。处理好之后再试一次就行，不用重启软件。'), { code: 'IMAGE_LIBRARY_UNAVAILABLE' })
  }
}

/** 另存为…：系统保存框；选的路径只留在主进程。 */
async function saveImageAs(jobId) {
  const library = await openImageLibrary()
  const source = library.originalPath(jobId)
  const name = path.basename(source)
  const extension = path.extname(name).slice(1) || 'png'
  const options = {
    title: '另存为',
    defaultPath: path.join(userFolder('pictures'), name),
    filters: [{ name: '图片', extensions: [extension] }],
  }
  const picked = mainWindow !== null && !mainWindow.isDestroyed()
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath === '') return { saved: false }
  try {
    await copyFile(source, picked.filePath)
  } catch (error) {
    throw Object.assign(new Error('没存上，换个位置试试'), { code: typeof error?.code === 'string' ? error.code : 'WRITE_FAILED' })
  }
  return { saved: true }
}

/** 在图库中显示：带任务号选中那张，不带就打开图库文件夹。 */
async function revealImage(jobId) {
  const library = await openImageLibrary()
  if (jobId === undefined || jobId === null || jobId === '') {
    const failure = await shell.openPath(library.root)
    if (failure !== '') throw Object.assign(new Error('打不开图库文件夹'), { code: 'OPEN_FAILED' })
    return true
  }
  shell.showItemInFolder(library.originalPath(jobId))
  return true
}

/** 复制图片到剪贴板（Electron 解不开的格式说一声，可以用「另存为」）。 */
async function copyImage(jobId) {
  const library = await openImageLibrary()
  const image = nativeImage.createFromPath(library.originalPath(jobId))
  if (image.isEmpty()) throw Object.assign(new Error('这张图复制不了，可以用「另存为」'), { code: 'IMAGE_COPY_FAILED' })
  clipboard.writeImage(image)
  return true
}

// ── updater (impl spec §7, §9) ──────────────────────────────────────────────

/** An installed copy has the NSIS uninstaller beside its executable; anything else is a portable (ZIP) copy. */
function portableInstall() {
  const root = typeof BOOT?.installRoot === 'string' && BOOT.installRoot !== '' ? BOOT.installRoot : path.dirname(app.getPath('exe'))
  return !existsSync(path.join(root, `Uninstall ${PRODUCT.name}.exe`))
}

// The engine's lock waits up to 5 s for requests it already admitted before it answers (spec §8).
const UPDATE_TASK_TIMEOUT_MS = { inspect: 5000, lock: 15_000, unlock: 5000 }

/**
 * Ask the running engine what a restart would cut off, or lock / unlock it (spec §8), with this
 * launch's bridge token. No engine (signed out, still starting) means nothing to interrupt.
 */
function engineUpdateTaskCall(action) {
  const port = serverReady && server !== null && !childExited(server) ? serverPort : 0
  return engineUpdateTasks({ port, token: entitlementBridge?.token ?? '', action, timeoutMs: UPDATE_TASK_TIMEOUT_MS[action] ?? 5000 })
}

/**
 * Create and start the updater. start() at once sweeps what an interrupted run left and, in the
 * background, empties the trash of retired builds (cleanupTrash): this runs before the engine is
 * spawned, whose node.exe would keep the hard-linked twins of those files undeletable. The first
 * Hub check follows two minutes later; the quick integrity check waits for the first surface
 * (whenReady). A development run (no boot) gets a service that only says 开发版不检查更新.
 */
function startUpdates() {
  const allowLoopbackHttp = process.env.WRITERX_UPDATE_ALLOW_LOOPBACK_HTTP === '1'
  try {
    updates = createUpdateService({
      boot: BOOT,
      // To the updater app.asar is a file: hashing, linking and renaming builds go around Electron's asar layer.
      fs: createRequire(import.meta.url)('original-fs'),
      // Every redirect hop of a package link is checked (a bare net.fetch reports no final URL).
      fetchImpl: createRequestFetch({ request: options => net.request(options), allowLoopbackHttp }),
      hubUpdates: channel => hub.clientUpdates(channel),
      spawn,
      portable: portableInstall(),
      dev: !app.isPackaged,
      log,
      engineTasks: engineUpdateTaskCall,
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
      version: APP_VERSION,
      quickCheckDelayMs: null,
      // 关于 shows this version's notes from the first frame; a Hub check brings the published (maybe edited) text.
      releaseNotes: PAYLOAD_ROOT === null ? '' : String(readBuildInfo(path.join(PAYLOAD_ROOT, 'build-info.json'))?.releaseNotes ?? ''),
      // Asked before ensureProfile writes it: a profile already there on the first updater run is an
      // upgrade from a version without the updater (1.0.x), which gets 已更新到 x too.
      existingProfile: !isNewProfile({ dshHome: dshHome() }),
    })
    updates.onChange(pushUpdateState)
    updates.start()
  } catch (error) {
    updates = null
    log(`updater unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Every snapshot goes to the window's page as it changes (the service already holds progress to two a second). */
function pushUpdateState(snapshot) {
  const contents = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (contents !== null && !contents.isDestroyed()) contents.send('writerx:update-state', snapshot)
  askAboutMinimumVersion(snapshot)
}

/** Resolves once the product window is on screen (at once when it is), or when it closes. */
function whenWindowShown() {
  const window = mainWindow
  if (window === null || window.isDestroyed() || (window.isVisible() && !window.isMinimized())) return Promise.resolve()
  return new Promise(resolve => {
    const events = ['show', 'restore', 'closed']
    const done = () => {
      for (const name of events) window.removeListener(name, done)
      resolve()
    }
    for (const name of events) window.once(name, done)
  })
}

/**
 * 必须更新 (design §8): the running version is below the Hub's minimum. Once per launch, over the
 * page the author sees (not the opening, not a hidden window), a native dialog says why;
 * 立即更新 runs the same flow as 检查更新 (one that can only update by hand — a portable copy across a
 * runtime change, a required build this computer skipped — gets the download page; one that cannot
 * start now says why), 稍后 closes it and 关于 keeps saying it. Writing locally is never blocked.
 */
function askAboutMinimumVersion(snapshot) {
  const minimum = snapshot?.supported === true ? snapshot.minimum : undefined
  if (minimumAsked || minimum === undefined || minimum === null) return
  // No window yet: nowhere to put it; whenReady asks again right after creating the window.
  if (mainWindow === null || mainWindow.isDestroyed()) return
  minimumAsked = true
  void (async () => {
    // The opening is put up before the window first shows, so wait for the window first, then for the
    // opening to go, then for a window minimized meanwhile to come back.
    await whenWindowShown()
    await whenSurfaceClear()
    await whenWindowShown()
    if (quitting || mainWindow === null || mainWindow.isDestroyed()) return
    const reason = typeof minimum.message === 'string' ? minimum.message.trim() : ''
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: PRODUCT.name,
      message: `请更新到 ${minimum.version} 或更高版本`,
      detail: [
        reason,
        `当前版本 ${snapshot.version || APP_VERSION} 低于最低要求。选「稍后」可以接着写，本地写作和书稿不受影响；随时可以在「设置 → 关于」里更新。`,
      ].filter(Boolean).join('\n\n'),
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0 || updates === null) return
    const after = await updates.check({ manual: true })
    // By hand: a portable copy across a runtime change, or a build this computer skipped (service.mjs skipBadBuild).
    if (after?.phase === 'manual') openManualDownload()
    // It cannot start now (a launch that cannot read state.json, no network…): say why, where the author asked.
    else if (after?.phase === 'error' && typeof after.error?.message === 'string' && after.error.message !== ''
      && !quitting && mainWindow !== null && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, { type: 'warning', title: PRODUCT.name, message: '现在没法更新', detail: after.error.message, buttons: ['知道了'], noLink: true })
    }
  })().catch(error => log(`minimum-version prompt failed: ${error instanceof Error ? error.message : String(error)}`))
}

/** 去下载: the full package's page in the system browser (https only). */
function openManualDownload() {
  const url = updates?.snapshot().manual?.url
  const allowLoopbackHttp = process.env.WRITERX_UPDATE_ALLOW_LOOPBACK_HTTP === '1'
  if (typeof url !== 'string' || !isAllowedDownloadUrl(url, { allowLoopbackHttp })) return false
  void shell.openExternal(url)
  return true
}

/**
 * 保存诊断文件: the 自检 report into a .txt the author picks. Closing the dialog answers
 * { ok: false } with no code (the page says nothing); a failed write names its code.
 * The chosen path stays in the main process (not logged, not answered).
 */
async function saveUpdateDiagnostics() {
  if (updates === null) return { ok: false, code: 'UNAVAILABLE' }
  const today = new Date()
  const day = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const options = {
    title: '保存诊断信息',
    defaultPath: path.join(userFolder('documents'), `WriterX-Hermes-诊断-${day}.txt`),
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  }
  const picked = mainWindow !== null && !mainWindow.isDestroyed()
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath === '') return { ok: false }
  try {
    await writeFile(picked.filePath, updates.diagnostics(), 'utf8')
    return { ok: true }
  } catch (error) {
    const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'WRITE_FAILED'
    log(`diagnostics not saved (${code})`)
    return { ok: false, code }
  }
}

/**
 * The updater's half of the bridge (spec §9): writerx:update-* answer the product window's top
 * frame only, with the service's plain values; any other sender gets `refused`, a handler that
 * fails gets `failed` (both read as "no answer" by the page). Snapshots are pushed on
 * 'writerx:update-state' (pushUpdateState).
 */
function registerUpdateIpc() {
  const handle = (channel, handler, refused = null, failed = refused) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromMainFrame(event)) return refused
      try {
        return await handler(...args)
      } catch (error) {
        log(`${channel} failed: ${error instanceof Error ? error.message : String(error)}`)
        return failed
      }
    })
  }
  handle('writerx:update-get-state', () => updates?.snapshot() ?? null)
  // 关于's 检查更新 is manual (a failure is said out loud). The launch check behind 发现新版本 waits for the
  // opening to go, so a download never competes with the engine's cold start, and stays quiet when offline.
  handle('writerx:update-check', async options => {
    if (options?.startup !== true) return updates?.check({ manual: true }) ?? null
    await whenSurfaceClear()
    return updates?.check({ manual: false }) ?? null
  })
  handle('writerx:update-set-channel', channel => updates?.setChannel(channel) ?? null)
  handle('writerx:update-inspect-restart', () => updates?.inspectRestart() ?? null)
  handle('writerx:update-restart', options => updates?.restart({ confirmed: options?.confirmed === true }) ?? { ok: false, code: 'UNSUPPORTED' },
    { ok: false, code: 'FORBIDDEN' }, { ok: false, code: 'RESTART_FAILED' })
  handle('writerx:update-self-check', () => updates?.selfCheck() ?? null)
  handle('writerx:update-copy-diagnostics', () => {
    const text = updates?.diagnostics() ?? ''
    if (text !== '') clipboard.writeText(text)
    return text
  }, '')
  handle('writerx:update-save-diagnostics', () => saveUpdateDiagnostics(), { ok: false, code: 'FORBIDDEN' }, { ok: false, code: 'SAVE_FAILED' })
  handle('writerx:update-open-manual', () => openManualDownload(), false)
  // Notices kept for this launch (rolled back, repaired, ready) are handed out once the opening has
  // gone: under it nobody sees them, and handed out they are gone (a rollback counts as seen).
  ipcMain.handle('writerx:update-take-notices', async event => {
    if (!fromMainFrame(event)) return []
    await whenSurfaceClear()
    // The page that asked may have been replaced meanwhile: keep them for one that can show them.
    if (!fromMainFrame(event) || updates === null) return []
    return updates.takeNotices()
  })
}

/** A ready server died unexpectedly; the authenticated lifecycle decides restart. */
function onServerExit(child, code) {
  if (intentionalStops.has(child)) {
    if (server === child) {
      server = null
      serverReady = false
      serverPort = 0
    }
    if (bootChild === child) { bootChild = null; bootPort = 0 }
    return
  }
  if (server !== child) return // a stale child generation
  server = null
  serverReady = false
  serverPort = 0
  if (quitting) return
  log(`dsh server exited (code ${code})`)
  void (async () => {
    const status = await hub.status()
    if (!isHermesAdmitted(status)) {
      await loadAppSurface(status)
      return
    }
    if (relaunches >= PRODUCT.maxRelaunches) {
      fatal(new Error(`dsh server exited repeatedly (last code ${code})`))
      return
    }
    relaunches += 1
    log('relaunching authenticated workbench…')
    await showStartupSurface('正在重新连接写作引擎', '本地服务刚刚中断，正在自动恢复你的工作台。')
    await appLifecycle?.engineExited()
  })().catch(error => fatal(error))
}

function fatal(error) {
  log(`fatal: ${error.message}`)
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    dialog.showErrorBox(PRODUCT.name, `启动失败：${writerxPublicDiagnostic(error.message)}`)
  }
  app.quit()
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('cn.writerx.hermes')
    await mkdir(app.getPath('userData'), { recursive: true })
    serverLog = createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'a' })
    // A log-file failure (disk full, permissions) must never take the app down.
    serverLog.on('error', () => {})
    if (BOOT !== null) log(formatBootInfo(BOOT))
    if (PAYLOAD_ROOT !== null) {
      log(formatBuildInfo(readBuildInfo(path.join(PAYLOAD_ROOT, 'build-info.json'))))
    } else {
      log(`development build app=${APP_VERSION} target=${process.platform}-${process.arch}`)
    }
    server = null
    // Hub lifecycle: device installation, session renewal, login state, and
    // the catalog → `hub` model route + seeded default written into the
    // engine's settings. BEFORE the engine boots, so its first read of the
    // settings already carries the Hub models (a route written later only
    // reaches the engine on its next start). An unreachable or slow Hub must
    // not keep the window from opening: the window and the opening come up
    // before init, every Hub call has a time limit (hub-api.mjs), init
    // swallows transport failures, the login page reports them, and the next
    // login retries.
    hub = createHubService({
      dshHome: dshHome(),
      hubBaseUrl: PRODUCT.hubBaseUrl,
      appVersion: APP_VERSION,
      modelRoute: PRODUCT.hubModelRoute,
      // Keep routing credential clears through a living Host even after its
      // surface is closed; direct file writes are safe only after exit.
      enginePort: () => server !== null && !childExited(server)
        ? serverPort
        : bootChild !== null && !childExited(bootChild) ? bootPort : 0,
      engineCredentialToken: () => entitlementBridge?.token ?? '',
      onEntitlementsChanged: () => {
        if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('writerx:entitlements-changed')
        // 登录、退出、换号：图库重新认账号（别的账号画到一半的图等它登录回来再取）。
        void imageLibraryFlight?.then(library => library.accountChanged()).catch(() => {})
        // Background refresh may revoke login/admission without an IPC action.
        // Reconcile from the authoritative status; valid updates do not reload
        // the already-running workbench.
        if (appLifecycle !== null) void hub.status().then(status => {
          // Denials stop immediately. A fresh allowed login starts only after
          // its IPC operation has persisted the session credential; allowed
          // notifications merely maintain an already running/booting engine.
          if (!isHermesAdmitted(status) || serverReady || bootChild !== null) return loadAppSurface(status)
          // Admission came back by itself — the Hub was unreachable at launch, or a refused account was
          // let in again — while the sign-in page is up: reopen the workbench instead of waiting for the
          // author to sign in once more.
          if (accountFlights === 0 && !quitting
            && mainWindow !== null && !mainWindow.isDestroyed() && onLoginPage(mainWindow.webContents.getURL())) return returnToWorkbench()
        })
      },
      authorizeFeature: (feature, snapshot) => {
        if (entitlementPolicy === null) throw Object.assign(new Error('暂时无法确认会员权益'), { code: 'ENTITLEMENT_UNAVAILABLE' })
        entitlementPolicy.assertFeature(snapshot, feature)
      },
    })
    // Before hub.init and long before the engine: start() empties the trash of retired builds right away.
    startUpdates()
    try {
      await mkdir(dshHome(), { recursive: true })
    } catch (error) {
      // ensureProfile below fails over it and says so.
      log(`data folder not created: ${error instanceof Error ? error.message : String(error)}`)
    }
    // A new install starts on the dark theme. Decided before the profile is
    // written (afterwards every home looks launched) and before the window
    // exists, so the very first frame — canvas, login page, app — is dark.
    // An existing profile keeps whatever it has, 跟随系统 included.
    if (isNewProfile({ dshHome: dshHome() })) {
      try {
        if (await seedNewInstallTheme(dshHome())) log('new install: theme preference set to dark')
      } catch (error) {
        log(`new-install theme seed failed (continuing on the system theme): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    registerHubIpc()
    registerUpdateIpc()
    createWindow()
    // A check that answered before the window existed may already know the version is below the minimum.
    if (updates !== null) askAboutMinimumVersion(updates.snapshot())
    // On screen before the Hub handshake: a slow Hub keeps the opening up a little longer, never the window away.
    await showStartupSurface('正在连接 WriterX 账号', '正在确认登录状态，网络慢时要多等一会儿。', { revealInitially: true })
    try {
      const policyPackage = PRODUCT_PACKAGES.find(pkg => pkg.name === '@writerx/dsh-entitlements')
      entitlementPolicy = await import(pathToFileURL(path.join(policyPackage.dir, 'lib/policy.js')).href)
      entitlementBridge = await startEntitlementBridge({ readSnapshot: () => hub.entitlements() })
      // The product profile must exist before the engine resolves it.
      const profile = ensureProfile({ dshHome: dshHome(), packages: PRODUCT_PACKAGES })
      log(`profile ${PROFILE_NAME} ready at ${profile.dir} (${profile.links.length} product packages linked${profile.removed.length > 0 ? `; retired links removed: ${profile.removed.join(', ')}` : ''})`)
    } catch (error) {
      fatal(error)
      return
    }
    try {
      await hub.init()
    } catch (error) {
      log(`hub init failed (continuing logged-out): ${error instanceof Error ? error.message : String(error)}`)
    }
    // After init: the account is known, so the library resumes this account's unfinished images right away.
    startImageLibrary()
    // Closed or quit while the Hub answered: nothing to open, and no engine may start behind the quit.
    if (quitting || mainWindow === null || mainWindow.isDestroyed()) return
    appLifecycle = createAuthenticatedLifecycle({
      readStatus: () => hub.status(),
      startEngine: signal => bootServer(signal),
      // Sign-out, a lost admission and quit stop the engine: the open documents write what they hold first.
      stopEngine: () => settleThenStopServer(),
      showLogin: (status, reason) => showLoginSurface(status, reason),
      showApp: () => showWorkbenchSurface(),
      onError: error => fatal(error),
    })
    const initialStatus = await hub.status()
    // The window and the opening are up already (above): only the stage moves on.
    setStartupStage(
      isHermesAdmitted(initialStatus) ? '正在恢复 WriterX 工作台' : '正在准备登录',
      isHermesAdmitted(initialStatus) ? '账号已验证，正在启动本地写作引擎。' : '正在载入 WriterX 账号入口。',
      { reset: true },
    )
    await loadAppSurface(initialStatus)
    // The first surface (sign-in or the workbench) is up: only once the opening has opened onto it does
    // the quick integrity check run (and fetch damaged files again), so it never competes with the first window.
    void whenSurfaceClear().then(() => updates?.quickCheck())
  }).catch(error => {
    // Whatever went wrong on the way to the first surface must not leave the opening up for good.
    fatal(error instanceof Error ? error : new Error(String(error)))
  })

  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', event => {
    if (quitCleanupComplete) return
    event.preventDefault()
    if (quitCleanupFlight !== null) return
    quitting = true
    const lifecycle = appLifecycle
    appLifecycle = null
    quitCleanupFlight = (async () => {
      // Nothing new is checked, downloaded or repaired while the app goes down; a run in flight is cancelled.
      updates?.dispose()
      taskNotifications?.dispose()
      // 退出时防休眠立即放，不等 60 秒。
      keepAwake.dispose()
      void imageLibraryFlight?.then(library => library.dispose()).catch(() => {})
      if (lifecycle !== null) await lifecycle.dispose()
      else await stopServer()
      hub?.dispose?.()
      await entitlementBridge?.close()
      quitCleanupComplete = true
      app.quit()
      // The engine is down and nothing may hold the quit back any more (the documents settled before
      // the engine stopped; will-prevent-unload lets every unload through while quitting). A renderer
      // that never answers its unload handlers must still not keep the process alive.
      setTimeout(() => {
        log('shutdown: windows did not close in time; exiting')
        // app.exit() skips the process 'exit' event that releases update.lock otherwise.
        releaseHeldLocks()
        app.exit(0)
      }, 8000).unref?.()
    })().catch(async error => {
      log(`shutdown cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      try { await stopServer() } catch (retryError) {
        log(`forced shutdown could not confirm workbench exit: ${retryError instanceof Error ? retryError.message : String(retryError)}`)
      }
      hub?.dispose?.()
      try { await entitlementBridge?.close() } catch { /* process is exiting */ }
      quitCleanupComplete = true
      releaseHeldLocks()
      app.exit(1)
    })
  })

  // The shell must never die silently: surface any stray rejection in the log.
  process.on('unhandledRejection', reason => {
    log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })
}
