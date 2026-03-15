import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState, useEffect } from 'react'
import api from '../api/client'

function useSessionTimer() {
  const [secondsLeft, setSecondsLeft] = useState(null)

  useEffect(() => {
    const calc = () => {
      const token = localStorage.getItem('token')
      if (!token) return setSecondsLeft(null)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const diff = Math.floor(payload.exp - Date.now() / 1000)
        setSecondsLeft(diff > 0 ? diff : 0)
      } catch {
        setSecondsLeft(null)
      }
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [])

  return secondsLeft
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const secondsLeft = useSessionTimer()

  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const openChangePw = () => {
    setPwForm({ current_password: '', new_password: '', confirm: '' })
    setPwError('')
    setPwSuccess(false)
    setShowChangePw(true)
  }

  const submitChangePw = async (e) => {
    e.preventDefault()
    setPwError('')
    if (pwForm.new_password !== pwForm.confirm) {
      setPwError('New passwords do not match')
      return
    }
    setPwLoading(true)
    try {
      await api.post('/change-password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      })
      setPwSuccess(true)
      setTimeout(() => setShowChangePw(false), 1500)
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to change password')
    } finally {
      setPwLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const formatTime = (s) => {
    if (s === null) return null
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const isExpiringSoon = secondsLeft !== null && secondsLeft < 300
  const isExpired = secondsLeft === 0

  return (
    <>
    <nav className="navbar">
      <div className="container">
        <div className="navbar-inner">
          <Link to="/dashboard" className="navbar-logo">
            <div className="navbar-logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            SecureVault
          </Link>
          <div className="navbar-actions">
            {secondsLeft !== null && (
              <span className="session-timer" style={{ color: isExpiringSoon ? (isExpired ? 'var(--danger)' : '#f59e0b') : 'var(--text-dim)' }}
                title="Session expires in">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {isExpired ? 'Session expired' : formatTime(secondsLeft)}
              </span>
            )}
            <Link to="/logs" className="btn btn-ghost btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Audit Logs
            </Link>
            <span className="navbar-email">{user?.email}</span>
            <button onClick={openChangePw} className="btn btn-ghost btn-sm" title="Change password">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                <path d="M12 16v-2" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={handleLogout} className="btn btn-secondary btn-sm">Sign Out</button>
          </div>
        </div>
      </div>

    </nav>

      {showChangePw && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowChangePw(false)}>
          <div className="modal-card">
            <div className="modal-header">
              <h2>Change Password</h2>
              <button className="modal-close" onClick={() => setShowChangePw(false)}>✕</button>
            </div>
            {pwSuccess ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--success)' }}>
                ✓ Password changed successfully
              </div>
            ) : (
              <form onSubmit={submitChangePw}>
                {pwError && <div className="alert-error" style={{ marginBottom: 16 }}>{pwError}</div>}
                <div className="field">
                  <label>Current Password</label>
                  <input className="input" type="password" value={pwForm.current_password}
                    onChange={e => setPwForm(p => ({ ...p, current_password: e.target.value }))}
                    autoFocus required />
                </div>
                <div className="field">
                  <label>New Password</label>
                  <input className="input" type="password" placeholder="Min. 8 characters"
                    value={pwForm.new_password}
                    onChange={e => setPwForm(p => ({ ...p, new_password: e.target.value }))}
                    required />
                </div>
                <div className="field">
                  <label>Confirm New Password</label>
                  <input className="input" type="password"
                    value={pwForm.confirm}
                    onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                    required />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowChangePw(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                    {pwLoading ? <span className="spinner-sm" /> : 'Update Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
