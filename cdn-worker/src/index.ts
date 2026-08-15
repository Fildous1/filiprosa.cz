/**
 * cdn.filiprosa.cz — Cloudflare Worker + R2
 *
 * Nahrazuje původní PHP CDN na Wedosu. URL struktura je záměrně 1:1 stejná,
 * takže lib/cdn.ts a lib/cdn-api.ts na webu není potřeba měnit.
 *
 *   GET  /                      → index.html z R2
 *   GET  /gallery/<album>/x.jpg → objekt z R2
 *   GET  /gallery.json          → manifest z R2 (no-cache)
 *   POST /api/upload            → multipart FormData { files[], path }
 *   POST /api/manifest          → { type, data }
 *   POST /api/delete            → { path }
 *   POST /api/save-users        → { users: [...] }
 *   POST /api/contact           → { name, email, message, locale }  (Resend)
 *
 * Admin endpointy vyžadují `Authorization: Bearer <token>` nebo `X-Api-Key`.
 */

import {
  type Session,
  type StoredUser,
  type UserPermissions,
  checkLoginRateLimit,
  clearLoginAttempts,
  createSession,
  destroySession,
  hashPassword,
  hasPermission,
  loadUsers,
  recordFailedLogin,
  resolveSession,
  saveUsers,
  sectionForManifest,
  sectionForPath,
  toPublicUser,
  verifyPassword,
  FULL_PERMISSIONS,
} from './auth'

export interface Env {
  CDN: R2Bucket
  ADMIN_TOKEN: string
  RESEND_API_KEY: string
  CONTACT_TO: string
  CONTACT_FROM: string
  RATE_LIMIT: KVNamespace
}

/* ── Konfigurace (zrcadlí původní api/config.php) ─────────────────────────── */

const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg',
  'pdf', 'zip', 'psd', 'ai',
]

const ALLOWED_MANIFEST_TYPES = [
  'gallery', 'museum', 'rosnik', 'gear', 'services',
  'site', 'pricelist', 'graphics', 'faq',
]

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50 MB

const PUBLIC_ORIGIN = 'https://cdn.filiprosa.cz/'

/* ── MIME typy ────────────────────────────────────────────────────────────── */

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', zip: 'application/zip',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript',
  woff2: 'font/woff2', woff: 'font/woff',
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function contentTypeFor(key: string): string {
  return MIME[extOf(key)] ?? 'application/octet-stream'
}

/* ── CORS ─────────────────────────────────────────────────────────────────── */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
  'Access-Control-Max-Age': '86400',
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS,
      ...extra,
    },
  })
}

/* ── Autentizace ──────────────────────────────────────────────────────────── */

/** Odpověď pro nepřihlášené — nerozlišuje chybějící a neplatný token. */
function unauthorized(): Response {
  return json({ error: 'Not authenticated' }, 401)
}

function forbidden(detail = 'Insufficient permissions'): Response {
  return json({ error: detail }, 403)
}

/* ── Cesty ────────────────────────────────────────────────────────────────── */

/**
 * Převede uživatelem zadanou cestu na bezpečný R2 klíč.
 * Blokuje traversal (`..`), absolutní cesty, `api/` prefix a skryté soubory.
 * Vrací `null` když je cesta nepřípustná.
 */
function safeKey(input: string): string | null {
  let p = input.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!p) return null

  const segments = p.split('/').filter(s => s !== '' && s !== '.')
  if (segments.some(s => s === '..' || s.startsWith('.'))) return null

  p = segments.join('/')
  if (!p) return null

  // /api/* jsou endpointy Workeru, ne objekty — nikdy z/do R2
  if (p === 'api' || p.startsWith('api/')) return null

  // .php zbytky ze starého hostingu do R2 nepatří
  if (p.toLowerCase().endsWith('.php')) return null

  return p
}

/**
 * Soubory, které se nikdy nesmí vydat ven přes GET.
 *
 * users.json nese hashe hesel a rozpis oprávnění. Dřív si ho stahoval
 * přihlašovací formulář v prohlížeči; teď hesla ověřuje Worker a klient
 * dostává jen očištěný seznam přes /api/users.
 */
function isPrivateKey(key: string): boolean {
  return key === 'users.json'
}

