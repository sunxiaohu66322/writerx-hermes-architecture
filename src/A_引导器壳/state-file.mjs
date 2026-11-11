// state.json 与 journal.jsonl 的读写（实施规格 §3、§6）。只有引导器写 state.json。
// fs 由调用方注入：Electron 里是 original-fs，测试里是 node:fs。
// Windows 上杀毒软件、索引服务会短暂占住刚写的文件，改名时报 EPERM / EBUSY，所以读写都重试几次。
import path from 'node:path'

/** state.json 的格式版本。 */
export const STATE_SCHEMA = 1
/** journal.jsonl 超过这个大小就滚到 journal.1.jsonl（实施规格 §3）。 */
export const JOURNAL_MAX_BYTES = 1024 * 1024

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRY_DELAYS_MS = [20, 50, 100, 200, 400]

// 引导器在 app ready 之前同步跑完，没有事件循环可等；Atomics.wait 是 Node 里最省事的同步等待。
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // 等不了就不等，直接重试
  }
}

function withRetry(action) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return action()
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !RETRY_CODES.has(error?.code)) throw error
      sleepSync(RETRY_DELAYS_MS[attempt])
    }
  }
}

/**
 * 全新安装、或者 state.json 丢了 / 坏了时的初始状态。
 * @param {string} installRoot
 * @returns {{ schema: 1, installRoot: string, active: null, previous: null, pending: null, bad: [], rollback: null, importFailures: 0 }}
 */
export function emptyState(installRoot) {
  return { schema: STATE_SCHEMA, installRoot, active: null, previous: null, pending: null, bad: [], rollback: null, importFailures: 0 }
}

/**
 * 读 state.json，并说明读到的是什么情况。
 * - `missing`：没有这个文件；
 * - `corrupt`：不是 JSON、不是对象、或者 schema 不是 1。原文件另存一份 `state.json.corrupt` 方便排查；
 * - `error`：重试后仍读不了（被占用、没权限）。
 * 三种情况 state 都是 null，调用方按「没有状态」处理。
 * @param {string} file
 * @param {typeof import('node:fs')} fs
 * @returns {{ state: object | null, status: 'ok' | 'missing' | 'corrupt' | 'error', error?: string }}
 */
export function readStateFile(file, fs) {
  let text
  try {
    text = withRetry(() => fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { state: null, status: 'missing' }
    return { state: null, status: 'error', error: String(error?.code ?? error?.message ?? error) }
  }
  let state = null
  try {
    state = JSON.parse(text)
  } catch {
    state = null
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state) || state.schema !== STATE_SCHEMA) {
    try {
      fs.copyFileSync(file, `${file}.corrupt`)
    } catch {
      // 留不下副本也照常启动
    }
    return { state: null, status: 'corrupt' }
  }
  return { state, status: 'ok' }
}

/**
 * 读 state.json；没有、坏了、读不了都返回 null（坏了的会另存 `.corrupt`）。
 * @param {string} file
 * @param {typeof import('node:fs')} fs
 * @returns {object | null}
 */
export function readState(file, fs) {
  return readStateFile(file, fs).state
}

/**
 * 原子写 state.json：同目录写临时文件、fsync、再改名覆盖。断电时要么是旧的、要么是新的，不会只写一半。
 * 改名遇到 EPERM / EBUSY / EACCES 重试几次；最终失败时删掉临时文件并抛出原错误。
 * @param {string} file
 * @param {object} state
 * @param {typeof import('node:fs')} fs
 */
export function writeStateAtomic(file, state, fs) {
  const text = `${JSON.stringify(state)}\n`
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    withRetry(() => {
      const fd = fs.openSync(tmp, 'w')
      try {
        fs.writeSync(fd, text)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    })
    withRetry(() => fs.renameSync(tmp, file))
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // 临时文件删不掉无妨，下次写会覆盖它
    }
    throw error
  }
}

/**
 * 往 journal.jsonl 追加一行。超过上限先滚到 journal.1.jsonl（覆盖旧的那份）。日志写不了不影响启动，所以不抛出。
 * @param {string} file journal.jsonl 的路径
 * @param {object} entry 一条事件，会原样序列化成一行 JSON
 * @param {typeof import('node:fs')} fs
 * @param {{ maxBytes?: number }} [options]
 * @returns {boolean} 是否写进去了
 */
export function appendJournal(file, entry, fs, { maxBytes = JOURNAL_MAX_BYTES } = {}) {
  try {
    const line = `${JSON.stringify(entry)}\n`
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch {
      size = 0
    }
    if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
      const rolled = path.join(path.dirname(file), `${path.basename(file, '.jsonl')}.1.jsonl`)
      try {
        fs.rmSync(rolled, { force: true })
        fs.renameSync(file, rolled)
      } catch {
        // 滚不动就接着写，宁可超一点也不丢日志
      }
    }
    fs.appendFileSync(file, line)
    return true
  } catch {
    return false
  }
}
