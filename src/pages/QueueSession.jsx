import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CustomerShell } from '../components/Layouts.jsx'
import { useStore } from '../lib/store.jsx'

// Opened by scanning a personal queue QR: /queue/session/<secret>. The secret proves who the
// customer is; we keep it on this phone and go to the live queue page.
export default function QueueSession() {
  const { secret } = useParams()
  const { act, setSession } = useStore()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    ;(async () => {
      const r = await act('openSession', { session: secret })
      if (!r.ok) return setError(r.error || 'This link is not valid.')
      setSession(secret)
      navigate(`/queue/${r.entryId}`, { replace: true })
    })()
  }, [secret, act, setSession, navigate])

  return (
    <CustomerShell title="Your queue" back="/">
      <div className="p-8 text-center">
        {error ? (
          <>
            <div className="text-5xl">🔒</div>
            <h2 className="mt-3 text-lg font-bold">{error}</h2>
            <p className="mt-1 text-sm text-slate-500">Please scan the QR code at the entrance again or ask the host.</p>
            <Link to="/join-queue" className="btn-primary mt-4">Join the queue</Link>
          </>
        ) : <div className="text-sm text-slate-500">Opening your queue page…</div>}
      </div>
    </CustomerShell>
  )
}
