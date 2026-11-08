import { useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Modal, Notice } from './ui.jsx'
import { useStore } from '../lib/store.jsx'
import { fmtMoney } from '../lib/util.js'

// Simulated payment for the demo: press Pay, the payment succeeds, the order is saved as paid in the
// shared database and every screen (kitchen, staff, admin) updates. No payment provider, no card details.
export default function PaymentModal({ orderId, onClose, onPaid }) {
  const { state, act } = useStore()
  const order = state.orders.find((o) => o.id === orderId)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(`pay-${orderId}`) // same key on a double tap: the order can only be paid once

  if (!order) return null
  const items = state.orderItems.filter((i) => i.orderId === order.id)

  const pay = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const r = await act('payOrder', { orderId: order.id, mode: 'demo', outcome: 'success', idempotencyKey: key.current })
    if (!r.ok) {
      setBusy(false)
      return setError(r.error)
    }
    setDone(true)
    setTimeout(() => onPaid(order.id), 1400) // show the success message, then go to the next page
  }

  if (done) {
    return (
      <Modal title="Payment" onClose={() => {}}>
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500" size={64} />
          <div className="mt-3 text-2xl font-extrabold">Payment successful</div>
          <div className="mt-1 text-sm text-slate-600">{fmtMoney(order.total)} for order {order.orderNo}. Your order is now with the kitchen.</div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Pay for order ${order.orderNo}`} onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          {items.map((i) => (
            <div key={i.id} className="flex justify-between py-0.5">
              <span>{i.qty} × {i.name}</span>
              <span>{fmtMoney(i.unitPrice * i.qty)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-slate-600"><span>Subtotal</span><span>{fmtMoney(order.subtotal)}</span></div>
          <div className="flex justify-between text-slate-600"><span>GST ({state.settings.gstPercent}%)</span><span>{fmtMoney(order.tax)}</span></div>
          <div className="mt-1 flex justify-between text-base font-extrabold"><span>Total</span><span>{fmtMoney(order.total)}</span></div>
        </div>
        <Notice tone="info">Demo payment: no real money moves and no card details are needed.</Notice>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn-primary w-full !py-3 text-base" disabled={busy} onClick={pay}>{busy ? 'Processing…' : `Pay ${fmtMoney(order.total)}`}</button>
      </div>
    </Modal>
  )
}
