/**
 * Autentizace a autorizace pro CDN API.
 *
 * Původní model ověřoval heslo v prohlížeči proti veřejně čitelnému
 * users.json — hashe všech účtů si mohl stáhnout kdokoliv a jediným
 * skutečným zámkem byl sdílený token. Tady se ověření přesouvá na server:
 * users.json ven vůbec nechodí, přihlášení vrací session token uložený v KV
 * a každý endpoint kontroluje oprávnění konkrétního uživatele.
 */

import type { Env } from './index'

/* ── Typy ─────────────────────────────────────────────────────────────────── */

export type Permission = 'upload' | 'delete' | 'edit'
export type Section = 'gallery' | 'museum' | 'rosnik'

export interface UserPermissions {
  gallery: Permission[]
  museum: Permission[]
  rosnik: Permission[]
}

export interface StoredUser {
  username: string
  passwordHash: string
  salt: string
  /** Chybí u účtů založených původním klientem — ty používaly holé SHA-256. */
  algo?: 'pbkdf2' | 'sha256'
  iterations?: number
  role: 'admin' | 'editor'
  permissions: UserPermissions
}

export interface UsersManifest {
  users: StoredUser[]
  updatedAt?: number
}

/** Uživatel tak, jak ho smí vidět klient — bez hashe a soli. */
export interface PublicUser {
  username: string
  role: 'admin' | 'editor'
  permissions: UserPermissions
}

export interface Session {
  username: string
  role: 'admin' | 'editor'
  permissions: UserPermissions
  createdAt: number
}

/* ── Konstanty ────────────────────────────────────────────────────────────── */

const USERS_KEY = 'users.json'

/** Platnost přihlášení. Po vypršení KV záznam zmizí sám. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60

/**
 * Strop, který Workers na PBKDF2 povolují. Ověřeno měřením: 100 000 projde
 * spolehlivě, 100 001 skončí chybou za běhu. Kdyby se konstanta níž zvedla,
 * přestalo by fungovat přihlašování úplně — proto se tvrdě ořízne.
 */
const PBKDF2_MAX_ITERATIONS = 100_000

/** Kolik iterací používáme pro nově ukládaná hesla. */
const PBKDF2_ITERATIONS = Math.min(100_000, PBKDF2_MAX_ITERATIONS)

const FULL_PERMISSIONS: UserPermissions = {
  gallery: ['upload', 'delete', 'edit'],
  museum: ['upload', 'delete', 'edit'],
  rosnik: ['upload', 'delete', 'edit'],
}

/* ── Pomocné ──────────────────────────────────────────────────────────────── */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Porovnání v konstantním čase — nesmí prozradit, kde se řetězce rozešly. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/* ── Hashování hesel ──────────────────────────────────────────────────────── */

async function sha256Hash(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + password)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

async function pbkdf2Hash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  )
  return toHex(bits)
}

/** Zahashuje heslo pro uložení. Vždy PBKDF2 s novou solí. */
export async function hashPassword(password: string): Promise<{
  passwordHash: string
  salt: string
  algo: 'pbkdf2'
  iterations: number
}> {
  const salt = randomHex(32)
  const passwordHash = await pbkdf2Hash(password, salt, PBKDF2_ITERATIONS)
  return { passwordHash, salt, algo: 'pbkdf2', iterations: PBKDF2_ITERATIONS }
}

/**
 * Ověří heslo proti uloženému záznamu. Zvládne i staré SHA-256 účty, aby
 * migrace nikoho nevyzamkla — `needsRehash` pak řekne, že je čas je převést.
 */
export async function verifyPassword(
  password: string,
  user: StoredUser,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (user.algo === 'pbkdf2') {
    // Ořez chrání i proti záznamu s příliš vysokým počtem iterací —
    // takový hash by se nedal ověřit a účet by zůstal navždy zamčený.
    const iterations = Math.min(user.iterations ?? PBKDF2_ITERATIONS, PBKDF2_MAX_ITERATIONS)
    const hash = await pbkdf2Hash(password, user.salt, iterations)
    return {
      valid: safeEqual(hash, user.passwordHash),
      needsRehash: iterations !== PBKDF2_ITERATIONS,
    }
  }

  const legacy = await sha256Hash(password, user.salt)
  return { valid: safeEqual(legacy, user.passwordHash), needsRehash: true }
}

/* ── Uložení uživatelů ────────────────────────────────────────────────────── */

export async function loadUsers(env: Env): Promise<UsersManifest> {
  const object = await env.CDN.get(USERS_KEY)
  if (object === null) return { users: [] }
  try {
    const data = await object.json<UsersManifest>()
    if (data && Array.isArray(data.users)) return data
  } catch {
    /* poškozený soubor bereme jako prázdný, ať se dá účet založit znovu */
  }
  return { users: [] }
}

