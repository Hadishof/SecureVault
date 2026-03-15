import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import api from '../api/client'

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [respondingId, setRespondingId] = useState(null)
  const { toasts, addToast } = useToast()
  const navigate = useNavigate()

  const fetchAll = async () => {
    try {
      const [wsRes, invRes] = await Promise.all([
        api.get('/workspaces/'),
        api.get('/invites'),
      ])
      setWorkspaces(wsRes.data)
      setInvites(invRes.data)
    } catch {
      addToast('Failed to load workspaces', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const createWorkspace = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post('/workspaces/', { name: newName })
      setNewName('')
      setShowModal(false)
      addToast('Workspace created!', 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to create workspace', 'error')
    } finally {
      setCreating(false)
    }
  }

  const acceptInvite = async (workspaceId) => {
    setRespondingId(workspaceId)
    try {
      await api.post(`/workspaces/${workspaceId}/accept-invite`)
      addToast('Invite accepted!', 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to accept invite', 'error')
    } finally {
      setRespondingId(null)
    }
  }

  const declineInvite = async (workspaceId) => {
    setRespondingId(workspaceId)
    try {
      await api.delete(`/workspaces/${workspaceId}/decline-invite`)
      setInvites(prev => prev.filter(i => i.workspace_id !== workspaceId))
      addToast('Invite declined', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to decline invite', 'error')
    } finally {
      setRespondingId(null)
    }
  }

  const owned = workspaces.filter(ws => ws.role === 'owner')
  const joined = workspaces.filter(ws => ws.role !== 'owner' && ws.role !== null)

  const WorkspaceCard = ({ ws }) => (
    <div className="workspace-card card" onClick={() => navigate(`/workspace/${ws.id}`)}>
      <div className="workspace-card-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      </div>
      <div>
        <h3>{ws.name}</h3>
      </div>
      <div className="workspace-card-footer">
        <span className="workspace-card-meta">Click to open</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--violet)' }}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Navbar />
      <Toast toasts={toasts} />

      <div className="container">
        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <>
            {/* ── PENDING INVITES ── */}
            {invites.length > 0 && (
              <div style={{ marginBottom: 40 }}>
                <div className="page-header" style={{ marginBottom: 16 }}>
                  <div>
                    <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        background: 'var(--violet)', color: '#fff',
                        borderRadius: '50%', width: 22, height: 22,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700
                      }}>{invites.length}</span>
                      Pending Invites
                    </h1>
                    <p>You've been invited to these workspaces</p>
                  </div>
                </div>
                <div className="workspace-grid">
                  {invites.map(inv => (
                    <div key={inv.workspace_id} className="workspace-card card" style={{ borderColor: 'rgba(139,92,246,0.4)', cursor: 'default' }}>
                      <div className="workspace-card-icon" style={{ background: 'rgba(139,92,246,0.15)' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                      </div>
                      <div>
                        <h3>{inv.workspace_name}</h3>
                        <span style={{ fontSize: '0.78rem', color: 'var(--violet)' }}>Awaiting your response</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ flex: 1, justifyContent: 'center' }}
                          onClick={() => acceptInvite(inv.workspace_id)}
                          disabled={respondingId === inv.workspace_id}
                        >
                          {respondingId === inv.workspace_id ? <span className="spinner-sm" /> : 'Accept'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ flex: 1, justifyContent: 'center' }}
                          onClick={() => declineInvite(inv.workspace_id)}
                          disabled={respondingId === inv.workspace_id}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── MY WORKSPACES (owned) ── */}
            <div style={{ marginBottom: joined.length > 0 ? 40 : 0 }}>
              <div className="page-header" style={{ marginBottom: 16 }}>
                <div>
                  <h1>My Workspaces</h1>
                  <p>{owned.length > 0 ? `${owned.length} workspace${owned.length !== 1 ? 's' : ''} you own` : 'Create your first workspace'}</p>
                </div>
              </div>
              {owned.length === 0 && joined.length === 0 && invites.length === 0 ? (
                <div className="empty-state" style={{ padding: '48px 0' }}>
                  <div className="empty-icon">🔐</div>
                  <p>No workspaces yet</p>
                  <span>Create one to start storing secrets securely</span>
                  <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => setShowModal(true)}>
                    Create Workspace
                  </button>
                </div>
              ) : (
                <div className="workspace-grid">
                  {owned.map(ws => <WorkspaceCard key={ws.id} ws={ws} />)}
                  <button className="new-workspace-card" onClick={() => setShowModal(true)}>
                    <span className="new-workspace-plus">+</span>
                    <p>New Workspace</p>
                  </button>
                </div>
              )}
            </div>

            {/* ── JOINED WORKSPACES ── */}
            {joined.length > 0 && (
              <div>
                <div className="page-header" style={{ marginBottom: 16 }}>
                  <div>
                    <h1>Joined Workspaces</h1>
                    <p>{joined.length} workspace{joined.length !== 1 ? 's' : ''} you're a member of</p>
                  </div>
                </div>
                <div className="workspace-grid">
                  {joined.map(ws => <WorkspaceCard key={ws.id} ws={ws} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-card">
            <div className="modal-header">
              <h2>Create Workspace</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={createWorkspace}>
              <div className="field">
                <label>Workspace Name</label>
                <input
                  className="input"
                  placeholder="e.g. Production Secrets"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? <span className="spinner-sm" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
