import axios from 'axios'

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000',
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    // Don't redirect on login/register endpoints — let the component handle the error
    const url = err.config?.url || ''
    if (err.response?.status === 401 && !url.includes('/login') && !url.includes('/register')) {
      localStorage.removeItem('token')
      localStorage.removeItem('email')
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export default api
