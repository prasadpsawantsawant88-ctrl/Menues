import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { CustomerShell } from '../components/Layouts.jsx'
import { Confidence, Field, Notice } from '../components/ui.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { predictWait } from '../lib/engines.js'
import { isValidPhone, fmtTime } from '../lib/util.js'
import { maxCapacity } from '../lib/actions.js'

export default function JoinQueue() {
  const { state, act, setSession } = useStore()
  const navigate = useNavigate()
  const now = useNow(10000)
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [name, setName] = useState('')
  const [preference, setPreference] = useState('Any')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const cap = maxCapacity(state)
  const preview = predictWait(state, { partySize: party, preference }, now)
  const phoneOk = isValidPhone(phone)

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    setError('')
    if (!phoneOk) return
    const result = await act('joinQueue', { phone, partySize: party, name, preference })
    if (!result.ok) return setError(result.error)
    if (result.entry.sessionToken) setSession(result.entry.sessionToken)
    navigate(`/queue/${result.entry.id}`, { state: { existing: result.existing, immediate: result.seatedImmediately } })
  }

  return (
    <CustomerShell title="Join the queue" subtitle={state.settings.restaurantName} back="/">
      <form onSubmit={submit} className="space-y-4 p-4">
        <Field label="Mobile number *" hint={touched && !phoneOk ? undefined : 'Used only to avoid duplicate entries. 10-digit Indian mobile number.'}>
          <input className={`input ${touched && !phoneOk ? '!border-red-500' : ''}`} inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} />
          {touched && !phoneOk && <span className="mt-1 block text-xs font-semibold text-red-600">Enter a valid 10-digit mobile number starting with 6–9.</span>}
        </Field>

        <Field label="Number of people *">
          <div className="flex items-center gap-3">
            <button type="button" className="btn-ghost !h-11 !w-11 !p-0 text-xl" onClick={() => setParty(Math.max(1, party - 1))} aria-label="Fewer people">−</button>
            <div className="flex-1 rounded-xl border border-slate-300 py-2 text-center text-xl font-extrabold"><Users size={16} className="mr-1 inline text-slate-400" />{party}</div>
            <button type="button" className="btn-ghost !h-11 !w-11 !p-0 text-xl" onClick={() => setParty(Math.min(cap, party + 1))} aria-label="More people">+</button>
          </div>
        </Field>

        <Field label="Your name (optional)">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="So we can greet you" />
        </Field>

        <Field label="Seating preference (optional)">
          <div className="flex gap-2">
            {['Any', 'Indoor', 'Outdoor', 'Window'].map((p) => (
              <button type="button" key={p} onClick={() => setPreference(p)} className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${preference === p ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>{p}</button>
            ))}
          </div>
        </Field>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Right now for a party of {party}</div>
          {preview.possible ? (
            <>
              <div className="mt-1 text-2xl font-extrabold">{preview.waitMin === 0 ? 'A table is free' : `About ${preview.waitMin} min`}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                {preview.groupsAhead} group{preview.groupsAhead === 1 ? '' : 's'} ahead · seating around {fmtTime(preview.seatAt)} <Confidence level={preview.confidence} />
              </div>
            </>
          ) : <div className="mt-1 text-sm">Please ask the host for a group this large.</div>}
          <div className="mt-1 text-xs text-slate-400">Estimate only. It changes as tables free up.</div>
        </div>

        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn-primary w-full !py-3 text-base" type="submit">Continue</button>
      </form>
    </CustomerShell>
  )
}
