// 引导器自带的清单验签（实施规格 §4、§6「检查一个 build 能不能用」）。
// 引导器跟运行时层一起发，载荷每版都换，所以这里不引用载荷里的任何代码，自己验一遍。
// 文件操作一律用调用方注入的 fs：Electron 里是 original-fs（不把 app.asar 当目录），测试里是 node:fs。
// 这里的函数都不抛错：验不过就返回 { ok: false, reason }，由引导器决定退到哪一版。
import { createHash, createPublicKey, verify } from 'node:crypto'
import path from 'node:path'

/** Ed25519 公钥的 SPKI DER 前缀；拼上 32 字节原始公钥就是完整的 SPKI。 */
export const ED25519_SPKI_PREFIX = '302a300506032b6570032100'

const SPKI_PREFIX = Buffer.from(ED25519_SPKI_PREFIX, 'hex')
// 目录名就是 build：正整数、不带前导零；`1046.staging` 这类半成品不算。
const BUILD_DIR_RE = /^[1-9][0-9]{0,14}$/
// 清单的键顺序是固定的，`files` 前面就是这几项小字段。签名验过后，只解析 `files` 之前那一段，
// 免得每次启动都把两三 MB、两万多行的文件表整个 parse 一遍；对不上就退回整份解析。
const FILES_KEY = ',"files":'
// 头部要有这几项才算读全了；键顺序不是固定写法时（比如 files 排在 version 前面）退回整份解析。
const HEAD_KEYS = ['schema', 'product', 'version', 'build', 'runtime']
// app.asar 那一条在固定写法下就是这样开头（路径不含要转义的字符，别处出现的同样文字都带转义的引号）。
// 签名验过的字节才拿来找，找不到或解析不了就退回整份解析。
const ASAR_ENTRY_HEAD = '{"p":"app.asar",'
const SHA256_RE = /^[0-9a-f]{64}$/
const HASH_BLOCK = 1 << 20

const isPositiveInt = value => Number.isSafeInteger(value) && value > 0

/**
 * 把 32 字节原始公钥（base64）变成 KeyObject；格式不对返回 null。
 * @param {string} raw
 * @returns {import('node:crypto').KeyObject | null}
 */
export function publicKeyFromRaw(raw) {
  try {
    if (typeof raw !== 'string') return null
    const bytes = Buffer.from(raw, 'base64')
    if (bytes.length !== 32) return null
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, bytes]), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

/**
 * 用任意一把内置公钥验 `manifest.sig`（原始字节上的 Ed25519 签名）。
 * @param {Buffer} bytes manifest.json 的原始字节
 * @param {string} sigText manifest.sig 的内容：88 个字符的 base64 加换行
 * @param {string[]} keys 原始公钥的 base64 列表
 * @returns {boolean}
 */
export function verifyManifestSignature(bytes, sigText, keys) {
  try {
    const signature = Buffer.from(String(sigText).trim(), 'base64')
    if (signature.length !== 64) return false
    for (const raw of keys) {
      const key = publicKeyFromRaw(raw)
      if (key === null) continue
      try {
        if (verify(null, bytes, key, signature)) return true
      } catch {
        // 换下一把：坏掉的公钥不该挡住备用公钥。
      }
    }
    return false
  } catch {
    return false
  }
}

function parseHead(text) {
  const cut = text.indexOf(FILES_KEY)
  if (cut > 0) {
    try {
      const head = JSON.parse(`${text.slice(0, cut)}}`)
      if (head !== null && typeof head === 'object' && HEAD_KEYS.every(key => key in head)) return head
    } catch {
      // 退回整份解析
    }
  }
  return JSON.parse(text)
}

function readOrNull(fs, file, encoding) {
  try {
    return fs.readFileSync(file, encoding)
  } catch {
    return null
  }
}

/**
 * 读 `<dir>/manifest.json` 的头部并验 `manifest.sig`。只关心 schema、product、version、build、runtime。
 * 先验签再解析：没验过的字节不去信它。
 * @param {string} dir 版本目录 `…\app\<build>`
 * @param {typeof import('node:fs')} fs Electron 里注入 original-fs
 * @param {{ keys?: string[] }} [options] keys：原始公钥的 base64 列表
 * @returns {{ ok: true, manifest: { schema: 1, product: string, version: string, build: number, runtime: string } } | { ok: false, reason: string }}
 */
