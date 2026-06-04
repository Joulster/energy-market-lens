import { Routes, Route } from 'react-router-dom'
import Login        from './pages/Login.jsx'
import Unauthorised from './pages/Unauthorised.jsx'
import AuthGate     from './components/AuthGate.jsx'
import App          from './App.jsx'

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/auth/login"        element={<Login />} />
      <Route path="/auth/unauthorised" element={<Unauthorised />} />
      <Route path="/*" element={
        <AuthGate>
          <App />
        </AuthGate>
      } />
    </Routes>
  )
}
