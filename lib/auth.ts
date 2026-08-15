/**
 * Přihlašování do admin panelu.
 *
 * Hesla ověřuje CDN Worker, ne prohlížeč. Dřív si klient stahoval veřejný
 * users.json s hashi všech účtů a porovnával je u sebe — hashe si tak mohl
 * stáhnout kdokoliv a lámat je offline. Teď jde jméno s heslem na
 * POST /api/login a zpátky se vrací session token s omezenou platností.
 */

import { CDN_URL } from './cdn'

// ─── Typy ────────────────────────────────────────────────────────────────────

export type Permission = 'upload' | 'delete' | 'edit'
export type Section = 'gallery' | 'museum' | 'rosnik'

export interface UserPermissions {
  gallery: Permission[]
  museum: Permission[]
  rosnik: Permission[]
}

/** Uživatel tak, jak ho vydává server — bez hashe a soli. */
export interface User {
  username: string
  role: 'admin' | 'editor'
  permissions: UserPermissions
}

// ─── Konstanty ───────────────────────────────────────────────────────────────

const SESSION_USER_KEY = '__fr_admin_user'
const SESSION_AUTH_KEY = '__fr_admin_auth'    // session token z /api/login
const SESSION_ROLE_KEY = '__fr_admin_role'
const SESSION_PERMS_KEY = '__fr_admin_perms'
const SESSION_EXP_KEY = '__fr_admin_exp'

const ALL_PERMISSIONS: Permission[] = ['upload', 'delete', 'edit']

export const FULL_PERMISSIONS: UserPermissions = {
  gallery: [...ALL_PERMISSIONS],
  museum: [...ALL_PERMISSIONS],
  rosnik: [...ALL_PERMISSIONS],
}

// ─── Volání API ──────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = sessionStorage.getItem(SESSION_AUTH_KEY) || ''
  return {
    'Authorization': `Bearer ${token}`,
    'X-Api-Key': token,
    'Content-Type': 'application/json',
  }
}

/** Pošle POST na endpoint API a vrátí rozparsovanou odpověď. */
async function apiPost<T>(
  endpoint: string,
  body?: unknown,
  withAuth = true,
): Promise<T> {
  const res = await fetch(`${CDN_URL}api/${endpoint}`, {
    method: 'POST',
    headers: withAuth ? authHeaders() : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let data: unknown = null
  try { data = await res.json() } catch { /* prázdná nebo nevalidní odpověď */ }

  if (!res.ok) {
    const message = (data as { error?: string })?.error
    throw new Error(message || `Request failed (${res.status})`)
  }

  return data as T
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface SessionInfo {
  username: string
  role: 'admin' | 'editor'
  permissions: UserPermissions
}

/** Vrátí přihlášeného uživatele, nebo null. Vypršelou session sama uklidí. */
export function getSession(): SessionInfo | null {
  if (typeof window === 'undefined') return null

  const token = sessionStorage.getItem(SESSION_AUTH_KEY)
  const username = sessionStorage.getItem(SESSION_USER_KEY)
  const role = sessionStorage.getItem(SESSION_ROLE_KEY) as 'admin' | 'editor' | null
  if (!token || !username || !role) return null

  const expiresAt = parseInt(sessionStorage.getItem(SESSION_EXP_KEY) || '0', 10)
  if (expiresAt && Date.now() > expiresAt) {
    clearSession()
    return null
  }

  let permissions: UserPermissions = FULL_PERMISSIONS
  const raw = sessionStorage.getItem(SESSION_PERMS_KEY)
  if (raw) {
    try { permissions = JSON.parse(raw) } catch { /* ponech výchozí */ }
  }

  return { username, role, permissions }
}

function storeSession(user: User, token: string, expiresAt: number): void {
  sessionStorage.setItem(SESSION_AUTH_KEY, token)
  sessionStorage.setItem(SESSION_USER_KEY, user.username)
  sessionStorage.setItem(SESSION_ROLE_KEY, user.role)
  sessionStorage.setItem(SESSION_PERMS_KEY, JSON.stringify(user.permissions))
  sessionStorage.setItem(SESSION_EXP_KEY, String(expiresAt))
}

export function clearSession(): void {
  for (const key of [
    SESSION_AUTH_KEY, SESSION_USER_KEY, SESSION_ROLE_KEY,
    SESSION_PERMS_KEY, SESSION_EXP_KEY,
  ]) {
    sessionStorage.removeItem(key)
  }
}

// ─── Přihlášení a odhlášení ──────────────────────────────────────────────────

/**
 * Přihlásí uživatele. Při špatných údajích vyhodí chybu s hláškou ze serveru.
 * Počítadlo neúspěšných pokusů drží Worker podle IP — na rozdíl od původního
 * počítadla v sessionStorage ho nejde obejít anonymním oknem.
 */
export async function login(username: string, password: string): Promise<SessionInfo> {
  const res = await apiPost<{ token: string; expiresAt: number; user: User }>(
    'login',
    { username, password },
    false,
  )
  storeSession(res.user, res.token, res.expiresAt)
  return {
    username: res.user.username,
    role: res.user.role,
    permissions: res.user.permissions,
  }
}

/** Odhlásí uživatele a zneplatní token i na serveru. */
export async function logout(): Promise<void> {
  try {
    await apiPost('logout')
  } catch {
    // I když se odhlášení na serveru nepovede, lokální session musí zmizet
  }
  clearSession()
}

/** Ověří u serveru, že token pořád platí. Používá se při načtení panelu. */
export async function verifySession(): Promise<SessionInfo | null> {
  const local = getSession()
  if (!local) return null

  try {
    const res = await apiPost<{ user: User }>('session')
    storeSession(
      res.user,
      sessionStorage.getItem(SESSION_AUTH_KEY) || '',
      parseInt(sessionStorage.getItem(SESSION_EXP_KEY) || '0', 10),
    )
    return {
      username: res.user.username,
      role: res.user.role,
      permissions: res.user.permissions,
    }
  } catch {
    clearSession()
    return null
  }
}

// ─── Oprávnění ───────────────────────────────────────────────────────────────

/**
 * Kontrola pro skrývání tlačítek v UI. Skutečné vynucení dělá Worker —
 * tohle je jen pohodlí, ne bezpečnostní hranice.
 */
export function hasPermission(section: Section, permission: Permission): boolean {
  const session = getSession()
  if (!session) return false
  if (session.role === 'admin') return true
  return session.permissions[section]?.includes(permission) ?? false
}

export function isAdmin(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(SESSION_ROLE_KEY) === 'admin'
}

// ─── Změna vlastního hesla ───────────────────────────────────────────────────

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiPost('change-password', { currentPassword, newPassword })
}

// ─── Správa uživatelů (jen pro adminy) ───────────────────────────────────────

export async function loadUsers(): Promise<{ users: User[] }> {
  return apiPost<{ users: User[] }>('users')
}

export interface SaveUserInput {
  username: string
  role: 'admin' | 'editor'
  permissions: UserPermissions
  /** Vyplní se jen při zakládání nebo když se heslo mění. */
  password?: string
  /** Původní jméno při přejmenování. */
  originalUsername?: string
  isNew: boolean
}

export async function saveUser(input: SaveUserInput): Promise<User> {
  const res = await apiPost<{ user: User }>('users/save', input)
  return res.user
}

export async function deleteUser(username: string): Promise<void> {
  await apiPost('users/delete', { username })
}
