import { useNavigate } from 'react-router-dom'

const CONTACT_EMAIL = 'shobhit.chitkara@gmail.com'

export default function Unauthorised() {
  const navigate = useNavigate()

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-center">
        <div className="auth-lock-icon">🔒</div>
        <h2 className="auth-title">Access Restricted</h2>
        <p className="auth-body">
          Your account has not been provisioned. To request access email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="auth-link">{CONTACT_EMAIL}</a>.
        </p>
        <button className="auth-btn" onClick={() => navigate('/auth/login')}>
          Back to Login
        </button>
      </div>
    </div>
  )
}
