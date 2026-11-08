// Shared digital menu + cart + checkout used by the queue page (pre-order), the QR table page and /menu.
import { useMemo, useRef, useState } from 'react'
import { Clock, Minus, Plus, ShoppingBag, Trash2, Leaf, Zap } from 'lucide-react'
import { useStore, useNow } from '../lib/store.jsx'
import { computeKitchenPlan, estimateDish, estimateOrder, itemDuration, stationLoad } from '../lib/engines.js'
import { fmtMoney, fmtTime, MIN } from '../lib/util.js'
import { lineUnitPrice, orderTotals } from '../lib/actions.js'
import { DishImage, Field, Modal, Notice, VegMark } from './ui.jsx'
import PaymentModal from './PaymentModal.jsx'

const cartKey = (id) => `dineflow-cart-${id}`
function loadCart(id) {
  try {
    return JSON.parse(sessionStorage.getItem(cartKey(id))) || []
  } catch {
    return []
  }
}

export default function MenuBrowser({ mode, entry, table, expectedSeatAt, onPaid }) {
  const { state, act } = useStore()
  const now = useNow(5000)
  const scope = mode === 'preorder' ? entry.id : mode === 'qr' ? table.id : 'browse'
  const [cart, setCartState] = useState(() => loadCart(scope))
  const [category, setCategory] = useState('all')
  const [vegOnly, setVegOnly] = useState(false)
  const [quickOnly, setQuickOnly] = useState(false)
  const [custom, setCustom] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [payingOrderId, setPayingOrderId] = useState(null)
  const [error, setError] = useState('')
  const requestId = useRef(`req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const canOrder = mode !== 'browse'

  const setCart = (next) => {
    setCartState(next)
    try {
      sessionStorage.setItem(cartKey(scope), JSON.stringify(next))
    } catch { /* storage blocked: cart lives in memory */ }
  }

  // Live kitchen plan → per-dish estimates (re-computed whenever tasks, chefs or time change).
  const plan = useMemo(() => computeKitchenPlan(state, now), [state.tasks, state.stations, now])
  const load = useMemo(() => stationLoad(state, now), [state.tasks, state.stations, now])
  const worstBacklog = Math.max(0, ...load.map((l) => l.clearsInMin))
  const busyLabel = worstBacklog <= 5 ? 'Kitchen is quiet' : worstBacklog <= 15 ? 'Kitchen is moderately busy' : 'Kitchen is busy'

  const menuById = (id) => state.menu.find((m) => m.id === id)
  const lines = cart
    .map((l) => ({ ...l, item: menuById(l.menuItemId) }))
    .filter((l) => l.item)
    .map((l) => ({ ...l, unitPrice: lineUnitPrice(l.item, l.options) }))
  const totals = orderTotals(state.settings, lines)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const orderEstimate = useMemo(() => estimateOrder(plan, lines.map((l) => ({ item: l.item, qty: l.qty })), now), [plan, cart, now])

  const addLine = (item, options = [], instructions = '', qty = 1) => {
    const sig = JSON.stringify([item.id, options.map((o) => o.label), instructions])
    const existing = cart.find((l) => l.sig === sig)
    if (existing) setCart(cart.map((l) => (l.sig === sig ? { ...l, qty: Math.min(20, l.qty + qty) } : l)))
    else setCart([...cart, { sig, menuItemId: item.id, qty, options, instructions }])
  }
  const changeQty = (sig, delta) => setCart(cart.map((l) => (l.sig === sig ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0 && l.qty <= 20))
  const removeLine = (sig) => setCart(cart.filter((l) => l.sig !== sig))
  const setInstr = (sig, text) => setCart(cart.map((l) => (l.sig === sig ? { ...l, instructions: text.slice(0, 140) } : l)))

  const quickAdd = (item) => {
    if (item.options?.length) return setCustom(item)
    addLine(item)
  }

  const visible = state.menu.filter((m) => (category === 'all' || m.categoryId === category) && (!vegOnly || m.veg) && (!quickOnly || m.prepMin <= 8))

  const checkout = async () => {
    setError('')
    const result = await act('createOrder', {
      type: mode,
      entryId: entry?.id,
      tableId: table?.id,
      clientRequestId: requestId.current, // double-tap safe: the same request returns the same order
      items: lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, options: l.options, instructions: l.instructions })),
    })
    if (!result.ok) return setError(result.error)
    setPayingOrderId(result.order.id)
  }

  const paid = (orderId) => {
    setPayingOrderId(null)
    setCartOpen(false)
    setCart([])
    requestId.current = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` // next order = new request
    onPaid?.(orderId)
  }

  return (
    <div>
      {/* Live estimate banner */}
      <div className="mx-4 mt-3 space-y-2">
        <div className="flex items-center justify-between rounded-2xl bg-brand-50 px-3.5 py-2.5 text-sm">
          <span className="flex items-center gap-2 font-semibold text-brand-700"><Clock size={16} /> {busyLabel}</span>
          <span className="text-xs text-brand-700">Estimates update live</span>
        </div>
        {mode === 'preorder' && expectedSeatAt && (
          <Notice tone="info">Dishes you pre-order are timed to be <b>ready when you sit down</b> (expected around <b>{fmtTime(expectedSeatAt)}</b>). They are not cooked early.</Notice>
        )}
        {mode === 'qr' && <Notice tone="info">Ordering for <b>table {table.id}</b>. Your order goes straight to the kitchen.</Notice>}
      </div>

      {/* Category tiles (like "Top cuisine") */}
      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Menu</h2>
          {category !== 'all' && <button className="text-sm font-semibold text-brand-700" onClick={() => setCategory('all')}>See all</button>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {state.categories.map((c) => {
            const first = state.menu.find((m) => m.categoryId === c.id)
            const active = category === c.id
            return (
              <button key={c.id} onClick={() => setCategory(active ? 'all' : c.id)} className={`flex min-h-20 flex-col justify-between rounded-2xl border p-2.5 text-left text-xs font-semibold ${active ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}>
                <span>{c.name}</span>
                <span className="self-end text-2xl">{first?.emoji}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setVegOnly(!vegOnly)} className={`chip shrink-0 gap-1 border px-3 py-1.5 ${vegOnly ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-700'}`}><Leaf size={13} /> Veg only</button>
          <button onClick={() => setQuickOnly(!quickOnly)} className={`chip shrink-0 gap-1 border px-3 py-1.5 ${quickOnly ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700'}`}><Zap size={13} /> Quick (≤ 8 min)</button>
        </div>
      </div>

      {/* Dish list */}
      <div className="mt-2 divide-y divide-dashed divide-slate-200 px-4">
        {visible.map((item) => {
          const est = estimateDish(plan, item, 1, now)
          const inCart = lines.filter((l) => l.menuItemId === item.id).reduce((s, l) => s + l.qty, 0)
          const unavailable = !item.available
          return (
            <div key={item.id} className={`flex gap-3 py-4 ${unavailable ? 'opacity-50' : ''}`}>
              <DishImage item={item} className="h-24 w-24" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><VegMark veg={item.veg} /><h3 className="truncate font-bold">{item.name}</h3></div>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.description}</p>
                <div className="mt-1.5 text-sm font-extrabold">{fmtMoney(item.price)}</div>
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <Clock size={12} />
                  {unavailable ? 'Unavailable right now' : est ? (
                    <span>Prep {item.prepMin} min{est.backlogMin > 0 ? ` + ${est.backlogMin} min queue` : ''} · <b className="text-slate-700">est. ~{est.totalMin} min</b></span>
                  ) : '—'}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end justify-end">
                {canOrder && !unavailable && (inCart > 0 ? (
                  <div className="flex items-center gap-2 rounded-full bg-brand-600 px-2 py-1 text-white">
                    <button aria-label="Remove one" onClick={() => { const l = lines.filter((x) => x.menuItemId === item.id).at(-1); changeQty(l.sig, -1) }}><Minus size={16} /></button>
                    <span className="min-w-4 text-center text-sm font-bold">{inCart}</span>
                    <button aria-label="Add one" onClick={() => quickAdd(item)}><Plus size={16} /></button>
                  </div>
                ) : (
                  <button className="btn-primary !px-4 !py-1.5" onClick={() => quickAdd(item)}>Add</button>
                ))}
              </div>
            </div>
          )
        })}
        {!visible.length && <div className="py-10 text-center text-sm text-slate-500">No dishes match these filters.</div>}
      </div>
      <p className="px-4 pt-2 text-center text-xs text-slate-400">Preparation times are <b>estimates</b> based on the kitchen's current workload.</p>

      {/* Cart bar */}
      {canOrder && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md p-3">
          <button onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between rounded-2xl bg-brand-600 px-4 py-3.5 text-white shadow-lg">
            <span className="flex items-center gap-2 font-bold"><ShoppingBag size={18} /> {count} item{count > 1 ? 's' : ''}</span>
            <span className="font-bold">View cart · {fmtMoney(totals.total)}</span>
          </button>
        </div>
      )}

      {custom && <CustomiseModal item={custom} onClose={() => setCustom(null)} onAdd={(opts, instr, qty) => { addLine(custom, opts, instr, qty); setCustom(null) }} />}

      {cartOpen && (
        <Modal title="Your cart" onClose={() => setCartOpen(false)}>
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.sig} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold"><VegMark veg={l.item.veg} /> {l.item.name}</div>
                    {l.options.length > 0 && <div className="text-xs text-slate-500">{l.options.map((o) => o.label).join(' · ')}</div>}
                    <div className="mt-0.5 text-xs text-slate-500">~{itemDuration(l.item, l.qty)} min to cook · {fmtMoney(l.unitPrice)} each</div>
                  </div>
                  <div className="text-right font-bold">{fmtMoney(l.unitPrice * l.qty)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 rounded-full border border-slate-200 px-2 py-1">
                    <button aria-label="Less" onClick={() => changeQty(l.sig, -1)}><Minus size={16} /></button>
                    <span className="min-w-4 text-center text-sm font-bold">{l.qty}</span>
                    <button aria-label="More" onClick={() => changeQty(l.sig, 1)}><Plus size={16} /></button>
                  </div>
                  <button className="text-red-600" aria-label="Remove" onClick={() => removeLine(l.sig)}><Trash2 size={17} /></button>
                </div>
                <input className="input mt-2 !py-1.5 text-xs" placeholder="Special instructions (e.g. less oil)" value={l.instructions} onChange={(e) => setInstr(l.sig, e.target.value)} maxLength={140} />
              </div>
            ))}
            {!lines.length && <div className="py-6 text-center text-sm text-slate-500">Your cart is empty.</div>}

            {lines.length > 0 && (
              <>
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><span>{fmtMoney(totals.subtotal)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>GST ({state.settings.gstPercent}%)</span><span>{fmtMoney(totals.tax)}</span></div>
                  <div className="mt-1 flex justify-between text-base font-extrabold"><span>Total</span><span>{fmtMoney(totals.total)}</span></div>
                </div>
                {mode === 'qr' ? (
                  <Notice tone="info">
                    <b>Estimated time until your whole order is ready: ~{orderEstimate.totalMin} min.</b><br />
                    Dishes on different stations cook at the same time, so this is less than adding every dish ({orderEstimate.naiveSumMin} min). It is an estimate.
                  </Notice>
                ) : (
                  <Notice tone="info">Your dishes will be scheduled so they finish around <b>{fmtTime(expectedSeatAt || now)}</b>, when you are expected to be seated. If your seating time changes, the schedule moves with it.</Notice>
                )}
                {error && <Notice tone="bad">{error}</Notice>}
                <button className="btn-primary w-full !py-3" onClick={checkout}>Proceed to payment · {fmtMoney(totals.total)}</button>
              </>
            )}
          </div>
        </Modal>
      )}

      {payingOrderId && <PaymentModal orderId={payingOrderId} onClose={() => setPayingOrderId(null)} onPaid={paid} />}
    </div>
  )
}

function CustomiseModal({ item, onClose, onAdd }) {
  const [picked, setPicked] = useState(() => Object.fromEntries((item.options || []).filter((g) => g.required).map((g) => [g.name, g.choices[0]])))
  const [instructions, setInstructions] = useState('')
  const [qty, setQty] = useState(1)
  const toggle = (group, choice) => {
    const next = { ...picked }
    if (next[group.name]?.label === choice.label && !group.required) delete next[group.name]
    else next[group.name] = choice
    setPicked(next)
  }
  const options = Object.entries(picked).map(([group, c]) => ({ group, label: c.label, price: c.price || 0 }))
  const unit = lineUnitPrice(item, options)
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="space-y-4">
        {(item.options || []).map((group) => (
          <div key={group.name}>
            <div className="mb-1.5 text-sm font-bold">{group.name} {group.required && <span className="text-xs font-normal text-slate-500">(required)</span>}</div>
            <div className="flex flex-wrap gap-2">
              {group.choices.map((c) => {
                const active = picked[group.name]?.label === c.label
                return (
                  <button key={c.label} onClick={() => toggle(group, c)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>
                    {c.label}{c.price ? ` +${fmtMoney(c.price)}` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <Field label="Special instructions (optional)">
          <input className="input" maxLength={140} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. no onions" />
        </Field>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 px-2 py-1.5">
            <button aria-label="Less" onClick={() => setQty(Math.max(1, qty - 1))}><Minus size={16} /></button>
            <span className="min-w-4 text-center font-bold">{qty}</span>
            <button aria-label="More" onClick={() => setQty(Math.min(20, qty + 1))}><Plus size={16} /></button>
          </div>
          <button className="btn-primary" onClick={() => onAdd(options, instructions.trim(), qty)}>Add · {fmtMoney(unit * qty)}</button>
        </div>
      </div>
    </Modal>
  )
}