/** Očistí název souboru stejně jako původní upload.php. */
function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/* ── GET / HEAD — servírování z R2 ────────────────────────────────────────── */

function cacheControlFor(key: string): string {
  const ext = extOf(key)
  // Manifesty se mění při každé editaci v adpanu — nesmí se cachovat
  if (ext === 'json') return 'no-cache, no-store, must-revalidate'
  if (ext === 'html') return 'no-cache'
  // Obrázky mají stabilní jména; adpan navíc přidává ?v=<timestamp>
  return 'public, max-age=31536000'
}

async function serveObject(req: Request, env: Env, url: URL): Promise<Response> {
  let path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  if (path === '' || path.endsWith('/')) path += 'index.html'

  const key = safeKey(path)
  if (!key || isPrivateKey(key)) return json({ error: 'Not found' }, 404)

  // HEAD nepotřebuje tělo — head() nestahuje objekt z R2
  if (req.method === 'HEAD') {
    const meta = await env.CDN.head(key)
    if (meta === null) return json({ error: 'Not found' }, 404)
    const h = new Headers(CORS)
    meta.writeHttpMetadata(h)
    h.set('etag', meta.httpEtag)
    h.set('Cache-Control', cacheControlFor(key))
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('Content-Length', String(meta.size))
    if (!h.has('Content-Type')) h.set('Content-Type', contentTypeFor(key))
    return new Response(null, { status: 200, headers: h })
  }

  // Podmíněné požadavky a Range (velká PDF v /rosnik/) řeší přímo R2
  const range = req.headers.get('Range')
  const object = await env.CDN.get(key, {
    range: range ? req.headers : undefined,
    onlyIf: req.headers,
  })

  if (object === null) return json({ error: 'Not found' }, 404)

  const headers = new Headers(CORS)
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Cache-Control', cacheControlFor(key))
  headers.set('X-Content-Type-Options', 'nosniff')
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentTypeFor(key))

  // Bez těla → podmínka v onlyIf neprošla, obsah je u klienta aktuální
  if (!('body' in object) || object.body === null) {
    return new Response(null, { status: 304, headers })
  }

  // 206 jen když si o rozsah řekl klient — R2 vyplní `range` i u plného objektu
  if (range && object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0
    const length = object.range.length ?? object.size - offset
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    return new Response(object.body, { status: 206, headers })
  }

  return new Response(object.body, { status: 200, headers })
}

/* ── POST /api/upload ─────────────────────────────────────────────────────── */

async function handleUpload(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
): Promise<Response> {
  const form = await req.formData()

  const destination = String(form.get('path') ?? '')
  if (!destination) return json({ error: 'Missing "path" parameter' }, 400)

  const destKey = safeKey(destination)
  if (!destKey || isPrivateKey(destKey)) return json({ error: 'Invalid path' }, 400)

  const section = sectionForPath(destKey)
  if (section === 'admin-only') {
    if (session.role !== 'admin') return forbidden('Only admins can upload here')
  } else if (!hasPermission(session, section, 'upload')) {
    return forbidden(`No upload permission for ${section}`)
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) return json({ error: 'No files uploaded' }, 400)

  const urls: string[] = []
  const errors: string[] = []

  for (const file of files) {
    if (file.size > MAX_UPLOAD_SIZE) {
      errors.push(`${file.name} exceeds maximum upload size`)
      continue
    }

    const ext = extOf(file.name)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errors.push(`${file.name}: file type .${ext} not allowed`)
      continue
    }

    const key = `${destKey}/${safeFilename(file.name)}`

    try {
      await env.CDN.put(key, file.stream(), {
        httpMetadata: {
          contentType: file.type || contentTypeFor(key),
          cacheControl: cacheControlFor(key),
        },
      })
      urls.push(PUBLIC_ORIGIN + key)
      // Přepsaný soubor by jinak zůstal v edge cache pod starým obsahem
      ctx.waitUntil(caches.default.delete(PUBLIC_ORIGIN + key))
    } catch (e) {
      errors.push(`Failed to save ${file.name}: ${(e as Error).message}`)
    }
  }

  const body: Record<string, unknown> = { success: errors.length === 0, urls }
  if (errors.length > 0) body.errors = errors
  return json(body)
}

