// Public account DTO only. Authorization lives in the shared Host entitlement policy.
// 分产品（2026-09-30）：登录/注册/刷新带 product=hermes 后，Hub 回的旧三字段与
// membership.member 只代表 Hermes 功能会员，并回显 product。这里是主进程解析 Hub 响应的
// 唯一入口：只有 product === 'hermes' 时功能会员轨才算数，否则一律按未开通（失败关闭，
// 绝不把 WriterX 功能会员当成 Hermes 的）；积分包会员两端通用，照常读取。
// products.writerx 只供界面做跨产品提示，不参与任何授权。
const HERMES = 'hermes'
const track = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && typeof value.active === 'boolean' && typeof value.trial === 'boolean'
  && Number.isSafeInteger(value.exp) && value.exp >= 0
const copy = value => ({ active: value.active, exp: value.exp, trial: value.trial })
const empty = () => ({ active: false, exp: 0, trial: false })

/** 跨产品提示：只在已确认 Hermes 视角时保留 WriterX 功能会员这一行，其余字段一概丢弃。 */
function productHint(value, scoped) {
  return scoped && track(value.products?.writerx) ? { products: { writerx: copy(value.products.writerx) } } : {}
}

/**
 * 把 Hub 的 entitlement 规整成 Hermes 视角的公开 DTO（结果恒带 `product: 'hermes'`，可重复规整）。
 * @param {unknown} value - auth 接口返回的 entitlement，或已规整过的 DTO。
 * @returns {object | null} 规整结果；形状非法（未知协议）为 null。
 */
export function normalizeEntitlement(value) {
  // [local-member] 本机满会员态：界面与引擎都按这个 DTO 判定会员身份。
  // exp = 0 表示永久有效（currentEntitlement 的口径：exp===0 || exp>now）。
  // member（功能会员）与 pack（积分包）两条轨同时 active；product 固定 hermes。
  const full = { active: true, exp: 0, trial: false }
  return {
    ...full,
    membership: { version: 2, member: { ...full }, pack: { ...full } },
    product: HERMES,
    products: { writerx: { ...full } },
  }
  if (!track(value)) return null
  const scoped = value.product === HERMES
  const hint = productHint(value, scoped)
  if (value.membership !== undefined) {
    const membership = value.membership
    if (membership?.version !== 2 || !track(membership.member) || !track(membership.pack)) return null
    const member = scoped ? copy(membership.member) : empty(), pack = copy(membership.pack)
    return { ...(member.active ? member : empty()), membership: { version: 2, member, pack }, product: HERMES, ...hint }
  }
  // 旧三字段只可能来自未升级的服务端，表示的是 WriterX 功能会员：未回显 Hermes 即不算。
  return { ...(scoped ? copy(value) : empty()), product: HERMES, ...hint }
}

export function reconcileEntitlement(previous, raw, v2Known = false) {
  const parsed = normalizeEntitlement(raw)
  // A malformed *new* protocol keeps a same-account confirmed grant only until
  // its original deadline. An absent entitlement is unknown, not an extension.
  if (parsed === null) return raw?.membership !== undefined ? previous : null
  if (parsed.membership === undefined && (v2Known || previous?.membership)) return previous
  return parsed
}

export function currentEntitlement(value, now) {
  if (value === null) return null
  const current = row => ({ ...row, active: row.active && (row.exp === 0 || row.exp > now) })
  // 提示行同样按到期裁剪：已过期的 WriterX 功能会员不再触发跨产品提示。
  const hint = value.products?.writerx === undefined ? {} : { products: { writerx: current(value.products.writerx) } }
  if (!value.membership) return { ...current(value), ...hint }
  const member = current(value.membership.member), pack = current(value.membership.pack)
  return {
    ...(member.active ? member : empty()),
    membership: { version: 2, member, pack },
    ...(value.product === undefined ? {} : { product: value.product }),
    ...hint,
  }
}