export async function saveUsers(env: Env, manifest: UsersManifest): Promise<void> {
  const stamped = { ...manifest, updatedAt: Date.now() }
  await env.CDN.put(USERS_KEY, JSON.stringify(stamped, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-store, private',
    },
  })
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    username: user.username,
    role: user.role,
    permissions: user.role === 'admin' ? FULL_PERMISSIONS : user.permissions,
  }
}

/* ── Session ──────────────────────────────────────────────────────────────── */

function sessionKey(token: string): string {
  return `sess:${token}`
}

export async function createSession(env: Env, user: StoredUser): Promise<{
  token: string
  expiresAt: number
}> {
  const token = randomHex(32)
  const session: Session = {
    username: user.username,
    role: user.role,
    permissions: user.role === 'admin' ? FULL_PERMISSIONS : user.permissions,
    createdAt: Date.now(),
  }
  await env.RATE_LIMIT.put(sessionKey(token), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  return { token, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 }
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.RATE_LIMIT.delete(sessionKey(token))
}

/**
 * Zjistí, kdo request posílá.
 *
 * Přijímá session token z přihlášení, nebo sdílený ADMIN_TOKEN jako záložní
 * cestu pro případ, že by se KV nebo přihlášení rozbilo. Ten je od migrace
 * uložený jako secret Workeru, ne ve veřejném souboru.
 */
export async function resolveSession(req: Request, env: Env): Promise<Session | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  const token = (bearer ? bearer[1] : req.headers.get('X-Api-Key') ?? '').trim()
  if (!token) return null

  if (env.ADMIN_TOKEN && safeEqual(env.ADMIN_TOKEN, token)) {
    return {
      username: 'admin-token',
      role: 'admin',
      permissions: FULL_PERMISSIONS,
      createdAt: Date.now(),
    }
  }

  const raw = await env.RATE_LIMIT.get(sessionKey(token))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

/* ── Oprávnění ────────────────────────────────────────────────────────────── */

export function hasPermission(
  session: Session,
  section: Section,
  permission: Permission,
): boolean {
  if (session.role === 'admin') return true
  return session.permissions?.[section]?.includes(permission) ?? false
}

/**
 * Přiřadí cestu v R2 sekci oprávnění.
 *
 * Adpan gatuje gear, graphics, site, pricelist i services právy pro galerii,
 * takže to tady musí sedět stejně — jinak by editoři přišli o přístup,
 * který dnes mají.
 */
export function sectionForPath(path: string): Section | 'admin-only' {
  const top = path.split('/')[0]
  switch (top) {
    case 'gallery':
    case 'gear':
    case 'graphics':
    case 'site':
    case 'services':
    case 'pricelist':
      return 'gallery'
    case 'museum':
      return 'museum'
    case 'rosnik':
      return 'rosnik'
    default:
      return 'admin-only'
  }
}

/** Totéž pro typy manifestů ukládaných přes /api/manifest. */
export function sectionForManifest(type: string): Section | 'admin-only' {
  switch (type) {
    case 'gallery':
    case 'gear':
    case 'services':
    case 'pricelist':
    case 'graphics':
      return 'gallery'
    case 'museum':
      return 'museum'
    case 'rosnik':
      return 'rosnik'
    // site a faq mění texty na celém webu — jen pro adminy
    default:
      return 'admin-only'
  }
}

/* ── Omezení počtu pokusů o přihlášení ────────────────────────────────────── */

const LOGIN_MAX_ATTEMPTS = 8
const LOGIN_WINDOW_SECONDS = 15 * 60

/**
 * Počítá neúspěšné pokusy podle IP. Původní verze držela počítadlo
 * v sessionStorage prohlížeče, takže stačilo otevřít anonymní okno.
 */
export async function checkLoginRateLimit(env: Env, ip: string): Promise<boolean> {
  const raw = await env.RATE_LIMIT.get(`login:${ip}`)
  return (raw ? parseInt(raw, 10) : 0) < LOGIN_MAX_ATTEMPTS
}

export async function recordFailedLogin(env: Env, ip: string): Promise<void> {
  const key = `login:${ip}`
  const raw = await env.RATE_LIMIT.get(key)
  const count = (raw ? parseInt(raw, 10) : 0) + 1
  await env.RATE_LIMIT.put(key, String(count), { expirationTtl: LOGIN_WINDOW_SECONDS })
}

export async function clearLoginAttempts(env: Env, ip: string): Promise<void> {
  await env.RATE_LIMIT.delete(`login:${ip}`)
}

export { FULL_PERMISSIONS }