/* ── POST /api/manifest ───────────────────────────────────────────────────── */

async function handleManifest(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
): Promise<Response> {
  let input: { type?: string; data?: unknown }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const type = input.type ?? ''
  if (!ALLOWED_MANIFEST_TYPES.includes(type)) {
    return json({ error: `Invalid manifest type. Allowed: ${ALLOWED_MANIFEST_TYPES.join(', ')}` }, 400)
  }
  if (input.data === null || input.data === undefined) {
    return json({ error: 'Missing "data" field' }, 400)
  }

  const section = sectionForManifest(type)
  if (section === 'admin-only') {
    if (session.role !== 'admin') return forbidden(`Only admins can edit the ${type} manifest`)
  } else if (!hasPermission(session, section, 'edit')) {
    return forbidden(`No edit permission for ${section}`)
  }

  const key = `${type}.json`
  await env.CDN.put(key, JSON.stringify(input.data, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-cache, no-store, must-revalidate',
    },
  })
  ctx.waitUntil(caches.default.delete(PUBLIC_ORIGIN + key))

  return json({ success: true, type, path: key })
}

/* ── POST /api/delete ─────────────────────────────────────────────────────── */

async function handleDelete(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
): Promise<Response> {
  let input: { path?: string }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const path = input.path ?? ''
  if (!path) return json({ error: 'Missing "path" parameter' }, 400)

  const key = safeKey(path)
  if (!key || isPrivateKey(key)) return json({ error: 'Invalid path' }, 400)

  // Manifesty a index se přes /api/delete mazat nesmí
  if (key.endsWith('.json') || key === 'index.html') {
    return json({ error: 'Cannot delete system files' }, 403)
  }

  const section = sectionForPath(key)
  if (section === 'admin-only') {
    if (session.role !== 'admin') return forbidden('Only admins can delete here')
  } else if (!hasPermission(session, section, 'delete')) {
    return forbidden(`No delete permission for ${section}`)
  }

  const head = await env.CDN.head(key)
  if (head === null) return json({ error: 'File not found' }, 404)

  await env.CDN.delete(key)
  ctx.waitUntil(caches.default.delete(PUBLIC_ORIGIN + key))

  return json({ success: true, deleted: key })
}

/* ── POST /api/login ──────────────────────────────────────────────────────── */

/**
 * Ověří jméno a heslo a vrátí session token.
 *
 * Ať uživatel neexistuje nebo jen nesedí heslo, odpověď je stejná — jinak by
 * formulář posloužil jako seznam platných jmen.
 */
async function handleLogin(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let input: { username?: string; password?: string }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const username = (input.username ?? '').trim()
  const password = input.password ?? ''
  if (!username) return json({ error: 'Invalid credentials' }, 401)

  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await checkLoginRateLimit(env, ip))) {
    return json({ error: 'Too many failed attempts. Try again later.' }, 429)
  }

  const manifest = await loadUsers(env)
  const user = manifest.users.find(u => u.username.toLowerCase() === username.toLowerCase())

  if (!user) {
    await recordFailedLogin(env, ip)
    return json({ error: 'Invalid credentials' }, 401)
  }

  const { valid, needsRehash } = await verifyPassword(password, user)
  if (!valid) {
    await recordFailedLogin(env, ip)
    return json({ error: 'Invalid credentials' }, 401)
  }

  // Staré SHA-256 heslo se při prvním úspěšném přihlášení tiše převede
  // na PBKDF2 — uživatel o migraci vůbec neví.
  if (needsRehash) {
    const fresh = await hashPassword(password)
    Object.assign(user, fresh)
    ctx.waitUntil(saveUsers(env, manifest))
  }

  await clearLoginAttempts(env, ip)
  const { token, expiresAt } = await createSession(env, user)

  return json({
    success: true,
    token,
    expiresAt,
    user: toPublicUser(user),
  })
}

/* ── POST /api/logout ─────────────────────────────────────────────────────── */

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? ''
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  const token = (bearer ? bearer[1] : req.headers.get('X-Api-Key') ?? '').trim()
  if (token) await destroySession(env, token)
  return json({ success: true })
}

/* ── POST /api/session ────────────────────────────────────────────────────── */

