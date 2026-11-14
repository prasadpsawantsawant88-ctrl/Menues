// Back-office pages: inventory, floor plan, prep-time AI, loyalty.
import { useMemo, useRef, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { DashboardShell, RequireRole } from '../components/Layouts.jsx'
import { Empty, Field, Modal, Notice, Stat } from '../components/ui.jsx'
import { FloorLegend, FloorMap } from '../components/FloorMap.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { dailyUsage, ingredientStatus } from '../lib/inventory.js'
import { tierOf } from '../lib/loyalty.js'
import { fmtDate, fmtMoney, fmtTime, maskPhone } from '../lib/util.js'

const wrap = (title, Comp) => () => (
  <RequireRole role="admin">
    <DashboardShell area="admin" title={title}><Comp /></DashboardShell>
  </RequireRole>
)

const STATUS_TEXT = { ok: ['In stock', 'bg-emerald-100 text-emerald-800'], low: ['Running low', 'bg-amber-100 text-amber-800'], out: ['Out of stock', 'bg-red-100 text-red-700'] }
const REASON_TEXT = { sale: 'Sold', cancelled: 'Order cancelled', purchase: 'Delivery', waste: 'Waste', expired: 'Expired', correction: 'Correction', count: 'Stock count', opening: 'Opening stock' }

// ───────── inventory ─────────
function InventoryInner() {
  const { state, act } = useStore()
  const now = useNow(30000)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState(null) // { kind, ing }
  const [error, setError] = useState('')
  const usage = useMemo(() => dailyUsage(state, now), [state.meta.rev])
  const rows = state.ingredients.filter((i) => (filter === 'all' || ingredientStatus(i) === filter) && i.name.toLowerCase().includes(q.toLowerCase()))
  const low = state.ingredients.filter((i) => ingredientStatus(i) !== 'ok')
  const soldOut = state.menu.filter((m) => m.portionsLeft === 0)
  const stockValue = state.ingredients.reduce((s, i) => s + i.stock * i.costPerUnit, 0)
  const usedBy = (id) => state.menu.filter((m) => (m.recipe || []).some((r) => r.ingredientId === id)).length
  const ingName = (id) => state.ingredients.find((i) => i.id === id)?.name || id
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Raw materials" value={state.ingredients.length} />
        <Stat label="Low or out" value={low.length} tone={low.length ? 'warn' : 'good'} />
        <Stat label="Dishes sold out" value={soldOut.length} tone={soldOut.length ? 'bad' : 'good'} sub={soldOut.slice(0, 3).map((m) => m.name).join(', ')} />
        <Stat label="Stock value" value={fmtMoney(Math.round(stockValue))} />
      </div>
      <Notice tone="info">Each dish has a recipe (set under Menu). When an order is paid, its ingredients are taken out of stock. When any ingredient runs out, every dish that needs it shows as sold out on the customer menu. Cancelling a dish before cooking puts the ingredients back.</Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {[['all', 'All'], ['low', 'Running low'], ['out', 'Out of stock']].map(([k, l]) => <button key={k} className={`chip border px-3 py-1.5 ${filter === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`} onClick={() => setFilter(k)}>{l}</button>)}
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-3 text-slate-400" /><input className="input !py-2 !pl-8 text-sm" placeholder="Search ingredient" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn-primary !py-2 text-sm" onClick={() => setDialog({ kind: 'edit', ing: { name: '', unit: 'kg', stock: 0, reorderLevel: 1, costPerUnit: 0, supplier: '' } })}><Plus size={16} /> New ingredient</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Ingredient</th><th>Stock</th><th>Status</th><th>Uses / day</th><th>Lasts</th><th>Cost / unit</th><th>Used in</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((i) => {
              const st = ingredientStatus(i)
              const perDay = usage[i.id] || 0
              const days = perDay ? i.stock / perDay : null
              return (
                <tr key={i.id}>
                  <td className="p-3"><b>{i.name}</b><div className="text-xs text-slate-500">{i.supplier}</div></td>
                  <td className="font-semibold">{i.stock} {i.unit}<div className="text-xs font-normal text-slate-400">reorder at {i.reorderLevel}</div></td>
                  <td><span className={`chip ${STATUS_TEXT[st][1]}`}>{STATUS_TEXT[st][0]}</span></td>
                  <td>{perDay ? perDay.toFixed(2) : '–'}</td>
                  <td>{days == null ? '–' : days < 1 ? 'under a day' : `~${Math.round(days)} days`}</td>
                  <td>{fmtMoney(i.costPerUnit)}/{i.unit}</td>
                  <td>{usedBy(i.id)} dishes</td>
                  <td className="whitespace-nowrap p-2 text-right">
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setDialog({ kind: 'receive', ing: i })}>Receive</button>{' '}
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setDialog({ kind: 'adjust', ing: i })}>Waste</button>{' '}
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setDialog({ kind: 'count', ing: i })}>Count</button>{' '}
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setDialog({ kind: 'edit', ing: { ...i } })}>Edit</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <Empty title="No ingredients match" />}
      </div>
      <section>
        <h2 className="mb-2 text-lg font-extrabold">Recent stock movements</h2>
        <div className="card divide-y divide-slate-100 text-sm">
          {state.stockLog.slice(0, 12).map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-2.5">
              <span className="w-28 text-xs text-slate-500">{fmtDate(l.at)} {fmtTime(l.at)}</span>
              <b className="flex-1">{ingName(l.ingredientId)}</b>
              <span className="text-slate-600">{REASON_TEXT[l.reason] || l.reason}{l.note ? ` · ${l.note}` : ''}</span>
              <span className={`w-20 text-right font-semibold ${l.change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{l.change > 0 ? '+' : ''}{l.change}</span>
              <span className="w-16 text-right text-xs text-slate-400">= {l.balance}</span>
            </div>
          ))}
        </div>
      </section>
      {dialog && <StockDialog dialog={dialog} onClose={() => setDialog(null)} act={act} onError={setError} usedBy={usedBy} />}
    </div>
  )
}
export const AdminInventory = wrap('Inventory', InventoryInner)

function StockDialog({ dialog, onClose, act, onError, usedBy }) {
  const { kind, ing } = dialog
  const [v, setV] = useState(kind === 'edit' ? ing : { qty: '', cost: ing.costPerUnit, supplier: ing.supplier, delta: '', reason: 'waste', note: '', counted: ing.stock })
  const [error, setError] = useState('')
  const set = (k, val) => setV({ ...v, [k]: val })
  const submit = async (e) => {
    e.preventDefault()
    let r
    if (kind === 'receive') r = await act('receiveStock', { ingredientId: ing.id, qty: v.qty, costPerUnit: v.cost, supplier: v.supplier })
    if (kind === 'adjust') r = await act('adjustStock', { ingredientId: ing.id, delta: -Math.abs(Number(v.delta)), reason: v.reason, note: v.note })
    if (kind === 'count') r = await act('setStockCount', { ingredientId: ing.id, counted: v.counted })
    if (kind === 'edit') r = await act('upsertIngredient', { ingredient: v })
    r.ok ? onClose() : setError(r.error)
  }
  const remove = async () => {
    const r = await act('deleteIngredient', { id: ing.id })
    r.ok ? onClose() : setError(r.error)
  }
  const titles = { receive: `Receive stock: ${ing.name}`, adjust: `Record waste: ${ing.name}`, count: `Stock count: ${ing.name}`, edit: ing.id ? `Edit ${ing.name}` : 'New ingredient' }
  return (
    <Modal title={titles[kind]} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {kind === 'receive' && <>
          <Field label={`Quantity received (${ing.unit})`}><input className="input" type="number" step="any" min="0" value={v.qty} onChange={(e) => set('qty', e.target.value)} required autoFocus /></Field>
          <Field label={`Price per ${ing.unit} (₹)`}><input className="input" type="number" step="any" min="0" value={v.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
          <Field label="Supplier"><input className="input" value={v.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
        </>}
        {kind === 'adjust' && <>
          <Field label={`Quantity lost (${ing.unit})`}><input className="input" type="number" step="any" min="0" value={v.delta} onChange={(e) => set('delta', e.target.value)} required autoFocus /></Field>
          <Field label="Reason"><select className="input" value={v.reason} onChange={(e) => set('reason', e.target.value)}><option value="waste">Waste or spillage</option><option value="expired">Expired</option><option value="correction">Correction</option></select></Field>
          <Field label="Note"><input className="input" value={v.note} onChange={(e) => set('note', e.target.value)} maxLength={80} /></Field>
        </>}
        {kind === 'count' && <Field label={`Counted on the shelf (${ing.unit})`} hint={`System says ${ing.stock} ${ing.unit}. The difference is logged as a count variance.`}><input className="input" type="number" step="any" min="0" value={v.counted} onChange={(e) => set('counted', e.target.value)} required autoFocus /></Field>}
        {kind === 'edit' && <>
          <Field label="Name"><input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={50} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit"><select className="input" value={v.unit} onChange={(e) => set('unit', e.target.value)}><option>kg</option><option>L</option><option>pcs</option></select></Field>
            {!ing.id && <Field label="Opening stock"><input className="input" type="number" step="any" min="0" value={v.stock} onChange={(e) => set('stock', e.target.value)} /></Field>}
            <Field label="Reorder level" hint="Shows as “running low” at or below this."><input className="input" type="number" step="any" min="0" value={v.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} /></Field>
            <Field label="Cost per unit (₹)"><input className="input" type="number" step="any" min="0" value={v.costPerUnit} onChange={(e) => set('costPerUnit', e.target.value)} /></Field>
          </div>
          <Field label="Supplier"><input className="input" value={v.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
        </>}
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1">Save</button>
          {kind === 'edit' && ing.id && <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={16} /> Delete</button>}
        </div>
      </form>
    </Modal>
  )
}

// ───────── floor plan editor ─────────
function FloorPlanInner() {
  const { state, act } = useStore()
  const [tables, setTables] = useState(() => state.tables.map((t) => ({ ...t })))
  const [items, setItems] = useState(() => state.layout.items.map((i) => ({ ...i })))
  const [zones, setZones] = useState(() => state.layout.zones.map((z) => ({ ...z })))
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState(null)
  const svg = useRef()
  const drag = useRef(null)
  const { width, height } = state.layout
  const layout = { ...state.layout, zones, items }
  const selTable = tables.find((t) => t.id === sel)
  const selItem = items.find((i) => i.id === sel)
  const dirty = JSON.stringify([tables.map(({ id, capacity, zone, shape, x, y, w, h }) => [id, capacity, zone, shape, x, y, w, h]), items, zones]) !== JSON.stringify([state.tables.map(({ id, capacity, zone, shape, x, y, w, h }) => [id, capacity, zone, shape, x, y, w, h]), state.layout.items, state.layout.zones])

  const toSvg = (e) => {
    const r = svg.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }
  }
  const down = (e, kind, obj) => {
    const p = toSvg(e)
    drag.current = { kind, id: obj.id, dx: p.x - obj.x, dy: p.y - obj.y }
    setSel(obj.id)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const p = toSvg(e)
    const list = d.kind === 'table' ? tables : items
    const o = list.find((t) => t.id === d.id)
    const x = Math.round(Math.min(width - o.w, Math.max(0, p.x - d.dx)) / 10) * 10 // snap to a 10 px grid
    const y = Math.round(Math.min(height - o.h, Math.max(0, p.y - d.dy)) / 10) * 10
    const fn = (l) => l.map((t) => (t.id === d.id ? { ...t, x, y } : t))
    d.kind === 'table' ? setTables(fn) : setItems(fn)
  }
  const up = () => { drag.current = null }

  const patchTable = (p) => setTables(tables.map((t) => (t.id === sel ? { ...t, ...p } : t)))
  const patchItem = (p) => setItems(items.map((t) => (t.id === sel ? { ...t, ...p } : t)))
  const addTable = () => {
    const n = Math.max(0, ...tables.map((t) => Number(t.id.slice(1)))) + 1
    const id = 'T' + String(n).padStart(2, '0')
    setTables([...tables, { id, capacity: 4, zone: zones[0].name, shape: 'square', x: 40, y: 40, w: 70, h: 70, status: 'available' }])
    setSel(id)
  }
  const addItem = () => {
    const id = 'L' + (Math.max(0, ...items.map((i) => Number(i.id.slice(1)) || 0)) + 1)
    setItems([...items, { id, kind: 'label', label: 'New area', x: 40, y: 40, w: 120, h: 60 }])
    setSel(id)
  }
  const removeSel = () => {
    if (selTable) setTables(tables.filter((t) => t.id !== sel))
    if (selItem) setItems(items.filter((i) => i.id !== sel))
    setSel(null)
  }
  const save = async () => {
    const r = await act('saveFloorPlan', { tables, items, zones })
    setMsg(r.ok ? { tone: 'good', text: 'Floor plan saved. Staff and the kiosk use it straight away.' } : { tone: 'bad', text: r.error })
  }
  const discard = () => {
    setTables(state.tables.map((t) => ({ ...t })))
    setItems(state.layout.items.map((i) => ({ ...i })))
    setZones(state.layout.zones.map((z) => ({ ...z })))
    setSel(null)
    setMsg(null)
  }
  const statusOf = (id) => state.tables.find((t) => t.id === id)?.status

  return (
    <div className="space-y-4">
      <Notice tone="info">Drag tables and areas to place them (they snap to a grid). Pick one to change its seats, shape, size or zone. Nothing changes on the floor until you press Save. Tables with guests cannot be removed.</Notice>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-2">
          <FloorMap layout={layout} tables={tables} selected={sel} onSelect={(k, id) => setSel(id)} onDown={down} onMove={move} onUp={up} svgRef={svg} byZone />
          <FloorLegend layout={layout} byZone />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary !py-2 text-sm" onClick={addTable}><Plus size={15} /> Table</button>
            <button className="btn-ghost !py-2 text-sm" onClick={addItem}><Plus size={15} /> Area / label</button>
            <button className="btn-primary !py-2 text-sm" disabled={!dirty} onClick={save}>Save plan</button>
            <button className="btn-ghost !py-2 text-sm" disabled={!dirty} onClick={discard}>Discard</button>
          </div>
          {selTable && (
            <div className="card space-y-2 p-4">
              <div className="font-extrabold">Table {selTable.id} {statusOf(selTable.id) && statusOf(selTable.id) !== 'available' && <span className="text-xs font-normal text-slate-500">({statusOf(selTable.id)})</span>}</div>
              <Field label="Seats"><input className="input" type="number" min={1} max={20} value={selTable.capacity} onChange={(e) => patchTable({ capacity: e.target.value })} /></Field>
              <Field label="Zone"><select className="input" value={selTable.zone} onChange={(e) => patchTable({ zone: e.target.value })}>{zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></Field>
              <Field label="Shape"><select className="input" value={selTable.shape} onChange={(e) => patchTable({ shape: e.target.value })}><option value="round">Round</option><option value="square">Square</option><option value="rect">Rectangle</option></select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Width"><input className="input" type="number" min={30} max={220} step={10} value={selTable.w} onChange={(e) => patchTable({ w: Number(e.target.value) })} /></Field>
                <Field label="Height"><input className="input" type="number" min={30} max={220} step={10} value={selTable.h} onChange={(e) => patchTable({ h: Number(e.target.value) })} /></Field>
              </div>
              <button className="btn-ghost w-full text-red-600" onClick={removeSel}><Trash2 size={15} /> Remove table</button>
            </div>
          )}
          {selItem && (
            <div className="card space-y-2 p-4">
              <div className="font-extrabold">Area</div>
              <Field label="Label"><input className="input" value={selItem.label} maxLength={24} onChange={(e) => patchItem({ label: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Width"><input className="input" type="number" min={20} step={10} value={selItem.w} onChange={(e) => patchItem({ w: Number(e.target.value) })} /></Field>
                <Field label="Height"><input className="input" type="number" min={20} step={10} value={selItem.h} onChange={(e) => patchItem({ h: Number(e.target.value) })} /></Field>
              </div>
              <button className="btn-ghost w-full text-red-600" onClick={removeSel}><Trash2 size={15} /> Remove</button>
            </div>
          )}
          <div className="card space-y-2 p-4">
            <div className="font-extrabold">Zones</div>
            <p className="text-xs text-slate-500">Guests can ask for a zone when they join the queue.</p>
            {zones.map((z, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="color" value={z.color} className="h-9 w-9 rounded border" onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                <input className="input !py-1.5" value={z.name} maxLength={20} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="btn-ghost !px-2 !py-1.5 text-red-600" disabled={zones.length < 2 || tables.some((t) => t.zone === z.name)} title={tables.some((t) => t.zone === z.name) ? 'Move its tables first' : 'Remove zone'} onClick={() => setZones(zones.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-ghost w-full !py-1.5 text-sm" onClick={() => setZones([...zones, { name: 'New zone', color: '#8b5cf6' }])}><Plus size={14} /> Add zone</button>
          </div>
        </div>
      </div>
    </div>
  )
}
export const AdminFloorPlan = wrap('Floor plan', FloorPlanInner)

// ───────── prep-time AI ─────────
function PrepAiInner() {
  const { state, act } = useStore()
  const m = state.ml
  const on = state.settings.useAiTimings !== false
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const retrain = async () => {
    setBusy(true)
    const r = await act('retrainPrepModel', {})
    setBusy(false)
    setMsg(r.ok ? { tone: 'good', text: `Retrained. Average error on unseen orders: ${r.metrics.maeMl} min.` } : { tone: 'bad', text: r.error })
  }
  const toggle = async (e) => { const r = await act('setPrepModelEnabled', { enabled: e.target.checked }); if (!r.ok) setMsg({ tone: 'bad', text: r.error }) }
  if (!m) return <Notice tone="warn">Not enough completed dishes yet to learn from (needs 40). Standard prep times are used.</Notice>
  const k = m.metrics
  const rows = [...m.perDish].sort((a, b) => Math.abs(b.learned - b.standard) - Math.abs(a.learned - a.standard))
  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={on} onChange={toggle} /> Use learned prep times for wait estimates and kitchen planning</label>
        <span className="text-sm text-slate-500">Trained {fmtDate(m.trainedAt)} {fmtTime(m.trainedAt)} on {m.samples} finished dishes</span>
        <button className="btn-primary ml-auto !py-2 text-sm" disabled={busy} onClick={retrain}>{busy ? 'Learning…' : 'Retrain now'}</button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Average error, learned" value={`${k.maeMl} min`} tone="good" sub="on orders it had not seen" />
        <Stat label="Average error, standard times" value={`${k.maeRule} min`} />
        <Stat label="Improvement" value={`${k.improvementPct}%`} tone="good" />
        <Stat label="R²" value={k.r2Ml} sub={`standard times: ${k.r2Rule}`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Peak hours add" value={`${m.effects.peakMin > 0 ? '+' : ''}${m.effects.peakMin} min`} sub="to a typical dish" />
        <Stat label="Weekends add" value={`${m.effects.weekendMin > 0 ? '+' : ''}${m.effects.weekendMin} min`} />
        <Stat label="Each extra portion adds" value={`${m.effects.perExtraPortionMin} min`} sub="of a typical dish" />
      </div>
      <section>
        <h2 className="mb-2 text-lg font-extrabold">Standard vs learned time per dish</h2>
        <div className="card divide-y divide-slate-100 text-sm">
          {rows.map((d) => {
            const diff = Math.round((d.learned - d.standard) * 10) / 10
            return (
              <div key={d.id} className="flex items-center gap-3 p-2.5">
                <b className="flex-1">{d.name}</b>
                <span className="w-20 text-slate-500">{d.station}</span>
                <span className="w-24 text-right">standard {d.standard}</span>
                <span className="w-24 text-right font-semibold">learned {d.learned}</span>
                <span className={`w-20 text-right font-bold ${diff > 1 ? 'text-red-600' : diff < -1 ? 'text-emerald-700' : 'text-slate-400'}`}>{diff > 0 ? '+' : ''}{diff} min</span>
                <span className="w-16 text-right text-xs text-slate-400">{d.samples} cooks</span>
              </div>
            )
          })}
        </div>
      </section>
      <Notice tone="info">
        How it works: a ridge-regression model (plain JavaScript, no outside service) learns from every dish the kitchen finished: the time between pressing Start and Ready, the dish, its station, the number of portions, the hour (peak or not) and whether it was a weekend. It trains on the oldest 80% of orders and is scored on the newest 20%, which is why the error above is on orders it had not seen. It retrains by itself after 25 new finished dishes. A dish with fewer than 3 cooks falls back on its station average. Predictions are kept between half and three times the standard time.
      </Notice>
      <Notice tone="warn">The history shipped with this demo is generated, with a built-in pattern for the model to find, so the accuracy shown is better than a real kitchen would give. With real orders the same code learns the real kitchen.</Notice>
    </div>
  )
}
export const AdminPrepAI = wrap('Prep-time AI', PrepAiInner)

// ───────── loyalty ─────────
function LoyaltyInner() {
  const { state, act } = useStore()
  const l = state.settings.loyalty
  const [q, setQ] = useState('')
  const [cfg, setCfg] = useState(() => structuredClone(l))
  const [pick, setPick] = useState(null)
  const [msg, setMsg] = useState(null)
  const digits = q.replace(/\D/g, '')
  const members = [...state.customers].sort((a, b) => b.lifetimePoints - a.lifetimePoints)
  const shown = members.filter((c) => !q || (digits && c.phone.includes(digits)) || (c.name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 25)
  const outstanding = state.customers.reduce((s, c) => s + (c.points || 0), 0)
  const repeat = state.customers.filter((c) => c.visits > 1).length
  const saveCfg = async () => {
    const r = await act('saveLoyaltyConfig', { config: cfg })
    setMsg(r.ok ? { tone: 'good', text: 'Loyalty programme saved' } : { tone: 'bad', text: r.error })
  }
  const setTier = (i, k, v) => setCfg({ ...cfg, tiers: cfg.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) })
  const setReward = (i, k, v) => setCfg({ ...cfg, rewards: cfg.rewards.map((t, j) => (j === i ? { ...t, [k]: v } : t)) })
  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={state.customers.length} />
        <Stat label="Repeat guests" value={repeat} sub={`${state.customers.length ? Math.round((repeat / state.customers.length) * 100) : 0}% of members`} />
        <Stat label="Points outstanding" value={outstanding.toLocaleString('en-IN')} sub={`≈ ${fmtMoney(Math.round(outstanding * 0.5))} of rewards`} />
        <Stat label="Programme" value={l.enabled ? 'On' : 'Off'} tone={l.enabled ? 'good' : 'warn'} />
      </div>
      <Notice tone="info">A guest is a member from the first time they join the queue with their phone number: no card or app. Points are earned on paid orders and are kept against the phone number. The guest sees their own balance only through their personal queue link. Phone numbers are masked here.</Notice>

      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-extrabold">Programme rules</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Loyalty programme on</label>
          <Field label="Points per ₹1 spent" hint="0.1 = 1 point for every ₹10"><input className="input" type="number" step="0.01" min="0" value={cfg.earnPerRupee} onChange={(e) => setCfg({ ...cfg, earnPerRupee: e.target.value })} /></Field>
          <Field label="Welcome bonus (points)"><input className="input" type="number" min="0" value={cfg.welcomeBonus} onChange={(e) => setCfg({ ...cfg, welcomeBonus: e.target.value })} /></Field>
        </div>
        <div>
          <div className="label">Tiers (based on lifetime points; a higher tier earns more per order)</div>
          <div className="space-y-2">
            {cfg.tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input className="input !w-32" value={t.name} onChange={(e) => setTier(i, 'name', e.target.value)} />
                <span className="text-xs text-slate-500">from</span><input className="input !w-24" type="number" min="0" value={t.minPoints} onChange={(e) => setTier(i, 'minPoints', e.target.value)} />
                <span className="text-xs text-slate-500">points, earns ×</span><input className="input !w-20" type="number" step="0.05" min="1" value={t.multiplier} onChange={(e) => setTier(i, 'multiplier', e.target.value)} />
                <button className="btn-ghost !px-2 !py-1.5 text-red-600" disabled={cfg.tiers.length < 2} onClick={() => setCfg({ ...cfg, tiers: cfg.tiers.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-ghost !py-1.5 text-sm" onClick={() => setCfg({ ...cfg, tiers: [...cfg.tiers, { name: 'New tier', minPoints: 3000, multiplier: 2 }] })}><Plus size={14} /> Add tier</button>
          </div>
        </div>
        <div>
          <div className="label">Rewards (guests pick one at checkout; the value comes off the bill before GST)</div>
          <div className="space-y-2">
            {cfg.rewards.map((r, i) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <input className="input !w-56" value={r.name} onChange={(e) => setReward(i, 'name', e.target.value)} />
                <input className="input !w-24" type="number" min="1" value={r.points} onChange={(e) => setReward(i, 'points', e.target.value)} /><span className="text-xs text-slate-500">points → ₹ off</span>
                <input className="input !w-24" type="number" min="1" value={r.value} onChange={(e) => setReward(i, 'value', e.target.value)} />
                <button className="btn-ghost !px-2 !py-1.5 text-red-600" onClick={() => setCfg({ ...cfg, rewards: cfg.rewards.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-ghost !py-1.5 text-sm" onClick={() => setCfg({ ...cfg, rewards: [...cfg.rewards, { id: '', name: '₹100 off', points: 200, value: 100 }] })}><Plus size={14} /> Add reward</button>
          </div>
        </div>
        <button className="btn-primary" onClick={saveCfg}>Save programme</button>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">Members</h2>
          <div className="relative"><Search size={14} className="absolute left-2.5 top-3 text-slate-400" /><input className="input !py-2 !pl-8 text-sm" placeholder="Search phone or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="card divide-y divide-slate-100 text-sm">
          {shown.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1"><b>{c.name || 'Guest'}</b> <span className="text-slate-500">{maskPhone(c.phone)}</span></div>
              <span className="chip bg-slate-100 text-slate-700">{tierOf(state.settings, c).name}</span>
              <span className="w-24 text-right font-bold">{c.points} pts</span>
              <span className="w-20 text-right text-slate-500">{c.visits} visits</span>
              <span className="w-24 text-right text-slate-500">{fmtMoney(c.totalSpend || 0)}</span>
              <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setPick(c)}>Adjust</button>
            </div>
          ))}
          {!shown.length && <Empty title="No member found" />}
        </div>
      </section>
      {pick && <AdjustDialog customer={pick} onClose={() => setPick(null)} act={act} log={state.loyaltyLog.filter((e) => e.customerId === pick.id).slice(0, 6)} />}
    </div>
  )
}
export const AdminLoyalty = wrap('Loyalty', LoyaltyInner)

function AdjustDialog({ customer, onClose, act, log }) {
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    const r = await act('adjustPoints', { customerId: customer.id, points: Number(points), note })
    r.ok ? onClose() : setError(r.error)
  }
  return (
    <Modal title={`${customer.name || 'Guest'} · ${customer.points} points`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Points to add (use a minus sign to remove)"><input className="input" type="number" value={points} onChange={(e) => setPoints(e.target.value)} required autoFocus /></Field>
        <Field label="Reason"><input className="input" value={note} maxLength={80} placeholder="e.g. Apology for a long wait" onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn-primary w-full">Apply</button>
      </form>
      <div className="mt-4 text-xs text-slate-500">
        <div className="mb-1 font-bold uppercase">Recent activity</div>
        {log.map((e) => <div key={e.id} className="flex justify-between py-0.5"><span>{fmtDate(e.at)} · {e.note || e.kind}</span><b className={e.points < 0 ? 'text-red-600' : 'text-emerald-700'}>{e.points > 0 ? '+' : ''}{e.points}</b></div>)}
      </div>
    </Modal>
  )
}
