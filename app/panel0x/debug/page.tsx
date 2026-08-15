'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

// Záložní token Workeru. Normální přihlášení ho nepoužívá — session token
// vydává /api/login. Tohle je cesta zpátky do panelu, když by se rozbilo
// přihlašování nebo KV.
const CDN_TOKEN_KEY = '__fr_admin_pass'

export default function DebugAdmin() {
  const [result, setResult]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ key: string; value: string; store: string }[]>([])
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  useEffect(() => { refreshStorageInfo() }, [])

  function refreshStorageInfo() {
    const items: { key: string; value: string; store: string }[] = []
    const sessionKeys = ['__fr_admin_user', '__fr_admin_auth', '__fr_admin_role', '__fr_admin_perms', '__fr_login_attempts']
    const localKeys   = [CDN_TOKEN_KEY, '__fr_cdn_url']

    for (const key of sessionKeys) {
      const val = sessionStorage.getItem(key)
      if (val !== null) {
        const display = key === '__fr_admin_auth' || key === CDN_TOKEN_KEY
          ? val.length > 0 ? `${'*'.repeat(Math.min(val.length, 8))} (${val.length} chars)` : '(empty)'
          : val.length > 120 ? val.slice(0, 120) + '…' : val
        items.push({ key, value: display, store: 'session' })
      }
    }
    for (const key of localKeys) {
      const val = localStorage.getItem(key)
      if (val !== null) {
        const display = key === CDN_TOKEN_KEY
          ? val.length > 0 ? `${'*'.repeat(Math.min(val.length, 8))} (${val.length} chars)` : '(empty)'
          : val
        items.push({ key, value: display, store: 'local' })
      }
    }
    setStorageInfo(items)
  }

  function saveToken() {
    if (!tokenInput.trim()) return
    localStorage.setItem(CDN_TOKEN_KEY, tokenInput.trim())
    sessionStorage.setItem('__fr_admin_auth', tokenInput.trim())
    setTokenSaved(true)
    setTokenInput('')
    refreshStorageInfo()
    setTimeout(() => setTokenSaved(false), 2000)
  }

  function clearSession() {
    const keys = ['__fr_admin_user', '__fr_admin_auth', '__fr_admin_role', '__fr_admin_perms', '__fr_login_attempts']
    keys.forEach(k => sessionStorage.removeItem(k))
    refreshStorageInfo()
    setResult('Session cleared.')
  }

  async function run(_label: string, fn: () => Promise<string>) {
    setLoading(true)
    setResult(null)
    try {
      setResult(await fn())
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function cdnUrl() {
    return (typeof window !== 'undefined' && localStorage.getItem('__fr_cdn_url')) || 'https://cdn.filiprosa.cz/'
  }
  function token() {
    return (typeof window !== 'undefined' && sessionStorage.getItem('__fr_admin_auth')) || ''
  }

  async function cmdSession() {
    const res = await fetch(`${cdnUrl()}api/session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token()}`, 'X-Api-Key': token(), 'Content-Type': 'application/json' },
    })
    return `Who am I: HTTP ${res.status}\n\n${await res.text()}`
  }

  async function cmdManifests() {
    const manifests = ['gallery', 'museum', 'rosnik', 'gear', 'services', 'site', 'pricelist', 'graphics', 'faq']
    const lines: string[] = []
    for (const m of manifests) {
      try {
        const res = await fetch(`${cdnUrl()}${m}.json`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          lines.push(`${m}.json: OK  (${JSON.stringify(data).length} bytes)`)
        } else {
          lines.push(`${m}.json: ${res.status} ${res.statusText}`)
        }
      } catch (err) {
        lines.push(`${m}.json: Error — ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // users.json se ven vydávat nesmí — 404 je tady správný výsledek
    const priv = await fetch(`${cdnUrl()}users.json`, { cache: 'no-store' })
    lines.push(
      priv.status === 404
        ? 'users.json: správně nedostupný (404)'
        : `users.json: POZOR — vrací ${priv.status}, měl by být 404!`,
    )

    return lines.join('\n')
  }

  async function cmdUploadAuth() {
    const res = await fetch(`${cdnUrl()}api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token()}`, 'X-Api-Key': token() },
      body: new FormData(),
    })
    return `Upload endpoint: HTTP ${res.status}\n\n${await res.text()}`
  }

  async function cmdUsersAuth() {
    const res = await fetch(`${cdnUrl()}api/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token()}`, 'X-Api-Key': token(), 'Content-Type': 'application/json' },
    })
    const text = await res.text()
    const leak = /passwordHash|"salt"/.test(text)
      ? '\n\nPOZOR: odpověď obsahuje hash nebo sůl!'
      : ''
    return `users endpoint: HTTP ${res.status}\n\n${text}${leak}`
  }

  async function cmdContact() {
    // /api/contact does not require auth — this just verifies the endpoint reachability.
    const res = await fetch(`${cdnUrl()}api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _probe: true }),
    })
    return `contact endpoint: HTTP ${res.status}\n\n${await res.text()}`
  }

  async function cmdAssets() {
    // Spot-check that newly added asset folders exist (any 200/403 means folder exists; 404 = missing).
    const folders = ['gallery', 'museum', 'rosnik', 'gear', 'services', 'site', 'pricelist', 'graphics']
    const lines: string[] = []
    for (const f of folders) {
      try {
        const res = await fetch(`${cdnUrl()}${f}/`, { method: 'HEAD' })
        lines.push(`/${f}/: HTTP ${res.status}`)
      } catch (err) {
        lines.push(`/${f}/: Error — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return lines.join('\n')
  }

  async function cmdPing() {
    const start = Date.now()
    const res = await fetch(`${cdnUrl()}gallery.json`, { cache: 'no-store' })
    const ms = Date.now() - start
    return `CDN ping: HTTP ${res.status}  ${ms}ms\nURL: ${cdnUrl()}`
  }

  const displayCdnUrl = (typeof window !== 'undefined' && localStorage.getItem('__fr_cdn_url')) || 'https://cdn.filiprosa.cz/'

  return (
    <div className="min-h-dvh bg-dark text-offwhite font-body px-6 py-12">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <Link
            href="/panel0x"
            className="text-[0.7rem] tracking-[0.14em] uppercase text-muted hover:text-offwhite transition-colors duration-200"
          >
            &larr; panel0x
          </Link>
          <h1 className="text-2xl font-display font-semibold text-offwhite tracking-[-0.02em] mt-2">Debug</h1>
          <p className="text-[0.78rem] text-muted mt-1">Diagnostics and CDN tools</p>
        </div>

        {/* CDN Info */}
        <div className="mb-4 px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px]">
          <p className="text-[0.72rem] text-muted/50 uppercase tracking-wider mb-2">CDN Server</p>
          <p className="text-[0.82rem] text-lime/70 font-mono">{displayCdnUrl}</p>
        </div>

        {/* Token Setter */}
        <div className="mb-4 px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px]">
          <p className="text-[0.72rem] text-muted/50 uppercase tracking-wider mb-3">Break-glass token</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveToken()}
              placeholder="Paste new token…"
              className="flex-1 bg-dark border border-white/[0.08] rounded-[2px] px-3 py-1.5 text-[0.75rem] font-mono text-offwhite/80 placeholder:text-muted/30 focus:outline-none focus:border-lime/30"
            />
            <button
              onClick={saveToken}
              className="px-3 py-1.5 text-[0.72rem] font-medium text-lime border border-lime/30 rounded-[2px] hover:bg-lime/10 transition-colors duration-200"
            >
              {tokenSaved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <p className="text-[0.65rem] text-muted/30 mt-2">Záložní token Workeru pro případ, že se rozbije přihlašování. Běžné přihlášení ho nepotřebuje.</p>
        </div>

        {/* Auth Storage */}
        <div className="mb-4 px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[0.72rem] text-muted/50 uppercase tracking-wider">Auth Storage</p>
            <div className="flex gap-2">
              <button
                onClick={clearSession}
                className="px-2 py-0.5 text-[0.65rem] font-medium text-red-400/70 border border-red-500/20 rounded-[2px] hover:text-red-400 transition-colors duration-200"
              >
                Clear session
              </button>
              <button
                onClick={refreshStorageInfo}
                className="px-2 py-0.5 text-[0.65rem] font-medium text-muted border border-white/[0.07] rounded-[2px] hover:text-offwhite transition-colors duration-200"
              >
                Refresh
              </button>
            </div>
          </div>
          {storageInfo.length === 0 ? (
            <p className="text-[0.75rem] text-muted/40">No auth keys found</p>
          ) : (
            <div className="space-y-1.5">
              {storageInfo.map(item => (
                <div key={item.key} className="flex items-start gap-3 text-[0.72rem]">
                  <span className="text-[0.6rem] text-muted/30 uppercase tracking-wide w-14 flex-shrink-0 pt-0.5">{item.store}</span>
                  <span className="text-muted/60 font-mono flex-shrink-0">{item.key}</span>
                  <span className="text-offwhite/60 font-mono break-all">{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CDN Tests */}
        <div className="mb-4 px-5 py-4 bg-charcoal border border-orange-500/20 rounded-[3px]">
          <p className="text-[0.72rem] text-orange-400/80 font-medium uppercase tracking-wider mb-3">CDN Commands</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => run('ping', cmdPing)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Ping CDN
            </button>
            <button
              onClick={() => run('session', cmdSession)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Who Am I
            </button>
            <button
              onClick={() => run('manifests', cmdManifests)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Test All Manifests
            </button>
            <button
              onClick={() => run('upload-auth', cmdUploadAuth)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Test Upload Auth
            </button>
            <button
              onClick={() => run('users', cmdUsersAuth)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Test Users Endpoint
            </button>
            <button
              onClick={() => run('contact', cmdContact)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Test Contact Endpoint
            </button>
            <button
              onClick={() => run('assets', cmdAssets)}
              disabled={loading}
              className="px-3 py-1 text-[0.72rem] font-medium text-orange-400 border border-orange-500/30 rounded-[2px] hover:bg-orange-500/10 disabled:opacity-40 transition-colors duration-200"
            >
              Check Asset Folders
            </button>
          </div>
          {loading && <p className="text-[0.72rem] text-muted/50 mb-2">Running…</p>}
          {result && (
            <pre className="p-3 bg-dark border border-white/[0.06] rounded-[2px] text-[0.65rem] text-offwhite/70 font-mono overflow-x-auto whitespace-pre-wrap max-h-[420px] overflow-y-auto">
              {result}
            </pre>
          )}
        </div>

        {/* Environment */}
        <div className="px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px]">
          <p className="text-[0.72rem] text-muted/50 uppercase tracking-wider mb-2">Environment</p>
          <div className="space-y-1 text-[0.72rem] font-mono">
            <p><span className="text-muted/40">User Agent: </span><span className="text-offwhite/50">{typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 90) : 'N/A'}…</span></p>
            <p><span className="text-muted/40">Window:     </span><span className="text-offwhite/50">{typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : 'N/A'}</span></p>
            <p><span className="text-muted/40">Protocol:   </span><span className="text-offwhite/50">{typeof location !== 'undefined' ? location.protocol : 'N/A'}</span></p>
            <p><span className="text-muted/40">Host:       </span><span className="text-offwhite/50">{typeof location !== 'undefined' ? location.host : 'N/A'}</span></p>
          </div>
        </div>

      </div>
    </div>
  )
}
