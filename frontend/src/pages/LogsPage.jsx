import { useState, useEffect } from 'react'
import Navbar from '../components/Navbar'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import api from '../api/client'

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export default function LogsPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const { toasts, addToast } = useToast()

  useEffect(() => {
    api.get('/logs')
      .then(res => setLogs(res.data))
      .catch(() => addToast('Failed to load logs', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const clearLogs = async () => {
    if (!window.confirm('Clear all audit logs? This cannot be undone.')) return
    setClearing(true)
    try {
      await api.delete('/logs')
      setLogs([])
      addToast('Audit logs cleared', 'success')
    } catch {
      addToast('Failed to clear logs', 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="page">
      <Navbar />
      <Toast toasts={toasts} />

      <div className="container logs-page">
        <div className="page-header">
          <div>
            <h1>Audit Logs</h1>
            <p>Track all secret access in your workspaces</p>
          </div>
          {logs.length > 0 && (
            <button className="btn btn-danger" onClick={clearLogs} disabled={clearing}>
              {clearing ? <span className="spinner-sm" /> : 'Clear All'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>No activity yet</p>
            <span>Logs will appear here when secrets are revealed</span>
          </div>
        ) : (
          <div className="logs-table-wrap card">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Action</th>
                  <th>Secret</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="log-email">{log.user_email}</td>
                    <td>
                      <span className="action-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--cyan)', fontFamily: 'monospace', fontSize: '0.84rem' }}>
                      {log.secret_name || `#${log.target_id}`}
                    </td>
                    <td className="log-time">{formatDateTime(log.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
