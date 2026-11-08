import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { CustomerShell } from '../components/Layouts.jsx'
import MenuBrowser from '../components/MenuBrowser.jsx'
import { OrderCard } from '../components/OrderStatus.jsx'
import { Notice, Field } from '../components/ui.jsx'
import { useStore } from '../lib/store.jsx'
import { fmtTime } from '../lib/util.js'

export default function TableOrder() {
  const { tableId } = useParams()
  const navigate = useNavigate()
  const { state, act } = useStore()
  const [party, setParty] = useState(2)
  const [error, setError] = useState('')
  const table = state.tables.find((t) => t.id === tableId.toUpperCase())

  if (!table) {
    return (
      <CustomerShell title="Table" back="/">
        <div className="p-6 text-center text-sm text-slate-500">This QR code does not match any table of {state.settings.restaurantName}.</div>
      </CustomerShell>
    )
  }

  const session = state.sessions.find((s) => s.id === table.sessionId && s.status === 'active')
  const orders = session ? state.orders.filter((o) => o.sessionId === session.id).sort((a, b) => b.createdAt - a.createdAt) : []

  if (!session) {
    return (
      <CustomerShell title={`Table ${table.id}`} subtitle={`${table.capacity} seats · ${table.zone}`} back="/">
        <div className="space-y-4 p-4">
          <div className="rounded-3xl bg-slate-50 p-6 text-center">
            <QrCode className="mx-auto text-slate-400" size={36} />
            <h2 className="mt-2 text-lg font-extrabold">Table {table.id} has no active seating yet</h2>
            <p className="mt-1 text-sm text-slate-600">
              {table.status === 'reserved' ? 'This table is being held for a waiting group.' : table.status === 'cleaning' ? 'This table is being cleaned.' : 'Please ask the host to seat you first, then scan again.'}
            </p>
          </div>
          {table.status === 'available' && (
            <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
              <div className="text-xs font-bold uppercase text-amber-800">Demo shortcut</div>
              <p className="mb-2 text-sm text-amber-900">In real life the host seats you. For the demo you can seat a walk-in party here to try QR ordering.</p>
              <Field label="Party size"><input className="input" type="number" min={1} max={table.capacity} value={party} onChange={(e) => setParty(e.target.value)} /></Field>
              {error && <div className="mt-2"><Notice tone="bad">{error}</Notice></div>}
              <button className="btn-primary mt-3 w-full" onClick={async () => { const r = await act('seatWalkIn', { tableId: table.id, partySize: party }); if (!r.ok) setError(r.error) }}>Seat this party now (demo)</button>
            </div>
          )}
        </div>
      </CustomerShell>
    )
  }

  return (
    <CustomerShell title={`Table ${table.id}`} subtitle={`Party of ${session.partySize} · seated ${fmtTime(session.seatedAt)}`} back="/">
      {orders.length > 0 && (
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-extrabold">Your orders</h2>
          {orders.map((o) => <OrderCard key={o.id} order={o} allowCancel onCancelItem={(i) => act('cancelOrderItem', { orderItemId: i.id })} />)}
        </div>
      )}
      <MenuBrowser mode="qr" table={table} onPaid={(id) => navigate(`/order/${id}`)} />
    </CustomerShell>
  )
}
