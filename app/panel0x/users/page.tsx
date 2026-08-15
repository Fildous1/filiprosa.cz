'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  isAdmin,
  getSession,
  loadUsers,
  saveUser,
  deleteUser,
  type User,
  type Permission,
  type Section,
  FULL_PERMISSIONS,
} from '@/lib/auth'
import { useToast } from '@/components/admin/Toast'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'gallery', label: 'Gallery' },
  { key: 'museum', label: 'Museum' },
  { key: 'rosnik', label: 'Rosnik' },
]

const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'delete', label: 'Delete' },
  { key: 'edit', label: 'Edit' },
]

export default function UsersPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [editUser, setEditUser] = useState<User | null>(null)
  const [isNewUser, setIsNewUser] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  // Jméno před editací — server podle něj pozná, který účet přejmenovat
  const [originalUsername, setOriginalUsername] = useState('')

  // Access control
  useEffect(() => {
    if (!isAdmin()) {
      router.push('/panel0x')
    }
  }, [router])

  // Load users
  useEffect(() => {
    loadUsers()
      .then(res => {
        setUsers(res.users)
        setLoading(false)
      })
      .catch(() => {
        toast('Failed to load users', 'error')
        setLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Znovu načte seznam ze serveru — ten je zdrojem pravdy, ne lokální stav. */
  async function refresh() {
    const res = await loadUsers()
    setUsers(res.users)
  }

  async function handleSaveUser() {
    if (!editUser) return
    if (!editUser.username.trim()) {
      toast('Username is required', 'error')
      return
    }
    if (isNewUser && !newPassword) {
      toast('Password is required for a new user', 'error')
      return
    }
    if (newPassword && newPassword.length < 8) {
      toast('Password must be at least 8 characters', 'error')
      return
    }

    setSaving(true)

    try {
      // Heslo jde na server v čitelné podobě přes HTTPS a hashuje ho Worker.
      // Prohlížeč hashe vůbec nevidí.
      await saveUser({
        username: editUser.username.trim(),
        role: editUser.role,
        permissions: editUser.permissions,
        password: newPassword || undefined,
        originalUsername: isNewUser ? undefined : originalUsername,
        isNew: isNewUser,
      })

      await refresh()
      setEditUser(null)
      setIsNewUser(false)
      setNewPassword('')
      setOriginalUsername('')
      toast(isNewUser ? 'User created' : 'User updated')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save user', 'error')
    }

    setSaving(false)
  }

  async function handleDeleteUser(username: string) {
    if (username.toLowerCase() === getSession()?.username.toLowerCase()) {
      toast("Can't delete your own account", 'error')
      return
    }

    setSaving(true)
    try {
      await deleteUser(username)
      await refresh()
      setDeleteConfirm(null)
      toast('User deleted')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete user', 'error')
    }
    setSaving(false)
  }

  function startNewUser() {
    setEditUser({
      username: '',
      role: 'editor',
      permissions: {
        gallery: ['upload', 'edit'],
        museum: ['upload', 'edit'],
        rosnik: ['upload', 'edit'],
      },
    })
    setIsNewUser(true)
    setNewPassword('')
    setOriginalUsername('')
  }

  function togglePermission(section: Section, perm: Permission) {
    if (!editUser) return
    const current = editUser.permissions[section] || []
    const has = current.includes(perm)
    setEditUser({
      ...editUser,
      permissions: {
        ...editUser.permissions,
        [section]: has ? current.filter(p => p !== perm) : [...current, perm],
      },
    })
  }

  if (!isAdmin()) return null

  return (
    <div className="min-h-dvh bg-dark text-offwhite font-body px-6 py-12">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <button
              onClick={() => router.push('/panel0x')}
              className="inline-flex items-center gap-2 text-[0.78rem] text-muted hover:text-lime transition-colors duration-200 mb-3"
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </button>
            <h1 className="text-xl font-display font-semibold text-offwhite tracking-[-0.02em]">Users</h1>
            <p className="text-[0.78rem] text-muted mt-1">Manage users and their permissions</p>
          </div>
          <button
            onClick={startNewUser}
            className="mt-6 px-4 py-2 text-[0.78rem] font-medium bg-lime/10 text-lime border border-lime/20 rounded-[2px] hover:bg-lime/20 transition-colors duration-200"
          >
            + Add User
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-lime/20 border-t-lime/60 rounded-full animate-spin" />
          </div>
        )}

        {/* Users list */}
        {!loading && !editUser && (
          <div className="flex flex-col gap-3">
            {users.map(user => (
              <div
                key={user.username}
                className="px-5 py-4 bg-charcoal border border-white/[0.05] rounded-[3px] flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[0.95rem] font-medium text-offwhite">{user.username}</p>
                    <span className={`text-[0.6rem] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-[2px] border ${
                      user.role === 'admin'
                        ? 'text-lime/60 border-lime/20 bg-lime/5'
                        : 'text-muted/50 border-white/[0.08] bg-white/[0.02]'
                    }`}>
                      {user.role}
                    </span>
                  </div>
                  <div className="flex gap-3 mt-1.5">
                    {SECTIONS.map(s => {
                      const perms = user.permissions[s.key] || []
                      return (
                        <span key={s.key} className="text-[0.65rem] text-muted/40">
                          {s.label}: {user.role === 'admin' ? 'Full' : perms.length > 0 ? perms.join(', ') : 'None'}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => {
                      setEditUser({ ...user })
                      setIsNewUser(false)
                      setNewPassword('')
                      setOriginalUsername(user.username)
                    }}
                    className="px-3 py-1.5 text-[0.72rem] text-muted border border-white/[0.07] rounded-[2px] hover:text-offwhite hover:border-white/20 transition-colors duration-200"
                  >
                    Edit
                  </button>
                  {user.username.toLowerCase() !== getSession()?.username.toLowerCase() && (
                    deleteConfirm === user.username ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteUser(user.username)}
                          disabled={saving}
                          className="px-3 py-1.5 text-[0.72rem] text-red-400 border border-red-500/30 rounded-[2px] hover:bg-red-500/10 disabled:opacity-40 transition-colors duration-200"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1.5 text-[0.72rem] text-muted hover:text-offwhite transition-colors duration-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(user.username)}
                        className="px-3 py-1.5 text-[0.72rem] text-muted/40 border border-white/[0.05] rounded-[2px] hover:text-red-400 hover:border-red-500/20 transition-colors duration-200"
                      >
                        Delete
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}

            {users.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-muted text-[0.85rem]">No users yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Edit/Create user form */}
        {editUser && (
          <div className="bg-charcoal border border-white/[0.08] rounded-[3px] p-6">
            <h3 className="text-[0.9rem] font-medium text-offwhite mb-5">
              {isNewUser ? 'New User' : `Edit: ${editUser.username}`}
            </h3>

            <div className="space-y-5">
              {/* Username */}
              <div>
                <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">Username</label>
                <input
                  value={editUser.username}
                  onChange={e => setEditUser({ ...editUser, username: e.target.value })}
                  disabled={!isNewUser && editUser.role === 'admin'}
                  placeholder="username"
                  className="w-full max-w-xs px-3 py-2 bg-dark border border-white/[0.08] rounded-[2px] text-[0.8rem] text-offwhite placeholder:text-muted/30 focus:outline-none focus:border-lime/40 disabled:opacity-50"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">
                  {isNewUser ? 'Password' : 'New Password (leave empty to keep current)'}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={isNewUser ? 'Enter password' : 'Leave empty to keep current'}
                  autoComplete="new-password"
                  className="w-full max-w-xs px-3 py-2 bg-dark border border-white/[0.08] rounded-[2px] text-[0.8rem] text-offwhite placeholder:text-muted/30 focus:outline-none focus:border-lime/40"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-1">Role</label>
                <div className="flex gap-2">
                  {(['editor', 'admin'] as const).map(role => (
                    <button
                      key={role}
                      onClick={() => setEditUser({
                        ...editUser,
                        role,
                        permissions: role === 'admin' ? FULL_PERMISSIONS : editUser.permissions,
                      })}
                      className={`px-4 py-2 text-[0.78rem] font-medium rounded-[2px] border transition-colors duration-200 ${
                        editUser.role === role
                          ? 'bg-lime/[0.12] border-lime/30 text-lime'
                          : 'bg-transparent border-white/[0.08] text-muted hover:text-offwhite hover:border-white/20'
                      }`}
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </button>
                  ))}
                </div>
                {editUser.role === 'admin' && (
                  <p className="text-[0.65rem] text-lime/40 mt-1.5">Admin users have full access to all sections</p>
                )}
              </div>

              {/* Permissions — only shown for editors */}
              {editUser.role === 'editor' && (
                <div>
                  <label className="block text-[0.68rem] text-muted/50 uppercase tracking-wide mb-3">Permissions</label>
                  <div className="space-y-3">
                    {SECTIONS.map(section => (
                      <div key={section.key} className="flex items-center gap-4">
                        <span className="text-[0.8rem] text-offwhite/70 w-20">{section.label}</span>
                        <div className="flex gap-2">
                          {PERMISSIONS.map(perm => {
                            const has = editUser.permissions[section.key]?.includes(perm.key)
                            return (
                              <button
                                key={perm.key}
                                onClick={() => togglePermission(section.key, perm.key)}
                                className={`px-3 py-1.5 text-[0.72rem] font-medium rounded-[2px] border transition-colors duration-200 ${
                                  has
                                    ? 'bg-lime/[0.1] border-lime/25 text-lime/70'
                                    : 'bg-transparent border-white/[0.06] text-muted/40 hover:text-muted hover:border-white/[0.12]'
                                }`}
                              >
                                {perm.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-6 pt-5 border-t border-white/[0.05]">
              <button
                onClick={handleSaveUser}
                disabled={saving}
                className="px-4 py-2 text-[0.78rem] font-medium bg-lime/10 text-lime border border-lime/20 rounded-[2px] hover:bg-lime/20 disabled:opacity-40 transition-colors duration-200"
              >
                {saving ? 'Saving...' : isNewUser ? 'Create User' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setEditUser(null); setIsNewUser(false); setNewPassword('') }}
                className="px-4 py-2 text-[0.78rem] font-medium text-muted border border-white/[0.07] rounded-[2px] hover:text-offwhite transition-colors duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
