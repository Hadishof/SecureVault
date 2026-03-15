import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import api from '../api/client'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export default function WorkspacePage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toasts, addToast } = useToast()

  const [workspace, setWorkspace] = useState(null)
  const [secrets, setSecrets] = useState([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState({})

  // Workspace rename
  const [editingName, setEditingName] = useState(false)
  const [newWsName, setNewWsName] = useState('')
  const nameInputRef = useRef(null)

  // Add secret
  const [newSecret, setNewSecret] = useState({ key_name: '', plaintext_value: '' })
  const [addingSecret, setAddingSecret] = useState(false)
  const [showAddSecret, setShowAddSecret] = useState(false)

  // Edit secret
  const [editingSecret, setEditingSecret] = useState(null) // { id, key_name, plaintext_value }
  const [secretSearch, setSecretSearch] = useState('')

  // Invite
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const [deleting, setDeleting] = useState(false)

  // Secret requests
  const [requests, setRequests] = useState([])
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [newRequest, setNewRequest] = useState({ key_name: '', plaintext_value: '' })
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [previewedRequests, setPreviewedRequests] = useState({}) // { reqId: plaintext }

  // Activity log (owner only)
  const [logs, setLogs] = useState([])
  const [showLogs, setShowLogs] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [deletingLogId, setDeletingLogId] = useState(null)

  const fetchAll = async () => {
    try {
      const [wsRes, secRes] = await Promise.all([
        api.get(`/workspaces/${id}`),
        api.get(`/workspaces/${id}/secrets`),
      ])
      setWorkspace(wsRes.data)
      setSecrets(secRes.data)
      // fetch pending requests for owner (will be ignored for viewers)
      const myRole = wsRes.data.members?.find(m => m.email === user?.email)?.role
      if (myRole === 'owner') {
        api.get(`/workspaces/${id}/secret-requests`).then(r => setRequests(r.data)).catch(() => {})
      }
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 404) navigate('/dashboard')
      else addToast('Failed to load workspace', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [id])

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.focus()
  }, [editingName])

  const isOwner = workspace?.members?.find(m => m.email === user?.email)?.role === 'owner'

  const fetchLogs = async () => {
    setLogsLoading(true)
    try {
      const res = await api.get(`/workspaces/${id}/logs`)
      setLogs(res.data)
    } catch {
      addToast('Failed to load activity', 'error')
    } finally {
      setLogsLoading(false)
    }
  }

  const toggleLogs = () => {
    if (!showLogs && logs.length === 0) fetchLogs()
    setShowLogs(v => !v)
  }

  const hideLog = async (logId) => {
    setDeletingLogId(logId)
    try {
      await api.delete(`/workspaces/${id}/logs/${logId}`)
      setLogs(prev => prev.filter(l => l.id !== logId))
    } catch {
      addToast('Failed to remove log entry', 'error')
    } finally {
      setDeletingLogId(null)
    }
  }

  // ── SECRET REQUESTS ───────────────────────────────────────
  const submitRequest = async (e) => {
    e.preventDefault()
    setSubmittingRequest(true)
    try {
      await api.post(`/workspaces/${id}/secret-requests`, newRequest)
      setNewRequest({ key_name: '', plaintext_value: '' })
      setShowRequestForm(false)
      addToast('Request submitted! The owner will review it.', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to submit request', 'error')
    } finally {
      setSubmittingRequest(false)
    }
  }

  const approveRequest = async (reqId) => {
    try {
      const res = await api.post(`/workspaces/${id}/secret-requests/${reqId}/approve`)
      setSecrets(prev => [...prev, res.data])
      setRequests(prev => prev.filter(r => r.id !== reqId))
      addToast('Request approved — secret added!', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to approve', 'error')
    }
  }

  const rejectRequest = async (reqId) => {
    try {
      await api.delete(`/workspaces/${id}/secret-requests/${reqId}`)
      setRequests(prev => prev.filter(r => r.id !== reqId))
      setPreviewedRequests(prev => { const n = { ...prev }; delete n[reqId]; return n })
      addToast('Request rejected', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to reject', 'error')
    }
  }

  const togglePreviewRequest = async (reqId) => {
    if (previewedRequests[reqId] !== undefined) {
      setPreviewedRequests(prev => { const n = { ...prev }; delete n[reqId]; return n })
      return
    }
    try {
      const res = await api.get(`/workspaces/${id}/secret-requests/${reqId}/preview`)
      setPreviewedRequests(prev => ({ ...prev, [reqId]: res.data.plaintext }))
    } catch (err) {
      addToast('Failed to load preview', 'error')
    }
  }

  // ── WORKSPACE RENAME ──────────────────────────────────────
  const startRename = () => {
    setNewWsName(workspace.name)
    setEditingName(true)
  }

  const saveRename = async (e) => {
    e.preventDefault()
    if (!newWsName.trim() || newWsName === workspace.name) { setEditingName(false); return }
    try {
      const res = await api.patch(`/workspaces/${id}`, { name: newWsName })
      setWorkspace(prev => ({ ...prev, name: res.data.name }))
      setEditingName(false)
      addToast('Workspace renamed!', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to rename', 'error')
    }
  }

  // ── SECRET REVEAL ──────────────────────────────────────────
  const revealSecret = async (secretId) => {
    if (revealed[secretId]) {
      setRevealed(prev => { const n = { ...prev }; delete n[secretId]; return n })
      return
    }
    try {
      const res = await api.get(`/secrets/${secretId}/reveal`)
      setRevealed(prev => ({ ...prev, [secretId]: res.data.plaintext }))
    } catch {
      addToast('Failed to reveal secret', 'error')
    }
  }

  // ── SECRET DELETE ──────────────────────────────────────────
  const deleteSecret = async (secretId, keyName) => {
    if (!confirm(`Delete secret "${keyName}"?`)) return
    try {
      await api.delete(`/secrets/${secretId}`)
      setSecrets(prev => prev.filter(s => s.id !== secretId))
      addToast('Secret deleted', 'success')
    } catch {
      addToast('Failed to delete secret', 'error')
    }
  }

  // ── SECRET ADD ────────────────────────────────────────────
  const addSecret = async (e) => {
    e.preventDefault()
    setAddingSecret(true)
    try {
      const res = await api.post('/secrets/', { ...newSecret, workspace_id: Number(id) })
      setSecrets(prev => [...prev, res.data])
      setNewSecret({ key_name: '', plaintext_value: '' })
      setShowAddSecret(false)
      addToast('Secret added!', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to add secret', 'error')
    } finally {
      setAddingSecret(false)
    }
  }

  // ── SECRET EDIT ───────────────────────────────────────────
  const startEditSecret = (secret) => {
    setEditingSecret({ id: secret.id, key_name: secret.key_name, plaintext_value: '' })
  }

  const saveEditSecret = async (e) => {
    e.preventDefault()
    const payload = {}
    if (editingSecret.key_name.trim()) payload.key_name = editingSecret.key_name
    if (editingSecret.plaintext_value) payload.plaintext_value = editingSecret.plaintext_value
    if (!Object.keys(payload).length) { setEditingSecret(null); return }
    try {
      const res = await api.patch(`/secrets/${editingSecret.id}`, payload)
      setSecrets(prev => prev.map(s => s.id === res.data.id ? res.data : s))
      setRevealed(prev => { const n = { ...prev }; delete n[editingSecret.id]; return n })
      setEditingSecret(null)
      addToast('Secret updated!', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to update secret', 'error')
    }
  }

  // ── INVITE ────────────────────────────────────────────────
  const inviteUser = async (e) => {
    e.preventDefault()
    setInviting(true)
    try {
      await api.post(`/workspaces/${id}/invite`, { email: inviteEmail })
      setInviteEmail('')
      addToast(`${inviteEmail} invited!`, 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to invite user', 'error')
    } finally {
      setInviting(false)
    }
  }

  // ── REMOVE MEMBER ─────────────────────────────────────────
  const removeMember = async (email) => {
    if (!confirm(`Remove ${email} from workspace?`)) return
    try {
      await api.delete(`/workspaces/${id}/members`, { data: { email } })
      addToast(`${email} removed`, 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to remove member', 'error')
    }
  }

  // ── DELETE WORKSPACE ──────────────────────────────────────
  const deleteWorkspace = async () => {
    if (!confirm(`Delete workspace "${workspace?.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.delete(`/workspaces/${id}`)
      navigate('/dashboard')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to delete workspace', 'error')
      setDeleting(false)
    }
  }

  // ── LEAVE WORKSPACE ───────────────────────────────────────
  const leaveWorkspace = async () => {
    if (!confirm(`Leave workspace "${workspace?.name}"?`)) return
    setDeleting(true)
    try {
      await api.delete(`/workspaces/${id}/leave`)
      navigate('/dashboard')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to leave workspace', 'error')
      setDeleting(false)
    }
  }

  if (loading) return (
    <div className="page"><Navbar /><div className="spinner-wrap"><div className="spinner" /></div></div>
  )

  return (
    <div className="page">
      <Navbar />
      <Toast toasts={toasts} />

      <div className="container workspace-page">
        <div className="workspace-page-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {editingName ? (
            <form onSubmit={saveRename} style={{ flex: 1, display: 'flex', gap: 8 }}>
              <input
                ref={nameInputRef}
                className="input"
                value={newWsName}
                onChange={e => setNewWsName(e.target.value)}
                style={{ maxWidth: 320 }}
                required
              />
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingName(false)}>Cancel</button>
            </form>
          ) : (
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {workspace?.name}
              {isOwner && (
                <button className="btn btn-ghost btn-sm" onClick={startRename} title="Rename workspace">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
            </h1>
          )}

          {isOwner && !editingName && (
            <button className="btn btn-danger btn-sm" onClick={deleteWorkspace} disabled={deleting}>
              {deleting ? <span className="spinner-sm" /> : 'Delete'}
            </button>
          )}
          {!isOwner && (
            <button className="btn btn-secondary btn-sm" onClick={leaveWorkspace} disabled={deleting}>
              {deleting ? <span className="spinner-sm" /> : 'Leave Workspace'}
            </button>
          )}
        </div>

        <div className="workspace-layout">
          {/* ── SECRETS ── */}
          <div>
            <div className="section-header">
              <span className="section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Secrets ({secrets.length})
              </span>
              {isOwner
                ? <button className="btn btn-primary btn-sm" onClick={() => setShowAddSecret(v => !v)}>
                    {showAddSecret ? 'Cancel' : '+ Add Secret'}
                  </button>
                : <button className="btn btn-secondary btn-sm" onClick={() => setShowRequestForm(v => !v)}>
                    {showRequestForm ? 'Cancel' : '+ Request Secret'}
                  </button>
              }
            </div>

            {secrets.length > 3 && (
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input className="input" placeholder="Filter secrets..."
                  value={secretSearch} onChange={e => setSecretSearch(e.target.value)}
                  style={{ paddingLeft: 36 }} />
              </div>
            )}

            {isOwner && showAddSecret && (
              <form className="add-form card" onSubmit={addSecret}>
                <h3>New Secret</h3>
                <div className="field">
                  <label>Key Name</label>
                  <input className="input" placeholder="e.g. DATABASE_URL"
                    value={newSecret.key_name} onChange={e => setNewSecret(p => ({ ...p, key_name: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>Secret Value</label>
                  <input className="input" placeholder="The secret value to encrypt"
                    value={newSecret.plaintext_value} onChange={e => setNewSecret(p => ({ ...p, plaintext_value: e.target.value }))} required />
                </div>
                <button className="btn btn-primary" type="submit" disabled={addingSecret}>
                  {addingSecret ? <span className="spinner-sm" /> : 'Save Secret'}
                </button>
              </form>
            )}

            {!isOwner && showRequestForm && (
              <form className="add-form card" onSubmit={submitRequest}>
                <h3>Request a Secret</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 12 }}>
                  The owner will review your request before it's added.
                </p>
                <div className="field">
                  <label>Key Name</label>
                  <input className="input" placeholder="e.g. API_KEY"
                    value={newRequest.key_name} onChange={e => setNewRequest(p => ({ ...p, key_name: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>Secret Value</label>
                  <input className="input" type="password" placeholder="The secret value"
                    value={newRequest.plaintext_value} onChange={e => setNewRequest(p => ({ ...p, plaintext_value: e.target.value }))} required />
                </div>
                <button className="btn btn-primary" type="submit" disabled={submittingRequest}>
                  {submittingRequest ? <span className="spinner-sm" /> : 'Submit Request'}
                </button>
              </form>
            )}

            {secrets.length === 0 && !showAddSecret && !showRequestForm ? (
              <div className="empty-state">
                <div className="empty-icon">🔑</div>
                <p>No secrets yet</p>
                <span>Add your first secret above</span>
              </div>
            ) : (
              <div className="secrets-list">
                {secrets.filter(s => s.key_name.toLowerCase().includes(secretSearch.toLowerCase())).map(secret => (
                  <div key={secret.id} className="secret-card card">
                    <div className="secret-card-main">
                      <div className="secret-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <div className="secret-info">
                        <div className="secret-name">{secret.key_name}</div>
                        <div className="secret-date">{formatDate(secret.created_at)}</div>
                      </div>
                      <div className="secret-actions">
                        <button className={`btn btn-sm ${revealed[secret.id] ? 'btn-secondary' : 'btn-cyan'}`}
                          onClick={() => revealSecret(secret.id)}>
                          {revealed[secret.id] ? 'Hide' : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                              </svg>
                              Reveal
                            </>
                          )}
                        </button>
                        {isOwner && <>
                          <button className="btn btn-icon btn-sm" onClick={() => startEditSecret(secret)} title="Edit secret">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button className="btn btn-icon btn-sm btn-danger-icon" onClick={() => deleteSecret(secret.id, secret.key_name)} title="Delete secret">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </>}
                      </div>
                    </div>

                    {revealed[secret.id] && (
                      <div className="secret-value-box">
                        <span>{revealed[secret.id]}</span>
                        <button onClick={() => navigator.clipboard.writeText(revealed[secret.id]).then(() => addToast('Copied!', 'success'))}>
                          Copy
                        </button>
                      </div>
                    )}

                    {editingSecret?.id === secret.id && (
                      <form className="secret-edit-form" onSubmit={saveEditSecret}>
                        <div className="secret-edit-row">
                          <div className="field" style={{ flex: 1 }}>
                            <label>Rename Key</label>
                            <input className="input" value={editingSecret.key_name}
                              onChange={e => setEditingSecret(p => ({ ...p, key_name: e.target.value }))} />
                          </div>
                          <div className="field" style={{ flex: 1 }}>
                            <label>New Value <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(leave empty to keep current)</span></label>
                            <input className="input" type="password" placeholder="••••••••"
                              value={editingSecret.plaintext_value}
                              onChange={e => setEditingSecret(p => ({ ...p, plaintext_value: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button type="submit" className="btn btn-primary btn-sm">Save</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSecret(null)}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          {/* ── PENDING REQUESTS (owner only) ── */}
          {isOwner && requests.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="section-header">
                <span className="section-title" style={{ color: 'var(--violet)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Pending Requests ({requests.length})
                </span>
              </div>
              <div className="secrets-list">
                {requests.map(req => (
                  <div key={req.id} className="secret-card card" style={{ borderColor: 'rgba(139,92,246,0.3)' }}>
                    <div className="secret-card-main">
                      <div className="secret-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                      </div>
                      <div className="secret-info">
                        <div className="secret-name">{req.key_name}</div>
                        <div className="secret-date">Requested by {req.requester_email}</div>
                      </div>
                      <div className="secret-actions">
                        <button className={`btn btn-sm ${previewedRequests[req.id] !== undefined ? 'btn-secondary' : 'btn-cyan'}`}
                          onClick={() => togglePreviewRequest(req.id)}>
                          {previewedRequests[req.id] !== undefined ? 'Hide' : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                              Show Value
                            </>
                          )}
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => approveRequest(req.id)}>Approve</button>
                        <button className="btn btn-danger btn-sm" onClick={() => rejectRequest(req.id)}>Reject</button>
                      </div>
                    </div>
                    {previewedRequests[req.id] !== undefined && (
                      <div className="secret-value-box">
                        <span>{previewedRequests[req.id]}</span>
                        <button onClick={() => navigator.clipboard.writeText(previewedRequests[req.id]).then(() => addToast('Copied!', 'success'))}>
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          {/* ── MEMBERS ── */}
          <div>
            <div className="section-header">
              <span className="section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Members ({workspace?.members?.length})
              </span>
            </div>

            <div className="member-list">
              {workspace?.members?.map(member => (
                <div key={member.id} className="member-item card"
                  style={member.status === 'pending' ? { opacity: 0.7, borderColor: 'rgba(139,92,246,0.25)' } : {}}>
                  <div className="member-avatar" style={member.status === 'pending' ? { background: 'rgba(139,92,246,0.2)' } : {}}>
                    {member.email[0].toUpperCase()}
                  </div>
                  <div className="member-info">
                    <div className="member-email">{member.email}</div>
                    {member.status === 'pending' && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--violet)', marginTop: 2 }}>Invite pending</div>
                    )}
                  </div>
                  {member.status === 'pending'
                    ? <span className="role-badge" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', borderColor: 'rgba(139,92,246,0.3)' }}>PENDING</span>
                    : <span className={`role-badge ${member.role}`}>{member.role?.toUpperCase()}</span>
                  }
                  {isOwner && member.role !== 'owner' && (
                    <button className="btn btn-icon btn-sm" onClick={() => removeMember(member.email)}
                      title={member.status === 'pending' ? 'Cancel invite' : 'Remove member'}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isOwner && (
              <form className="invite-form" onSubmit={inviteUser}>
                <h3>Invite Member</h3>
                <div className="field">
                  <input className="input" type="email" placeholder="email@example.com"
                    value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required />
                </div>
                <button className="btn btn-primary" type="submit" disabled={inviting}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  {inviting ? <span className="spinner-sm" /> : 'Send Invite'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* ── ACTIVITY LOG (owner only) ── */}
        {isOwner && (
          <div className="activity-section">
            <button className="activity-toggle" onClick={toggleLogs}>
              <span className="section-title" style={{ marginBottom: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Workspace Activity
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: showLogs ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showLogs && (
              <div className="activity-body">
                {logsLoading ? (
                  <div className="spinner-wrap" style={{ padding: 24 }}><div className="spinner" /></div>
                ) : logs.length === 0 ? (
                  <div className="empty-state" style={{ padding: '24px 0' }}>
                    <p style={{ fontSize: '0.9rem' }}>No activity yet</p>
                    <span>Logs will appear when secrets are revealed</span>
                  </div>
                ) : (
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Secret</th>
                        <th>Action</th>
                        <th>When</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <tr key={log.id}>
                          <td className="log-email">{log.user_email}</td>
                          <td style={{ color: 'var(--cyan)', fontFamily: 'monospace', fontSize: '0.84rem' }}>{log.secret_name}</td>
                          <td><span className="action-badge">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                            </svg>
                            {log.action.replace(/_/g, ' ')}
                          </span></td>
                          <td className="log-time">{formatDateTime(log.timestamp)}</td>
                          <td>
                            <button
                              className="btn btn-icon"
                              style={{ color: 'var(--muted)', padding: '2px 6px' }}
                              onClick={() => hideLog(log.id)}
                              disabled={deletingLogId === log.id}
                              title="Remove from workspace activity"
                            >
                              {deletingLogId === log.id
                                ? <span className="spinner-sm" />
                                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              }
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
