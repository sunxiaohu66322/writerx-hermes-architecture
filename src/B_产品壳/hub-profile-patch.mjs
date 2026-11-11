/**
 * The product profile's `cordis.patch.yml` as the desktop shell's settings
 * document (harness 0.1.7 model: volatile Config fields persist as per-row
 * `config` overrides here; `$DSH_HOME/settings.yaml` is legacy, imported once
 * by the engine and renamed). Pure Node + js-yaml; unit-testable without the
 * engine.
 *
 * The file is a top-level YAML sequence of Loader patch entries. Writes only
 * ever touch the plain override entries (`- id: <row>  config: {...}`) this
 * module maintains; `!!js` scalars (allowed by the Loader dialect) round-trip
 * through a local custom tag so a hand-written entry is never mangled.
 * @module apps/desktop/src/hub/profile-patch
 */
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

/** A `!!js` expression scalar, kept verbatim across load/dump. */
class JsExpression {
  constructor(code) { this.code = code }
}
const JS_EXPRESSION = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: code => new JsExpression(code),
  instanceOf: JsExpression,
  represent: value => value.code,
})
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend([JS_EXPRESSION])

/** The profile patch path for the product profile. */
export function profilePatchPath(dshHome, profile = 'hermes') {
  return join(dshHome, 'profiles', profile, 'cordis.patch.yml')
}

/** Read the patch as a plain array; an absent file reads as empty. */
export async function readProfilePatch(patchPath) {
  if (!existsSync(patchPath)) return []
  const doc = yaml.load(await readFile(patchPath, 'utf8'), { schema: PATCH_SCHEMA })
  if (doc === null || doc === undefined) return []
  if (!Array.isArray(doc)) throw new Error(`profile patch is not a YAML sequence: ${patchPath}`)
  return doc
}

/** Synchronous variant of {@link readProfilePatch} for the Electron boot path. */
export function readProfilePatchSync(patchPath) {
  if (!existsSync(patchPath)) return []
  const doc = yaml.load(readFileSync(patchPath, 'utf8'), { schema: PATCH_SCHEMA })
  if (doc === null || doc === undefined) return []
  if (!Array.isArray(doc)) throw new Error(`profile patch is not a YAML sequence: ${patchPath}`)
  return doc
}

/** One row's override config from the patch, sync, `undefined` when absent. */
export function profileRowConfigSync(patchPath, rowId) {
  const row = readProfilePatchSync(patchPath)
    .find(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.id === rowId)
  const config = row?.config
  return config !== null && typeof config === 'object' && !Array.isArray(config) ? config : undefined
}

/** The opening's settings row: its `mode` override is the 开场动画 setting (设置 → 外观). */
const OPENING_ROW = 'writerx-opening'
/** full: the whole 千字归一 intro; brief: straight to the composed scene; off: a still screen. */
export const OPENING_MODES = Object.freeze(['full', 'brief', 'off'])

/** The 开场动画 setting, sync for the shell's first paint: full unless the author chose otherwise. */
export function openingModeSync(patchPath) {
  const mode = profileRowConfigSync(patchPath, OPENING_ROW)?.mode
  return OPENING_MODES.includes(mode) ? mode : 'full'
}

async function writeProfilePatch(patchPath, rows) {
  if (existsSync(patchPath)) await copyFile(patchPath, `${patchPath}.bak-${Date.now()}`)
  // First launch reaches this before the engine has created the profile dir.
  await mkdir(dirname(patchPath), { recursive: true })
  await writeFile(patchPath, yaml.dump(rows, { schema: PATCH_SCHEMA, lineWidth: -1 }))
}

/**
 * Merge `fields` into the override config of row `rowId`, creating the
 * override entry when absent. Only the named top-level keys of that override
 * change; its sibling keys stay untouched. The engine applies an override as
 * the row's WHOLE config (it does not merge with the bundle's layer beneath),
 * so a row whose bundle layer carries config needs every key it still wants
 * restated here (the app's own rows either carry none there or set all of it).
 * @returns {Promise<void>}
 */
