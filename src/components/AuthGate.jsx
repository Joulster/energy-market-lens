import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const AuthContext = createContext(null)

export function useUser() {
  return useContext(AuthContext)
}

export default function AuthGate({ children }) {
  const navigate = useNavigate()
  const [user,    setUser]    = useState(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => {
        if (res.status === 401) {
          navigate('/auth/login', { replace: true })
          return null
        }
        return res.json()
      })
      .then(data => {
        if (data) {
          setUser(data)
          setChecked(true)
        }
      })
      .catch(() => navigate('/auth/login', { replace: true }))
  }, [navigate])

  if (!checked) {
    return (
      <div className="auth-page">
        <p style={{ color: '#475569', fontSize: 13 }}>Loading</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={user}>
      {children}
    </AuthContext.Provider>
  )
}
