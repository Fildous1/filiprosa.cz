'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  getSession,
  logout,
  changePassword,
  type SessionInfo,
} from '@/lib/auth'

const contentSections = [
  {
    href: '/panel0x/gallery',
    label: 'Gallery',
    description: 'Manage photo albums and images',
    detail: 'Upload photos, manage albums, edit captions',
  },
  {
    href: '/panel0x/museum',
    label: 'Museum',
    description: 'Manage vintage camera collection',
    detail: 'Add/edit cameras, upload thumbnails',
  },
  {
    href: '/panel0x/rosnik',
    label: 'Rosnik',
    description: 'Manage magazine issues',
    detail: 'Add/edit issues, upload PDFs and thumbnails',
  },
  {
    href: '/panel0x/graphics',
    label: 'Graphics',
    description: 'Manage downloadable graphics',
    detail: 'Wallpapers, backgrounds, preview images',
  },
]

const miscSections = [
  {
    href: '/panel0x/gear',
    label: 'Gear',
    description: 'Manage gear section images',
    detail: 'Upload photos for each gear category',
  },
  {
    href: '/panel0x/services',
    label: 'Services',
    description: 'Manage services section images',
    detail: 'Upload background photos for service cards',
  },
  {
    href: '/panel0x/pricelist',
    label: 'Pricelist',
    description: 'Edit pricelist content and images',
    detail: 'Photo cards (image + texts), tile sections, travel note',
  },
  {
    href: '/panel0x/contact-section',
    label: 'Contact Section',
    description: 'Edit the about/contact section',
    detail: 'Profile photo, bio text (CS + EN)',
  },
  {
    href: '/panel0x/contact-notice',
    label: 'Contact Notice',
    description: 'Banner on top of the contact section',
    detail: 'Text (CS + EN), color, size, bold, enable/disable',
  },
  {
    href: '/panel0x/faq',
    label: 'FAQ',
    description: 'Manage frequently asked questions',
    detail: 'Edit questions and answers (CS + EN)',
  },
  {
    href: '/panel0x/landing',
    label: 'Landing',
    description: 'Edit the hero section',
    detail: 'Background image, headline text (CS + EN)',
  },
]

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' }
  if (score <= 2) return { score, label: 'Fair', color: 'bg-orange-400' }
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-400' }
  return { score, label: 'Strong', color: 'bg-lime' }
}