export async function upsertProfileRowConfig(patchPath, rowId, fields) {
  const rows = await readProfilePatch(patchPath)
  let row = rows.find(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.id === rowId)
  if (row === undefined) {
    row = { id: rowId, config: {} }
    rows.push(row)
  }
  const config = row.config !== undefined && typeof row.config === 'object' && !Array.isArray(row.config)
    ? { ...row.config } : {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete config[key]
    else config[key] = value
  }
  row.config = config
  await writeProfilePatch(patchPath, rows)
}

/** The theme plugin's row: its `preference` override is the in-app 外观 setting (light / dark / system). */
const THEME_ROW = 'ui-theme'
/** What a new install starts on. The engine's own default is `system`. */
export const NEW_INSTALL_THEME = 'dark'

/**
 * Start a new install on the dark theme: write the theme row's `preference`
 * the way the in-app 外观 setting would. Call it only for a home that has never
 * finished a launch. It still writes nothing when a preference is already
 * there, or when the home carries a pre-profile `settings.yaml` (someone's
 * settings from an older version, imported by the engine — not a new install).
 * Picking 浅色 or 跟随系统 afterwards is an ordinary setting change; nothing
 * re-applies this.
 * @param {string} dshHome - the product's DSH_HOME.
 * @param {string} [profile] - profile name.
 * @returns {Promise<boolean>} whether the preference was written.
 */
export async function seedNewInstallTheme(dshHome, profile = 'hermes') {
  if (existsSync(join(dshHome, 'settings.yaml'))) return false
  const patchPath = profilePatchPath(dshHome, profile)
  if (profileRowConfigSync(patchPath, THEME_ROW)?.preference !== undefined) return false
  await upsertProfileRowConfig(patchPath, THEME_ROW, { preference: NEW_INSTALL_THEME })
  return true
}

/** The model-adapter row whose legacy section carries the author's own providers. */
const MODEL_ADAPTERS_ROW = 'writerx-model-adapters'
/** Same key as hub-api's HUB_ROUTE (that module imports this one). */
const HUB_PROVIDER = 'hub'

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The legacy model-adapter section as the 0.1.7 importer may take it. The Hub
 * provider is desktop-owned and already rewritten from the live catalog before
 * the engine boots — a legacy copy would replace that model list with a stale
 * one the catalog fingerprint then never repairs. A 0.5.0 `none` reasoning key
 * fails the row schema, and the importer drops the whole section with it, the
 * author's own providers included; `none` becomes `off` as 0.5.1 repaired it.
 * @returns {{ section: unknown, changed: boolean }}
 */
function sanitizeLegacyModelAdapters(section) {
  if (!isPlainObject(section) || !isPlainObject(section.providers)) return { section, changed: false }
  let changed = false
  const providers = {}
  for (const [id, provider] of Object.entries(section.providers)) {
    if (id === HUB_PROVIDER) { changed = true; continue }
    if (!isPlainObject(provider) || !Array.isArray(provider.models)) { providers[id] = provider; continue }
    const models = provider.models.map((model) => {
      if (!isPlainObject(model) || !isPlainObject(model.reasoningEfforts) || !Object.hasOwn(model.reasoningEfforts, 'none')) return model
      changed = true
      const { none, ...efforts } = model.reasoningEfforts
      return { ...model, reasoningEfforts: Object.hasOwn(efforts, 'off') ? efforts : { off: none, ...efforts } }
    })
    providers[id] = { ...provider, models }
  }
  return changed ? { section: { ...section, providers }, changed } : { section, changed }
}

/**
 * One-time legacy bridge: the engine's own importer drops settings.yaml
 * sections whose owning row was renamed by the product. Rename those section
 * keys in place (target key already present wins), before the engine's first
 * 0.1.7 boot imports and renames the document. The model-adapter section is
 * sanitized in the same pass (see {@link sanitizeLegacyModelAdapters}).
 * @returns {Promise<string[]>} the changes made, for logging.
 */