/** Řekne klientovi, jestli jeho token ještě platí, a s jakými právy. */
function handleSessionInfo(session: Session): Response {
  return json({
    success: true,
    user: {
      username: session.username,
      role: session.role,
      permissions: session.permissions,
    },
  })
}

/* ── POST /api/change-password ────────────────────────────────────────────── */

async function handleChangePassword(
  req: Request,
  env: Env,
  session: Session,
): Promise<Response> {
  let input: { currentPassword?: string; newPassword?: string }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const newPassword = input.newPassword ?? ''
  if (newPassword.length < 8) {
    return json({ error: 'New password must be at least 8 characters' }, 400)
  }

  const manifest = await loadUsers(env)
  const user = manifest.users.find(
    u => u.username.toLowerCase() === session.username.toLowerCase(),
  )
  if (!user) return json({ error: 'User not found' }, 404)

  const { valid } = await verifyPassword(input.currentPassword ?? '', user)
  if (!valid) return json({ error: 'Current password is incorrect' }, 403)

  Object.assign(user, await hashPassword(newPassword))
  await saveUsers(env, manifest)

  return json({ success: true })
}

/* ── POST /api/users ──────────────────────────────────────────────────────── */

/** Seznam účtů bez hashů a solí — ty klient k ničemu nepotřebuje. */
async function handleUsersList(env: Env): Promise<Response> {
  const manifest = await loadUsers(env)
  return json({ success: true, users: manifest.users.map(toPublicUser) })
}

function validPermissions(input: unknown): UserPermissions {
  const allowed = ['upload', 'delete', 'edit']
  const src = (input ?? {}) as Record<string, unknown>
  const pick = (section: string): ('upload' | 'delete' | 'edit')[] => {
    const raw = src[section]
    if (!Array.isArray(raw)) return []
    return raw.filter((p): p is 'upload' | 'delete' | 'edit' =>
      typeof p === 'string' && allowed.includes(p),
    )
  }
  return { gallery: pick('gallery'), museum: pick('museum'), rosnik: pick('rosnik') }
}

/** Založí nebo upraví účet. Heslo přijímá v čitelné podobě a hashuje ho sám. */
async function handleUserSave(req: Request, env: Env, session: Session): Promise<Response> {
  let input: {
    username?: string
    originalUsername?: string
    role?: string
    permissions?: unknown
    password?: string
    isNew?: boolean
  }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const username = (input.username ?? '').trim()
  if (!username) return json({ error: 'Username is required' }, 400)
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) {
    return json({ error: 'Username may only contain letters, digits, dot, dash and underscore' }, 400)
  }

  const role = input.role === 'admin' ? 'admin' : 'editor'
  const manifest = await loadUsers(env)
  const original = (input.originalUsername ?? username).trim().toLowerCase()
  const existingIndex = manifest.users.findIndex(u => u.username.toLowerCase() === original)

  // Zakládání a úprava se rozlišují explicitně. Kdyby se to odvozovalo
  // z toho, jestli jméno existuje, překlep při zakládání by tiše přepsal
  // cizí účet místo aby skončil chybou.
  const isNew = input.isNew === true
  if (isNew && existingIndex !== -1) {
    return json({ error: 'Username already exists' }, 409)
  }
  if (!isNew && existingIndex === -1) {
    return json({ error: 'User not found' }, 404)
  }

  // Přejmenování nesmí přepsat jiný účet
  const collision = manifest.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase())
  if (collision !== -1 && collision !== existingIndex) {
    return json({ error: 'Username already exists' }, 409)
  }

  if (isNew && !input.password) {
    return json({ error: 'Password is required for a new user' }, 400)
  }
  if (input.password && input.password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400)
  }

  let user: StoredUser
  if (isNew) {
    user = {
      username,
      ...(await hashPassword(input.password!)),
      role,
      permissions: role === 'admin' ? FULL_PERMISSIONS : validPermissions(input.permissions),
    }
    manifest.users.push(user)
  } else {
    user = manifest.users[existingIndex]

    // Poslední admin nesmí zmizet, jinak by se do panelu nedalo dostat
    if (user.role === 'admin' && role !== 'admin') {
      const admins = manifest.users.filter(u => u.role === 'admin').length
      if (admins <= 1) return json({ error: 'Cannot demote the last admin' }, 409)
    }

    user.username = username
    user.role = role
    user.permissions = role === 'admin' ? FULL_PERMISSIONS : validPermissions(input.permissions)
    if (input.password) Object.assign(user, await hashPassword(input.password))
  }

  await saveUsers(env, manifest)
  return json({ success: true, user: toPublicUser(user) })
}

