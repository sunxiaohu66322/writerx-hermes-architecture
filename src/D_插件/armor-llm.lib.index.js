/**
 * Armour injection at the LLM request layer.
 *
 * WHY THIS ROW EXISTS
 * `@local/dsh-plugin-pojia` injects through `ctx.systemPrompt.section(...)` — the
 * prompt registry, one layer above the provider call. The product layer
 * (`@writerx/dsh-hermes-app`, `presets/*.patch.yml`) can replace or trim that
 * prompt tree, so this row takes the other road: it hooks the `llm/fetch`
 * waterfall, which the adapter fires immediately before the real `fetch`, and
 * rewrites the provider request body there.
 *
 * THE HOOK (verbatim, engine 0.2.0-rc.2)
 *   @deepseek-ai/dsh-llm-pi-ai/lib/index.js:2706
 *     resolveFetch: (options) => (input, init) => {
 *       const request = { ...init };
 *       return ctx.waterfall("llm/fetch", options, input, request, () => globalThis.fetch(input, request));
 *     }
 *   contract: @deepseek-ai/dsh-llm/lib/typert.host.js:629  ("name": "llm/fetch", "mode": "waterfall")
 *   doc: "Wrap an adapter's request-scoped HTTP fetch without replacing global fetch."
 *
 * It is a documented extension point, already consumed in production by
 * `@writerx/dsh-hub-charge/lib/index.js:446` and
 * `@writerx/dsh-hermes-presets/lib/creation-diagnostics.js:112`.
 *
 * Config (all optional):
 *   file          absolute path of the armour markdown (default: ../armor.md)
 *   marker        idempotency marker (default: [[ARMOR-LLM]])
 *   providers     allowlist of route ids; omitted = every route
 *   skipPurposes  array of options.purpose values to leave untouched
 *   quiet         true = do not log each injection
 *
 * @module @local/dsh-armor-llm
 */

import { fileURLToPath } from 'node:url'
import { appendFileSync } from 'node:fs'
import { MARKER, createArmorSource, transformInitBody, describeInjected } from './armor-core.mjs'

/** Cordis plugin name. */
export const name = 'armor-llm'

/** The LLM seam that fires `llm/fetch`. */
export const inject = ['llm']

const DEFAULT_FILE = fileURLToPath(new URL('../armor.md', import.meta.url))

/**
 * @param ctx the host context carrying `llm` and `logger`
 * @param {{file?: string, marker?: string, providers?: string[], skipPurposes?: string[], quiet?: boolean}} [config]
 */
export function apply(ctx, config = {}) {
  try {
    appendFileSync(`${DEFAULT_FILE}.armed.log`, `${new Date().toISOString()} apply() entered, hook=llm/fetch\n`)
  } catch { /* diagnostics only */ }
  const file = config.file ?? DEFAULT_FILE
  const marker = config.marker ?? MARKER
  const providers = Array.isArray(config.providers) && config.providers.length > 0 ? new Set(config.providers) : undefined
  const skipPurposes = new Set(config.skipPurposes ?? [])

  let armour
  try {
    armour = createArmorSource(file, { marker })
    armour()
  } catch (error) {
    // Fail soft: a missing/unreadable text must never take the Host down.
    ctx.logger?.warn?.(`[armor-llm] cannot read ${file}: ${error.message}; injection disabled`)
    return
  }

  const allowed = (options) => {
    if (providers !== undefined && !providers.has(String(options?.provider ?? ''))) return false
    if (options?.purpose !== undefined && skipPurposes.has(String(options.purpose))) return false
    return true
  }

  ctx.on('llm/fetch', async (options, input, init, next) => {
    if (!allowed(options)) return next()
    try {
      const result = transformInitBody(init, armour(), marker)
      if (result.changed && config.quiet !== true) {
        const head = describeInjected(init.body, 200)
        ctx.logger?.info?.(
          `[armor-llm] injected (${result.kind}) into ${String(options?.provider ?? '?')}/${String(options?.model ?? '?')} :: ${head}`,
        )
      } else if (!result.changed && result.reason !== 'already-injected') {
        ctx.logger?.debug?.(`[armor-llm] skipped: ${result.reason}`)
      }
    } catch (error) {
      ctx.logger?.warn?.(`[armor-llm] injection failed: ${error.message}`)
    }
    return next()
  })

  ctx.logger?.info?.(`[armor-llm] llm/fetch hook armed (text: ${file})`)
}

