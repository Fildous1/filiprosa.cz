'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { login, verifySession } from '@/lib/auth'

export default function AdminAuth({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Uloženou session ověří server — vypršelý nebo odvolaný token tak
  // panel neotevře jen proto, že v sessionStorage něco zbylo.
  useEffect(() => {
    verifySession()
      .then(session => setAuthed(session !== null))
      .finally(() => setChecking(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError('')

    try {
      await login(username.trim(), password)
      setPassword('')
      setAuthed(true)
    } catch (err) {
      // Hlášku posílá server — rozliší špatné údaje od zablokování za
      // příliš mnoho pokusů, aniž by prozradila, které jméno existuje.
      setError(err instanceof Error ? err.message : 'Login failed')
    }

    setSubmitting(false)
  }

  if (checking) return null

  if (!authed) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-dark">
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 w-full max-w-[220px]">
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError('') }}
            placeholder="username"
            autoFocus
            autoComplete="username"
            className={`w-full px-4 py-2 bg-charcoal border ${error ? 'border-red-500/50' : 'border-white/[0.08]'} rounded-[2px] text-offwhite text-[0.85rem] font-body placeholder:text-muted/30 focus:outline-none focus:border-lime/40`}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError('') }}
            placeholder="password"
            autoComplete="current-password"
            className={`w-full px-4 py-2 bg-charcoal border ${error ? 'border-red-500/50' : 'border-white/[0.08]'} rounded-[2px] text-offwhite text-[0.85rem] font-body placeholder:text-muted/30 focus:outline-none focus:border-lime/40`}
          />
          {error && (
            <p className="text-[0.72rem] text-red-400/80 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-5 py-2 text-[0.8rem] font-medium bg-lime/10 text-lime/60 border border-lime/20 rounded-[2px] hover:bg-lime/20 hover:text-lime disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-300"
          >
            {submitting ? '...' : 'OK'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}