export async function bridgeLegacySettingsSections(dshHome, renames) {
  const settingsPath = join(dshHome, 'settings.yaml')
  if (!existsSync(settingsPath)) return []
  const settings = yaml.load(await readFile(settingsPath, 'utf8'))
  if (!isPlainObject(settings)) return []
  const changes = []
  for (const [from, to] of Object.entries(renames)) {
    if (settings[from] === undefined || settings[to] !== undefined) continue
    settings[to] = settings[from]
    delete settings[from]
    changes.push(`${from} → ${to}`)
  }
  const adapters = sanitizeLegacyModelAdapters(settings[MODEL_ADAPTERS_ROW])
  if (adapters.changed) {
    settings[MODEL_ADAPTERS_ROW] = adapters.section
    changes.push(`${MODEL_ADAPTERS_ROW}: Hub provider left to catalog sync, legacy reasoning keys repaired`)
  }
  if (changes.length === 0) return []
  await rename(settingsPath, `${settingsPath}.bak-${Date.now()}`)
  await writeFile(settingsPath, yaml.dump(settings, { lineWidth: -1 }))
  return changes
}

/**
 * One-shot recovery on the first boot after the legacy document was imported
 * and renamed (the `.imported` file stays as the backup record):
 * - a boot that died between the importer's rename and its per-section writes
 *   left sections that never reached the profile patch — re-inject exactly the
 *   missing rows (a row already in the patch wins), product renames applied;
 * - a build that imported an unsanitized model-adapter section lost the
 *   author's own providers while the Hub sync had already created the row —
 *   merge the providers missing from that row.
 * A stranded import can only follow the engine's first 0.1.7 boot, so the
 * marker ends recovery after one run: a row or provider the author (or a reset
 * to default) removes later is never brought back from the legacy copy.
 * @returns {Promise<string[]>} the row ids (or row.providers.id) recovered, for logging.
 */
export async function recoverStrandedSettingsImport(dshHome, renames = {}, profile = 'hermes') {
  const importedPath = join(dshHome, 'settings.yaml.imported')
  const marker = `${importedPath}.recovered`
  if (!existsSync(importedPath) || existsSync(marker) || existsSync(join(dshHome, 'settings.yaml'))) return []
  const settings = yaml.load(await readFile(importedPath, 'utf8'))
  const patchPath = profilePatchPath(dshHome, profile)
  const recovered = []
  if (isPlainObject(settings)) {
    const rows = await readProfilePatch(patchPath)
    const present = new Set(rows.map(row => isPlainObject(row) ? row.id : undefined))
    for (const [section, raw] of Object.entries(settings)) {
      if (!isPlainObject(raw)) continue
      const rowId = renames[section] ?? section
      const values = rowId === MODEL_ADAPTERS_ROW ? sanitizeLegacyModelAdapters(raw).section : raw
      if (!present.has(rowId)) {
        await upsertProfileRowConfig(patchPath, rowId, values)
        present.add(rowId)
        recovered.push(rowId)
        continue
      }
      if (rowId !== MODEL_ADAPTERS_ROW || !isPlainObject(values.providers)) continue
      const current = profileRowConfigSync(patchPath, rowId)?.providers
      const providers = isPlainObject(current) ? { ...current } : {}
      const missing = Object.keys(values.providers).filter(id => !Object.hasOwn(providers, id))
      if (missing.length === 0) continue
      for (const id of missing) providers[id] = values.providers[id]
      await upsertProfileRowConfig(patchPath, rowId, { providers })
      recovered.push(...missing.map(id => `${rowId}.providers.${id}`))
    }
  }
  await writeFile(marker, `${JSON.stringify({ recovered, at: new Date().toISOString() })}\n`, 'utf8')
  return recovered
}
