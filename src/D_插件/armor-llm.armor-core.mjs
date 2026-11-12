/**
 * Transport-agnostic armour injection.
 *
 * Both delivery paths share this module, so the cordis `llm/fetch` hook and the
 * fallback loopback proxy produce byte-identical request bodies:
 *   - lib/index.js  -> mutates `init.body` inside the `llm/fetch` waterfall
 *   - proxy.mjs     -> rewrites the HTTP body before forwarding upstream
 *
 * The armour text is never rewritten here; it is copied verbatim (only the
 * idempotency marker is prepended once).
 *
 * @module @local/dsh-armor-llm/armor-core
 */

import { readFileSync, statSync } from 'node:fs'

/** Idempotency marker. A body that already carries it is never injected twice. */
export const MARKER = '[[ARMOR-LLM]]'

/**
 * Read the armour text from disk.
 * @param {string} file absolute path of the armour markdown
 * @returns {string}
 */
export function readArmorText(file) {
  return readFileSync(file, 'utf8')
}

/**
 * Cached reader that re-reads when the file's mtime/size changes, so the owner
 * can edit armor.md and have the next request pick it up without a restart.
 * @param {string} file
 * @param {{marker?: string}} [options]
 */
export function createArmorSource(file, options = {}) {
  const marker = options.marker ?? MARKER
  let cached = { text: '', stamp: '' }
  return function current() {
    const st = statSync(file)
    const stamp = `${st.mtimeMs}:${st.size}`
    if (stamp !== cached.stamp) {
      let text = readFileSync(file, 'utf8')
      if (!text.includes(marker)) text = `${marker}\n${text}`
      cached = { text, stamp }
    }
    return cached.text
  }
}

/** True when any message/system field of a parsed body already carries the marker. */
export function bodyHasMarker(body, marker = MARKER) {
  if (body === null || typeof body !== 'object') return false
  const probe = (value) => typeof value === 'string' && value.includes(marker)
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (probe(message?.content)) return true
      if (Array.isArray(message?.content) && message.content.some((part) => probe(part?.text))) return true
    }
  }
  if (probe(body.system) || probe(body.instructions)) return true
  return false
}

/**
 * Inject the armour into a parsed request body.
 *
 * Handles the three shapes that actually reach a provider:
 *   - `{ messages: [...] }`            OpenAI chat completions / pi-ai chat
 *   - `{ system: "..." | [...] }`      Anthropic messages (system is out-of-band)
 *   - `{ instructions: "..." }`        OpenAI responses
 *
 * @param {object} body parsed JSON request body (mutated in place when changed)
 * @param {string} armourText text including the marker
 * @param {string} [marker]
 * @returns {{changed: boolean, kind: string, reason?: string}}
 */
export function injectIntoBody(body, armourText, marker = MARKER) {
  if (body === null || typeof body !== 'object') return { changed: false, kind: 'none', reason: 'not-an-object' }
  if (bodyHasMarker(body, marker)) return { changed: false, kind: 'none', reason: 'already-injected' }

  // Out-of-band system fields win over `messages`: an Anthropic body carries both,
  // and a `role:"system"` message inside `messages` is not valid there.
  if (typeof body.instructions === 'string') {
    body.instructions = `${armourText}\n\n${body.instructions}`
    return { changed: true, kind: 'instructions' }
  }

  if (typeof body.system === 'string') {
    body.system = `${armourText}\n\n${body.system}`
    return { changed: true, kind: 'system-string' }
  }

  if (Array.isArray(body.system)) {
    body.system.unshift({ type: 'text', text: armourText })
    return { changed: true, kind: 'system-blocks' }
  }

  if (Array.isArray(body.messages)) {
    body.messages.unshift({ role: 'system', content: armourText })
    return { changed: true, kind: 'messages' }
  }

  return { changed: false, kind: 'none', reason: 'no-injectable-field' }
}

/**
 * Inject into a raw JSON string.
 * @returns {{body: string, changed: boolean, kind: string, reason?: string}}
 */
export function injectIntoJsonText(raw, armourText, marker = MARKER) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { body: raw, changed: false, kind: 'none', reason: 'not-json' }
  }
  const result = injectIntoBody(parsed, armourText, marker)
  if (!result.changed) return { body: raw, changed: false, ...result }
  return { body: JSON.stringify(parsed), changed: true, kind: result.kind }
}

/**
 * Inject into a `RequestInit`-shaped object as handed to `fetch` by the adapter.
 * `init.body` is a request-local mutable copy (see the `llm/fetch` contract), so
 * it is rewritten in place and string bodies stay strings.
 *
 * Streams, FormData and URLSearchParams are deliberately left untouched.
 *
 * @param {{body?: unknown}} init
 * @param {string} armourText
 * @param {string} [marker]
 */
export function transformInitBody(init, armourText, marker = MARKER) {
  const body = init?.body
  if (typeof body === 'string') {
    const result = injectIntoJsonText(body, armourText, marker)
    if (result.changed) init.body = result.body
    return result
  }
  if (body instanceof Uint8Array) {
    const decoder = new TextDecoder()
    const result = injectIntoJsonText(decoder.decode(body), armourText, marker)
    if (result.changed) init.body = new TextEncoder().encode(result.body)
    return result
  }
  if (body === undefined || body === null) return { changed: false, kind: 'none', reason: 'no-body' }
  return { changed: false, kind: 'none', reason: 'unsupported-body-type' }
}

/**
 * Short, log-safe proof of what the provider will see.
 * @returns {string}
 */
export function describeInjected(body, limit = 200) {
  let messages
  try {
    messages = typeof body === 'string' ? JSON.parse(body).messages : body?.messages
  } catch {
    return ''
  }
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const first = messages[0]
  const text = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content ?? '')
  return `${first?.role}: ${text.slice(0, limit)}`
}