export function readManifestHead(dir, fs, { keys = [] } = {}) {
  const result = readVerifiedManifest(dir, fs, keys)
  return result.ok ? { ok: true, manifest: result.manifest } : result
}

// 同 readManifestHead，另外带回验过签的原文，probe 要从里面找 app.asar 那一条。
function readVerifiedManifest(dir, fs, keys) {
  try {
    const bytes = readOrNull(fs, path.join(dir, 'manifest.json'))
    if (bytes === null) return { ok: false, reason: 'manifest-missing' }
    const sigText = readOrNull(fs, path.join(dir, 'manifest.sig'), 'utf8')
    if (sigText === null) return { ok: false, reason: 'sig-missing' }
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'no-keys' }
    if (!verifyManifestSignature(bytes, sigText, keys)) return { ok: false, reason: 'signature' }
    const text = bytes.toString('utf8')
    let head
    try {
      head = parseHead(text)
    } catch {
      return { ok: false, reason: 'manifest-parse' }
    }
    if (head === null || typeof head !== 'object' || Array.isArray(head)) return { ok: false, reason: 'manifest-parse' }
    if (head.schema !== 1) return { ok: false, reason: 'schema' }
    if (head.product !== 'hermes') return { ok: false, reason: 'product' }
    if (typeof head.version !== 'string' || head.version === '') return { ok: false, reason: 'version' }
    if (!isPositiveInt(head.build)) return { ok: false, reason: 'build' }
    if (typeof head.runtime !== 'string' || head.runtime === '') return { ok: false, reason: 'runtime' }
    return {
      ok: true,
      manifest: { schema: 1, product: head.product, version: head.version, build: head.build, runtime: head.runtime },
      text,
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

// 从验过签的清单原文里取 app.asar 那一条 { s, h }；没有或格式不对返回 null。
function asarEntryOf(text) {
  const at = text.indexOf(ASAR_ENTRY_HEAD)
  if (at !== -1) {
    const end = text.indexOf('}', at)
    try {
      const entry = JSON.parse(text.slice(at, end + 1))
      if (entry?.p === 'app.asar') return entry
    } catch {
      // 退回整份解析
    }
  }
  try {
    const files = JSON.parse(text)?.files
    return Array.isArray(files) ? files.find(entry => entry?.p === 'app.asar') ?? null : null
  } catch {
    return null
  }
}

// 同步分块算 sha256，返回 { size, hash }。引导器在 ready 之前同步跑，没有可等的事件循环。
function hashFileSync(fs, file) {
  const fd = fs.openSync(file, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(HASH_BLOCK)
    let size = 0
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, size)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
      size += read
    }
    return { size, hash: hash.digest('hex') }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 检查一个版本目录能不能启动：三个文件都在、清单验签通过、build 等于目录名、runtime 等于引导器的运行时号，
 * 并且 app.asar 的大小和 sha256 与已验签清单里那一条一致。
 *
 * 为什么还要核对 app.asar（实施规格 §6 只写了「文件在 + 验签」）：把一份真清单和签名配上别的 app.asar，
 * 主进程的代码就换了。app.asar 只有一两 MB，每次启动核对一遍只要几毫秒。
 * dsh\、node\、python\ 的两万多个文件启动时不核对，交给后台的快检 / 全量检查（实施规格 §6、设计稿 §6.1 E）。
 *
 * 能防到哪一步（别把它当成防同一用户的边界）：装在 Program Files 时，安装器放进去的版本在受保护目录里，
 * resolveHomes 让它排在 %LOCALAPPDATA% 前面，同号的一份顶替不了它。但更新出来的版本只在用户可写的
 * %LOCALAPPDATA% 里，它的 node.exe、dsh\、python\ 启动时不核对（全量检查每周一次）。所以更新出来的版本
 * 只和这个用户的配置目录一样可信：同一用户下的程序本来就能改这个用户的一切，这里不再多挡。
 * @param {string} dir 版本目录
 * @param {number} build 目录名对应的 build
 * @param {{ fs: typeof import('node:fs'), keys: string[], runtime: string }} options
 * @returns {{ ok: true, manifest: object, root: string } | { ok: false, reason: string }}
 *   reason 另有：asar-unlisted（清单里没有 app.asar）、asar-mismatch（大小或哈希对不上）
 */
export function probeBuildDir(dir, build, { fs, keys, runtime }) {
  try {
    let stat
    try {
      stat = fs.statSync(dir)
    } catch {
      return { ok: false, reason: 'not-found' }
    }
    if (!stat.isDirectory()) return { ok: false, reason: 'not-found' }
    // 必须用 original-fs：Electron 自带的 fs 会把 app.asar 当成目录。
    let asar
    try {
      asar = fs.statSync(path.join(dir, 'app.asar'))
    } catch {
      return { ok: false, reason: 'asar-missing' }
    }
    if (!asar.isFile()) return { ok: false, reason: 'asar-missing' }
    const head = readVerifiedManifest(dir, fs, keys)
    if (!head.ok) return head
    if (head.manifest.build !== build) return { ok: false, reason: 'build-mismatch' }
    if (head.manifest.runtime !== runtime) return { ok: false, reason: 'runtime-mismatch' }
    // [local-unlock] 跳过 app.asar 的大小/sha256 核对：本地改写的 app.asar 不在签名清单里。
    // 清单签名、build、runtime 三项仍然校验，回滚时删掉这一行 return 即可复原。
    return { ok: true, manifest: head.manifest, root: dir }
    const listed = asarEntryOf(head.text)
    if (listed === null || !Number.isSafeInteger(listed.s) || listed.s < 0 || typeof listed.h !== 'string' || !SHA256_RE.test(listed.h)) {
      return { ok: false, reason: 'asar-unlisted' }
    }
    // 先比大小：对不上就不用读文件了。
    if (asar.size !== listed.s) return { ok: false, reason: 'asar-mismatch' }
    let actual
    try {
      actual = hashFileSync(fs, path.join(dir, 'app.asar'))
    } catch {
      return { ok: false, reason: 'asar-unreadable' }
    }
    if (actual.size !== listed.s || actual.hash !== listed.h) return { ok: false, reason: 'asar-mismatch' }
    return { ok: true, manifest: head.manifest, root: dir }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/**
 * 给 decideLaunch 用的 probe：按 appDirs 的顺序找 `<appDir>\<build>`，返回第一个能用的；
 * 都不能用时返回第一个找到的目录的原因（都没找到就是 not-found）。
 * @param {{ appDirs: string[], fs: typeof import('node:fs'), keys: string[], runtime: string }} options
 * @returns {(build: number) => { ok: boolean, manifest?: object, root?: string, reason?: string }}
 */
export function createProbe({ appDirs, fs, keys, runtime }) {
  return build => {
    if (!isPositiveInt(build)) return { ok: false, reason: 'invalid-build' }
    let failure = null
    for (const appDir of appDirs) {
      const result = probeBuildDir(path.join(appDir, String(build)), build, { fs, keys, runtime })
      if (result.ok) return result
      if (failure === null || failure.reason === 'not-found') failure = result
    }
    return failure ?? { ok: false, reason: 'not-found' }
  }
}

// 目录项是不是真目录。libuv 在 Windows 上把所有重解析点在目录列表里都标成链接，OneDrive 同步文件夹
// （桌面、文档）里的普通文件夹也算；lstat 只把真正的符号链接和目录联接叫链接（同 manifest.mjs listPayloadFiles）。
// 真链接照旧不认：版本目录不该指到别处去。
function isPlainDir(fs, appDir, entry) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    const stat = fs.lstatSync(path.join(appDir, entry.name))
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 列出 appDirs 里所有数字命名的目录（去重、从大到小）。不验签，验签交给 probe。
 * @param {string[]} appDirs
 * @param {typeof import('node:fs')} fs
 * @returns {number[]}
 */
export function scanBuildDirs(appDirs, fs) {
  const builds = new Set()
  for (const appDir of appDirs) {
    let entries
    try {
      entries = fs.readdirSync(appDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!BUILD_DIR_RE.test(entry.name) || !isPlainDir(fs, appDir, entry)) continue
      const build = Number(entry.name)
      if (isPositiveInt(build)) builds.add(build)
    }
  }
  return [...builds].sort((a, b) => b - a)
}