async function handleUserDelete(req: Request, env: Env, session: Session): Promise<Response> {
  let input: { username?: string }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const username = (input.username ?? '').trim()
  if (!username) return json({ error: 'Missing "username"' }, 400)

  if (username.toLowerCase() === session.username.toLowerCase()) {
    return json({ error: 'Cannot delete your own account' }, 409)
  }

  const manifest = await loadUsers(env)
  const index = manifest.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase())
  if (index === -1) return json({ error: 'User not found' }, 404)

  if (manifest.users[index].role === 'admin') {
    const admins = manifest.users.filter(u => u.role === 'admin').length
    if (admins <= 1) return json({ error: 'Cannot delete the last admin' }, 409)
  }

  manifest.users.splice(index, 1)
  await saveUsers(env, manifest)
  return json({ success: true })
}

/* ── POST /api/contact ────────────────────────────────────────────────────── */

async function handleContact(req: Request, env: Env): Promise<Response> {
  let data: { name?: string; email?: string; message?: string; locale?: string }
  try {
    data = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const name = (data.name ?? '').trim()
  const email = (data.email ?? '').trim()
  const message = (data.message ?? '').trim()
  const locale = data.locale ?? 'cs'

  if (!name || !email || !message) {
    return json({ error: 'All fields are required' }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email address' }, 400)
  }
  if (name.length > 200 || email.length > 200 || message.length > 5000) {
    return json({ error: 'Input too long' }, 400)
  }

  // Rate limit 1 zpráva / minutu / IP (původně dočasný soubor v PHP)
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rlKey = `contact:${ip}`
  if (env.RATE_LIMIT) {
    if (await env.RATE_LIMIT.get(rlKey)) {
      return json({ error: 'Too many requests. Please wait a minute.' }, 429)
    }
    await env.RATE_LIMIT.put(rlKey, '1', { expirationTtl: 60 })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM,
      to: [env.CONTACT_TO],
      reply_to: email,
      subject: `[filiprosa.cz] New message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nLocale: ${locale}\n\n${message}`,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('Resend failed', res.status, detail)
    return json({ error: 'Failed to send email' }, 500)
  }

  return json({ success: true })
}

/* ── Router ───────────────────────────────────────────────────────────────── */

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // /api/upload i /api/upload.php — starý hosting měl obojí přes .htaccess
    const apiMatch = /^\/api\/([a-z-]+(?:\/[a-z-]+)?)(?:\.php)?\/?$/.exec(url.pathname)
    if (apiMatch) {
      const endpoint = apiMatch[1]

      if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405)
      }

      // Endpointy dostupné bez přihlášení
      if (endpoint === 'contact') return handleContact(req, env)
      if (endpoint === 'login')   return handleLogin(req, env, ctx)
      if (endpoint === 'logout')  return handleLogout(req, env)

      const session = await resolveSession(req, env)
      if (!session) return unauthorized()

      // Vyžadují jen platné přihlášení
      switch (endpoint) {
        case 'session':         return handleSessionInfo(session)
        case 'change-password': return handleChangePassword(req, env, session)
        case 'upload':          return handleUpload(req, env, ctx, session)
        case 'manifest':        return handleManifest(req, env, ctx, session)
        case 'delete':          return handleDelete(req, env, ctx, session)
      }

      // Správa účtů je jen pro adminy
      if (session.role !== 'admin') return forbidden('Admin role required')

      switch (endpoint) {
        case 'users':        return handleUsersList(env)
        case 'users/save':   return handleUserSave(req, env, session)
        case 'users/delete': return handleUserDelete(req, env, session)
        default:             return json({ error: 'Unknown endpoint' }, 404)
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveObject(req, env, url)
    }

    return json({ error: 'Method not allowed' }, 405)
  },
} satisfies ExportedHandler<Env>