export default function AdminDashboard() {
  const router = useRouter()
  const [session, setSessionState] = useState<SessionInfo | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [cdnUrl, setCdnUrl] = useState(() =>
    (typeof window !== 'undefined' && localStorage.getItem('__fr_cdn_url')) || 'https://cdn.filiprosa.cz/'
  )
  const [configSaved, setConfigSaved] = useState(false)

  // Password change state
  const [currentPass, setCurrentPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passError, setPassError] = useState('')
  const [passSaving, setPassSaving] = useState(false)
  const [passSaved, setPassSaved] = useState(false)

  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSessionState(getSession())
  }, [])

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [userMenuOpen])

  async function handleLogout() {
    await logout()
    router.push('/')
  }

  function handleSaveConfig() {
    if (cdnUrl && cdnUrl !== 'https://cdn.filiprosa.cz/') {
      localStorage.setItem('__fr_cdn_url', cdnUrl)
    } else {
      localStorage.removeItem('__fr_cdn_url')
    }
    setConfigSaved(true)
    setTimeout(() => {
      setConfigSaved(false)
      setConfigOpen(false)
      window.location.reload()
    }, 800)
  }

  async function handleChangePassword() {
    if (!currentPass || !newPass || newPass !== confirmPass) return
    setPassSaving(true)
    setPassError('')

    try {
      // Heslo ověří i zahashuje Worker — prohlížeč ho jen předá dál.
      await changePassword(currentPass, newPass)

      setPassSaved(true)
      setTimeout(() => {
        setPassSaved(false)
        setPasswordModalOpen(false)
        setCurrentPass('')
        setNewPass('')
        setConfirmPass('')
      }, 1000)
    } catch (err) {
      setPassError(err instanceof Error ? err.message : 'Failed to save')
    }

    setPassSaving(false)
  }

  const adminUser = session?.role === 'admin'

  return (
    <div className="min-h-dvh bg-dark text-offwhite font-body px-6 py-12">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-12">
          <div>
            <p className="text-[0.7rem] tracking-[0.18em] uppercase text-muted mb-1">Admin Panel</p>
            <h1 className="text-2xl font-display font-semibold text-offwhite tracking-[-0.02em]">panel0x</h1>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => setConfigOpen(true)}
              className="w-9 h-9 flex items-center justify-center text-muted border border-white/[0.07] rounded-[2px] hover:border-white/20 hover:text-offwhite focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.97] transition-colors duration-200"
              aria-label="Settings"
              title="Settings"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>

            {/* User icon with dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="w-9 h-9 flex items-center justify-center text-muted border border-white/[0.07] rounded-[2px] hover:border-white/20 hover:text-offwhite focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.97] transition-colors duration-200"
                aria-label="User menu"
                title={session?.username || 'User'}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-charcoal border border-white/[0.1] rounded-[3px] shadow-lg z-50 overflow-hidden">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-white/[0.06]">
                    <p className="text-[0.8rem] font-medium text-offwhite truncate">{session?.username}</p>
                    <p className="text-[0.65rem] text-muted/50 uppercase tracking-wide">{session?.role}</p>
                  </div>

                  {/* Menu items */}
                  <div className="py-1">
                    <button
                      onClick={() => { setUserMenuOpen(false); setPasswordModalOpen(true) }}
                      className="w-full px-4 py-2.5 text-left text-[0.78rem] text-muted hover:text-offwhite hover:bg-white/[0.04] transition-colors duration-150 flex items-center gap-2.5"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                      Change password
                    </button>
                    <button
                      onClick={() => { setUserMenuOpen(false); handleLogout() }}
                      className="w-full px-4 py-2.5 text-left text-[0.78rem] text-muted hover:text-red-400 hover:bg-white/[0.04] transition-colors duration-150 flex items-center gap-2.5"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                      </svg>
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content sections */}
        <p className="text-[0.62rem] tracking-[0.16em] uppercase text-muted/40 mb-3">Content</p>
        <div className="grid grid-cols-2 gap-2 mb-8">
          {contentSections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col justify-between px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px] hover:border-white/[0.13] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.99] transition-colors duration-200"
            >
              <div>
                <p className="text-[0.95rem] font-medium text-offwhite group-hover:text-lime transition-colors duration-200">{s.label}</p>
                <p className="text-[0.78rem] text-muted mt-0.5">{s.description}</p>
                <p className="text-[0.7rem] text-muted/40 mt-1">{s.detail}</p>
              </div>
              <span className="text-muted/40 group-hover:text-lime/50 transition-colors duration-200 mt-3 text-lg leading-none">&rarr;</span>
            </Link>
          ))}
        </div>

        {/* Miscellaneous sections */}
        <p className="text-[0.62rem] tracking-[0.16em] uppercase text-muted/40 mb-3">Miscellaneous</p>
        <div className="grid grid-cols-2 gap-2 mb-8">
          {miscSections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col justify-between px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px] hover:border-white/[0.13] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.99] transition-colors duration-200"
            >
              <div>
                <p className="text-[0.95rem] font-medium text-offwhite group-hover:text-lime transition-colors duration-200">{s.label}</p>
                <p className="text-[0.78rem] text-muted mt-0.5">{s.description}</p>
                <p className="text-[0.7rem] text-muted/40 mt-1">{s.detail}</p>
              </div>
              <span className="text-muted/40 group-hover:text-lime/50 transition-colors duration-200 mt-3 text-lg leading-none">&rarr;</span>
            </Link>
          ))}
        </div>

        {/* Admin-only sections */}
        {adminUser && (
          <>
            <p className="text-[0.62rem] tracking-[0.16em] uppercase text-muted/40 mb-3">Admin</p>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/panel0x/users"
                className="group flex flex-col justify-between px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px] hover:border-white/[0.13] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.99] transition-colors duration-200"
              >
                <div>
                  <p className="text-[0.95rem] font-medium text-offwhite group-hover:text-lime transition-colors duration-200 flex items-center gap-2">
                    Users
                    <span className="text-[0.6rem] text-lime/40 border border-lime/20 px-1.5 py-0.5 rounded-[2px] uppercase tracking-wider font-medium">Admin</span>
                  </p>
                  <p className="text-[0.78rem] text-muted mt-0.5">Manage users and permissions</p>
                  <p className="text-[0.7rem] text-muted/40 mt-1">Add/remove users, set access rights</p>
                </div>
                <span className="text-muted/40 group-hover:text-lime/50 transition-colors duration-200 mt-3 text-lg leading-none">&rarr;</span>
              </Link>
              <Link
                href="/panel0x/debug"
                className="group flex flex-col justify-between px-5 py-4 bg-charcoal border border-orange-500/10 rounded-[3px] hover:border-orange-500/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/30 active:scale-[0.99] transition-colors duration-200"
              >
                <div>
                  <p className="text-[0.95rem] font-medium text-offwhite group-hover:text-orange-400 transition-colors duration-200 flex items-center gap-2">
                    Debug
                    <span className="text-[0.6rem] text-orange-400/40 border border-orange-500/20 px-1.5 py-0.5 rounded-[2px] uppercase tracking-wider font-medium">Admin</span>
                  </p>
                  <p className="text-[0.78rem] text-muted mt-0.5">Diagnostics and debug tools</p>
                  <p className="text-[0.7rem] text-muted/40 mt-1">CDN tests, auth storage, environment info</p>
                </div>
                <span className="text-muted/40 group-hover:text-orange-400/50 transition-colors duration-200 mt-3 text-lg leading-none">&rarr;</span>
              </Link>
            </div>
          </>
        )}

        {/* Links */}
        <div className="mt-10 flex gap-3">
          <a
            href="https://cdn.filiprosa.cz"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-5 py-3.5 bg-charcoal border border-white/[0.05] rounded-[3px] hover:border-white/[0.13] transition-colors duration-200 text-center"
          >
            <p className="text-[0.68rem] text-muted/40 uppercase tracking-[0.1em] mb-0.5">CDN</p>
            <p className="text-[0.8rem] text-lime/60 font-mono">cdn.filiprosa.cz</p>
          </a>
          <a
            href="https://filiprosa.cz"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-5 py-3.5 bg-charcoal border border-white/[0.05] rounded-[3px] hover:border-white/[0.13] transition-colors duration-200 text-center"
          >
            <p className="text-[0.68rem] text-muted/40 uppercase tracking-[0.1em] mb-0.5">Main site</p>
            <p className="text-[0.8rem] text-offwhite/60 font-mono">filiprosa.cz</p>
          </a>
        </div>


        {/* Info */}
        <div className="mt-4 px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px]">
          <p className="text-[0.72rem] text-muted/60 leading-relaxed">
            Content is managed through this panel and stored on <span className="text-lime/50 font-mono">cdn.filiprosa.cz</span>. All pages load their content from CDN manifests at runtime.
          </p>
        </div>

        {/* Config modal (CDN URL only — password change moved to user dropdown) */}
        {configOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-dark/80 backdrop-blur-sm">
            <div className="flex flex-col items-end gap-2 w-full max-w-md">
              <button
                onClick={() => setConfigOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-offwhite transition-colors duration-200"
                aria-label="Close"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="bg-charcoal border border-white/[0.08] rounded-[3px] p-6 w-full">
                <h3 className="text-[0.9rem] font-medium text-offwhite mb-5">Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">CDN Server URL</label>
                    <input
                      value={cdnUrl}
                      onChange={e => setCdnUrl(e.target.value)}
                      placeholder="https://cdn.filiprosa.cz/"
                      className="w-full px-3 py-2 bg-dark border border-white/[0.08] rounded-[2px] text-[0.8rem] text-offwhite font-mono placeholder:text-muted/30 focus:outline-none focus:border-lime/40"
                    />
                    <p className="text-[0.65rem] text-muted/40 mt-1">Changes require page reload</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={handleSaveConfig}
                    disabled={configSaved}
                    className="px-4 py-1.5 text-[0.75rem] font-medium bg-lime/10 text-lime border border-lime/20 rounded-[2px] hover:bg-lime/20 disabled:opacity-40 transition-colors duration-200"
                  >
                    {configSaved ? 'Saved!' : 'Save'}
                  </button>
                  <button
                    onClick={() => setConfigOpen(false)}
                    className="px-4 py-1.5 text-[0.75rem] font-medium text-muted border border-white/[0.07] rounded-[2px] hover:text-offwhite transition-colors duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Change Password modal */}
        {passwordModalOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-dark/80 backdrop-blur-sm">
            <div className="flex flex-col items-end gap-2 w-full max-w-md">
              <button
                onClick={() => { setPasswordModalOpen(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); setPassError('') }}
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-offwhite transition-colors duration-200"
                aria-label="Close"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="bg-charcoal border border-white/[0.08] rounded-[3px] p-6 w-full">
                <h3 className="text-[0.9rem] font-medium text-offwhite mb-5">Change Password</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">Current Password</label>
                    <input
                      type="password"
                      value={currentPass}
                      onChange={e => { setCurrentPass(e.target.value); setPassError('') }}
                      placeholder="Enter current password"
                      autoComplete="current-password"
                      className="w-full px-3 py-2 bg-dark border border-white/[0.08] rounded-[2px] text-[0.8rem] text-offwhite placeholder:text-muted/30 focus:outline-none focus:border-lime/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">New Password</label>
                    <input
                      type="password"
                      value={newPass}
                      onChange={e => { setNewPass(e.target.value); setPassError('') }}
                      placeholder="Enter new password"
                      autoComplete="new-password"
                      className="w-full px-3 py-2 bg-dark border border-white/[0.08] rounded-[2px] text-[0.8rem] text-offwhite placeholder:text-muted/30 focus:outline-none focus:border-lime/40"
                    />
                    {newPass && (
                      <div className="mt-2">
                        <div className="flex gap-1 mb-1">
                          {[1, 2, 3, 4, 5].map(i => (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full ${i <= getPasswordStrength(newPass).score ? getPasswordStrength(newPass).color : 'bg-white/[0.06]'}`}
                            />
                          ))}
                        </div>
                        <p className="text-[0.65rem] text-muted/50">{getPasswordStrength(newPass).label}</p>
                      </div>
                    )}
                  </div>
                  {newPass && (
                    <div>
                      <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPass}
                        onChange={e => { setConfirmPass(e.target.value); setPassError('') }}
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                        className={`w-full px-3 py-2 bg-dark border rounded-[2px] text-[0.8rem] text-offwhite placeholder:text-muted/30 focus:outline-none focus:border-lime/40 ${
                          confirmPass && confirmPass !== newPass ? 'border-red-500/50' : 'border-white/[0.08]'
                        }`}
                      />
                      {confirmPass && confirmPass !== newPass && (
                        <p className="text-[0.65rem] text-red-400/70 mt-1">Passwords do not match</p>
                      )}
                    </div>
                  )}
                  {passError && (
                    <p className="text-[0.72rem] text-red-400/80">{passError}</p>
                  )}
                </div>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={handleChangePassword}
                    disabled={passSaving || passSaved || !currentPass || !newPass || newPass !== confirmPass}
                    className="px-4 py-1.5 text-[0.75rem] font-medium bg-lime/10 text-lime border border-lime/20 rounded-[2px] hover:bg-lime/20 disabled:opacity-40 transition-colors duration-200"
                  >
                    {passSaved ? 'Saved!' : passSaving ? 'Saving...' : 'Change Password'}
                  </button>
                  <button
                    onClick={() => { setPasswordModalOpen(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); setPassError('') }}
                    className="px-4 py-1.5 text-[0.75rem] font-medium text-muted border border-white/[0.07] rounded-[2px] hover:text-offwhite transition-colors duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

