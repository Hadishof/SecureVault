import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const switchMode = (m) => {
    setMode(m)
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      if (mode === 'register') {
        await api.post('/register', { email, password })
        setSuccess('Account created! You can now sign in.')
        setMode('login')
        setPassword('')
        return
      }

      const formData = new URLSearchParams()
      formData.append('username', email)
      formData.append('password', password)
      const res = await api.post('/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      login(res.data.access_token, email)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-header">
          <div className="login-icon">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
              <defs>
                <linearGradient id="lockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff4d48" />
                  <stop offset="100%" stopColor="#ff8c42" />
                </linearGradient>
              </defs>
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="url(#lockGrad)" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#lockGrad)" />
              <circle cx="12" cy="16" r="1.5" fill="url(#lockGrad)" />
            </svg>
          </div>
          <h1>SecureVault</h1>
          <p>Your secrets, encrypted and safe</p>
        </div>

        <div className="login-toggle">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            Sign In
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
            Register
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
          >
            {loading
              ? <span className="spinner-sm" />
              : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
