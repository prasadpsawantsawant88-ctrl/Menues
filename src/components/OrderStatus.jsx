import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useStore, useNow } from '../lib/store.jsx'
import { computeKitchenPlan } from '../lib/engines.js'
import { fmtMoney, fmtTime, MIN } from '../lib/util.js'
import { StatusChip, VegMark } from './ui.jsx'

export function useKitchenPlan() {
  const { state } = useStore()
  const now = useNow(5000)
  const plan = useMemo(() => computeKitchenPlan(state, now), [state.tasks, state.stations, now])
  return { plan, now }
}

const STEPS = [
  ['confirmed', 'Ordered'],
  ['received', 'In kitchen'],
  ['preparing', 'Preparing'],
  ['ready', 'Ready'],
  ['served', 'Served'],
]
const ORDER_RANK = { pending_payment: -1, confirmed: 0, scheduled: 0, received: 1, preparing: 2, ready: 3, served: 4 }

export function ProgressBar({ status }) {
  const rank = ORDER_RANK[status] ?? 0
  return (
    <div className="flex items-center">
      {STEPS.map(([key, label], i) => {
        const done = i <= rank
        return (
          <div key={key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{done ? <Check size={13} /> : i + 1}</div>
              <div className={`mt-1 text-[10px] font-semibold ${done ? 'text-brand-700' : 'text-slate-400'}`}>{label}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`mx-1 mb-4 h-0.5 flex-1 ${i < rank ? 'bg-brand-600' : 'bg-slate-200'}`} />}
          </div>
        )
      })}
    </div>
  )
}

function etaText(task, plan, now) {
  if (!task) return ''
  if (task.status === 'scheduled') return `Cooking starts ~${fmtTime(task.scheduledStart)} · ready ~${fmtTime(task.estReady)}`
  if (task.status === 'received' || task.status === 'preparing') {
    const p = plan.plans[task.id]
    if (!p) return ''
    const mins = Math.max(1, Math.ceil((p.end - now) / MIN))
    return task.status === 'preparing' ? `About ${mins} min left` : `Ready in about ${mins} min`
  }
  if (task.status === 'ready') return 'Ready'
  if (task.status === 'served') return 'Served'
  if (task.status === 'cancelled') return 'Cancelled and refunded'
  return ''
}

const MODE_LABEL = { demo: 'Demo payment (no real money)' }

export function OrderCard({ order, allowCancel = false, onCancelItem, link = true }) {
  const { state } = useStore()
  const { plan, now } = useKitchenPlan()
  const items = state.orderItems.filter((i) => i.orderId === order.id)
  const tasks = state.tasks.filter((t) => t.orderId === order.id)
  const live = tasks.filter((t) => ['scheduled', 'received', 'preparing'].includes(t.status))
  const delayed = tasks.find((t) => t.delayNote && live.includes(t))
  const readyAt = live.length ? Math.max(...live.map((t) => (t.status === 'scheduled' ? t.estReady : plan.plans[t.id]?.end || now))) : null

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold">Order {order.orderNo}</div>
          <div className="text-xs text-slate-500">{order.type === 'preorder' ? 'Pre-order' : 'Table order'}{order.tableId ? ` · Table ${order.tableId}` : ''}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusChip status={order.status} />
          <StatusChip status={order.paymentStatus} label={order.paymentStatus === 'paid' ? (order.paymentMode === 'demo' ? 'Paid (demo)' : 'Paid (test)') : undefined} />
        </div>
      </div>

      {order.paymentStatus === 'paid' && !['cancelled'].includes(order.status) && (
        <div className="mt-3"><ProgressBar status={order.status} /></div>
      )}

      {order.paymentStatus === 'paid' && live.length > 0 && (
        <div className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {order.type === 'preorder' && !order.sessionId
            ? (readyAt > (order.expectedSeatAt || 0) + MIN
              ? <>You are expected to sit around <b>{fmtTime(order.expectedSeatAt)}</b>. Your last dish should be ready around <b>{fmtTime(readyAt)}</b>, a few minutes after that.</>
              : <>Food will be ready around <b>{fmtTime(order.expectedSeatAt)}</b>, when you are seated.</>)
            : <>Estimated ready: <b>{fmtTime(readyAt)}</b> (about {Math.max(1, Math.ceil((readyAt - now) / MIN))} min)</>}
          <span className="ml-1 text-xs opacity-70">estimate</span>
        </div>
      )}
      {delayed && <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">The kitchen added a short delay. Times above are updated.</div>}

      <div className="mt-3 divide-y divide-slate-100">
        {items.map((i) => {
          const task = tasks.find((t) => t.orderItemId === i.id)
          const canCancel = allowCancel && order.paymentStatus === 'paid' && task && ['scheduled', 'received'].includes(task.status)
          return (
            <div key={i.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className={`font-semibold ${i.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>{i.qty} × {i.name}</div>
                {i.options?.length > 0 && <div className="text-xs text-slate-500">{i.options.map((o) => o.label).join(' · ')}</div>}
                {i.instructions && <div className="text-xs italic text-slate-500">“{i.instructions}”</div>}
                <div className="text-xs text-slate-500">{etaText(task, plan, now)}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold">{fmtMoney(i.unitPrice * i.qty)}</span>
                {task && <StatusChip status={task.status} />}
                {canCancel && <button className="text-xs font-semibold text-red-600 underline" onClick={() => onCancelItem(i)}>Remove</button>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
        <span className="text-slate-500">Total incl. GST</span>
        <span className="font-extrabold">{fmtMoney(order.total)}</span>
      </div>
      {order.refundedAmount > 0 && <div className="mt-1 text-xs font-semibold text-slate-600">Refund of {fmtMoney(order.refundedAmount)} initiated (test mode, no real money moved).</div>}
      {order.paymentStatus === 'paid' && <div className="mt-1 text-[11px] text-slate-400">{MODE_LABEL[order.paymentMode]}</div>}
      {link && <Link className="mt-2 inline-block text-xs font-semibold text-brand-700 underline" to={`/order/${order.id}`}>Open live tracking</Link>}
    </div>
  )
}
