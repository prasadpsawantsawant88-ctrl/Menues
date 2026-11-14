import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Edit3, Eye, EyeOff, Plus, Printer, Trash2, Upload } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { DashboardShell, RequireRole } from '../components/Layouts.jsx'
import { DishImage, Empty, Field, Modal, Notice, Stat, StatusChip, VegMark } from '../components/ui.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { stationLoad } from '../lib/engines.js'
import { fmtMoney } from '../lib/util.js'
import { recipeCost } from '../lib/inventory.js'

const wrap = (title, Comp) => () => (
  <RequireRole role="admin">
    <DashboardShell area="admin" title={title}><Comp /></DashboardShell>
  </RequireRole>
)

// ───────── overview ─────────
function OverviewInner() {
  const { state } = useStore()
  const now = useNow(5000)
  const load = stationLoad(state, now)
  const today = new Date().toDateString()
  const todays = state.orders.filter((o) => o.paymentStatus === 'paid' && new Date(o.createdAt).toDateString() === today)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders today" value={todays.length} />
        <Stat label="Revenue today" value={fmtMoney(todays.reduce((s, o) => s + o.total - (o.refundedAmount || 0), 0))} />
        <Stat label="Waiting" value={state.queue.filter((q) => q.status === 'waiting').length} />
        <Stat label="Tables in use" value={`${state.tables.filter((t) => t.status === 'occupied').length}/${state.tables.length}`} />
      </div>
      <section>
        <h2 className="mb-2 text-lg font-extrabold">Kitchen workload now</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {load.map((l) => (
            <div key={l.station.id} className="card p-4">
              <div className="flex justify-between"><b>{l.station.name}</b><span className="text-xs text-slate-500">{l.station.chefs} chefs</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${l.utilisation > 0.8 ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${Math.max(4, l.utilisation * 100)}%` }} /></div>
              <div className="mt-2 text-xs text-slate-600">{l.activeTasks} active dishes · clear in ~{l.clearsInMin} min</div>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['/admin/analytics', 'Analytics', 'KPIs and charts'], ['/admin/menu', 'Menu', 'Dishes, prices, stations'], ['/admin/inventory', 'Inventory', 'Raw materials and recipes'], ['/admin/floor-plan', 'Floor plan', 'Drag tables and zones'], ['/admin/loyalty', 'Loyalty', 'Members, tiers, rewards'], ['/admin/prep-ai', 'Prep-time AI', 'Learned cooking times'], ['/admin/tables', 'Tables & QR', 'Capacity and QR codes'], ['/admin/settings', 'Kitchen & settings', 'Chefs, timings, kiosk PIN']].map(([to, t, d]) => (
          <Link key={to} to={to} className="card p-4 hover:border-brand-500"><div className="font-bold">{t}</div><div className="text-sm text-slate-500">{d}</div></Link>
        ))}
      </section>
    </div>
  )
}
export const AdminOverview = wrap('Overview', OverviewInner)

// ───────── menu ─────────
function MenuInner() {
  const { state, act } = useStore()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('all')
  const [catDialog, setCatDialog] = useState(false)
  const items = state.menu.filter((m) => cat === 'all' || m.categoryId === cat)
  const stationName = (id) => state.stations.find((s) => s.id === id)?.name
  const toggle = async (m) => { const r = await act('setAvailability', { id: m.id, available: !m.available }); if (!r.ok) setError(r.error) }
  const remove = async (m) => { if (confirm(`Delete ${m.name}?`)) { const r = await act('deleteMenuItem', { id: m.id }); setError(r.ok ? '' : r.error) } }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button className={`chip border px-3 py-1.5 ${cat === 'all' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`} onClick={() => setCat('all')}>All ({state.menu.length})</button>
          {state.categories.map((c) => <button key={c.id} className={`chip border px-3 py-1.5 ${cat === c.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        <button className="btn-ghost !py-2 text-sm" onClick={() => setCatDialog(true)}>Categories</button>
        <button className="btn-primary !py-2 text-sm" onClick={() => setEditing({ name: '', description: '', price: 100, prepMin: 10, complexity: 2, station: state.stations[0].id, categoryId: state.categories[0].id, veg: true, available: true, stock: '', options: [], recipe: [] })}><Plus size={16} /> Add dish</button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <Notice tone="info">Changes here appear on every customer menu immediately. Mark a dish unavailable and it greys out and cannot be ordered.</Notice>
      <div className="card divide-y divide-slate-100">
        {items.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 p-3">
            <DishImage item={m} className="h-14 w-14" rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-bold"><VegMark veg={m.veg} /> {m.name} {!m.available && <StatusChip status="blocked" label="Unavailable" />}{m.available && m.portionsLeft === 0 && <StatusChip status="blocked" label="Sold out (stock)" />}</div>
              <div className="text-xs text-slate-500">{state.categories.find((c) => c.id === m.categoryId)?.name} · {stationName(m.station)} station · {m.prepMin} min · complexity {m.complexity}/5{m.stock != null ? ` · stock ${m.stock}` : ''}{m.portionsLeft != null ? ` · ${m.portionsLeft} portions from stock` : ' · no recipe'}</div>
            </div>
            <div className="font-extrabold">{fmtMoney(m.price)}</div>
            <div className="flex gap-1.5">
              <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => toggle(m)} title={m.available ? 'Mark unavailable' : 'Mark available'}>{m.available ? <Eye size={16} /> : <EyeOff size={16} />}</button>
              <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => setEditing(m)} aria-label="Edit"><Edit3 size={16} /></button>
              <button className="btn-ghost !px-2.5 !py-1.5 text-red-600" onClick={() => remove(m)} aria-label="Delete"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
      {catDialog && <CategoryDialog onClose={() => setCatDialog(false)} />}
      {editing && <DishForm dish={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
export const AdminMenu = wrap('Menu management', MenuInner)

function DishForm({ dish, onClose }) {
  const { state, act } = useStore()
  const [d, setD] = useState(dish)
  const [error, setError] = useState('')
  const file = useRef()
  const set = (k, v) => setD({ ...d, [k]: v })
  const setRecipe = (i, p) => set('recipe', d.recipe.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const cost = recipeCost(state, (d.recipe || []).map((r) => ({ ...r, qty: Number(r.qty) || 0 })))
  const margin = Number(d.price) > 0 ? ((Number(d.price) - cost) / Number(d.price)) * 100 : 0

  // Photograph upload: resized in the browser and stored as a small data URL (demo mode).
  // With Supabase configured, upload to a Storage bucket instead (see docs).
  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) return setError('Please choose an image file')
    if (f.size > 8 * 1024 * 1024) return setError('Image is larger than 8 MB')
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 480 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      set('image', c.toDataURL('image/jpeg', 0.8))
      setError('')
    }
    img.onerror = () => setError('Could not read that image')
    img.src = URL.createObjectURL(f)
  }

  const save = async (e) => {
    e.preventDefault()
    const r = await act('upsertMenuItem', { item: d })
    r.ok ? onClose() : setError(r.error)
  }
  return (
    <Modal title={d.id ? `Edit ${dish.name}` : 'Add dish'} onClose={onClose} wide>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Dish name"><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={60} required /></Field></div>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={160} /></Field></div>
        <Field label="Category"><select className="input" value={d.categoryId} onChange={(e) => set('categoryId', e.target.value)}>{state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Kitchen station"><select className="input" value={d.station} onChange={(e) => set('station', e.target.value)}>{state.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Price (₹)"><input className="input" type="number" min={0} value={d.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label="Standard prep time (min)"><input className="input" type="number" min={1} value={d.prepMin} onChange={(e) => set('prepMin', e.target.value)} /></Field>
        <Field label="Complexity (1–5)" hint="Bigger orders of complex dishes take longer per extra portion."><input className="input" type="number" min={1} max={5} value={d.complexity} onChange={(e) => set('complexity', e.target.value)} /></Field>
        <Field label="Stock (blank = unlimited)" hint="Counts down as dishes are ordered. At 0 the dish becomes unavailable."><input className="input" type="number" min={0} value={d.stock ?? ''} onChange={(e) => set('stock', e.target.value)} /></Field>
        <Field label="Emoji (fallback picture)"><input className="input" value={d.emoji || ''} onChange={(e) => set('emoji', e.target.value)} maxLength={4} /></Field>
        <div className="flex items-end gap-4 pb-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={d.veg} onChange={(e) => set('veg', e.target.checked)} /> Vegetarian</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={d.available} onChange={(e) => set('available', e.target.checked)} /> Available</label>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Photograph</span>
          <div className="flex items-center gap-3">
            <DishImage item={d} className="h-16 w-16" rounded="rounded-xl" />
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => file.current.click()}><Upload size={14} /> Upload photo</button>
            {d.image && <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => set('image', null)}>Remove</button>}
            <input className="input flex-1 text-xs" placeholder="…or paste an image URL" value={d.image?.startsWith('data:') ? '' : d.image || ''} onChange={(e) => set('image', e.target.value.trim() || null)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Recipe: raw materials for ONE portion</span>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            {(d.recipe || []).map((r, i) => {
              const ing = state.ingredients.find((x) => x.id === r.ingredientId)
              return (
                <div key={i} className="flex items-center gap-2">
                  <select className="input flex-1 !py-1.5" value={r.ingredientId} onChange={(e) => setRecipe(i, { ingredientId: e.target.value })}>{state.ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <input className="input !w-24 !py-1.5" type="number" step="any" min="0" value={r.qty} onChange={(e) => setRecipe(i, { qty: e.target.value })} />
                  <span className="w-8 text-xs text-slate-500">{ing?.unit}</span>
                  <button type="button" className="btn-ghost !px-2 !py-1.5 text-red-600" onClick={() => set('recipe', d.recipe.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              )
            })}
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => set('recipe', [...(d.recipe || []), { ingredientId: state.ingredients[0].id, qty: 0.1 }])}><Plus size={14} /> Add ingredient</button>
            {(d.recipe || []).length > 0 ? (
              <div className="text-sm">Cost per portion <b>{fmtMoney(Math.round(cost * 10) / 10)}</b> · price {fmtMoney(Number(d.price) || 0)} · margin <b className={margin < 30 ? 'text-red-600' : 'text-emerald-700'}>{Math.round(margin)}%</b></div>
            ) : <div className="text-xs text-slate-500">No recipe: stock is not tracked for this dish and it never sells out by itself.</div>}
          </div>
        </div>
        {error && <div className="sm:col-span-2"><Notice tone="bad">{error}</Notice></div>}
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn-primary flex-1">Save dish</button>
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}

function CategoryDialog({ onClose }) {
  const { state, act } = useStore()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const run = async (n, a) => { const r = await act(n, a); setError(r.ok ? '' : r.error); return r.ok }
  return (
    <Modal title="Menu categories" onClose={onClose}>
      <div className="space-y-2">
        {state.categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input className="input flex-1 !py-1.5" defaultValue={c.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && run('upsertCategory', { id: c.id, name: e.target.value })} />
            <span className="w-16 text-xs text-slate-500">{state.menu.filter((m) => m.categoryId === c.id).length} dishes</span>
            <button className="btn-ghost !px-2 !py-1.5 text-red-600" onClick={() => run('deleteCategory', { id: c.id })}><Trash2 size={14} /></button>
          </div>
        ))}
        <form className="flex gap-2 pt-2" onSubmit={async (e) => { e.preventDefault(); if (await run('upsertCategory', { name })) setName('') }}>
          <input className="input flex-1" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button className="btn-primary">Add</button>
        </form>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  )
}

// ───────── tables & QR ─────────
function TablesInner() {
  const { state, act } = useStore()
  const [form, setForm] = useState(null)
  const [qr, setQr] = useState(null)
  const [error, setError] = useState('')
  const nextId = () => 'T' + String(Math.max(...state.tables.map((t) => Number(t.id.slice(1)))) + 1).padStart(2, '0')
  const urlFor = (id) => `${window.location.origin}/table/${id}`
  const save = async (e) => { e.preventDefault(); const r = await act('upsertTable', { table: form }); r.ok ? setForm(null) : setError(r.error) }
  const download = (id) => {
    const canvas = document.getElementById(`qr-${id}`)
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `dineflow-table-${id}.png`
    a.click()
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Notice tone="info">Each QR code opens <code>/table/&lt;id&gt;</code>. While deployed, the code points at the live site address. Print them and stick one on each table.</Notice>
        <div className="flex gap-2">
          <button className="btn-ghost !py-2 text-sm" onClick={() => window.print()}><Printer size={16} /> Print all</button>
          <button className="btn-primary !py-2 text-sm" onClick={() => { setError(''); setForm({ id: nextId(), capacity: 4, zone: state.layout.zones[0].name }) }}><Plus size={16} /> Add table</button>
        </div>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-3">
        {state.tables.map((t) => (
          <div key={t.id} className="card break-inside-avoid p-4 text-center">
            <div className="flex items-center justify-between"><span className="text-lg font-extrabold">{t.id}</span><StatusChip status={t.status} /></div>
            <div className="mb-2 text-xs text-slate-500">{t.capacity} seats · {t.zone}</div>
            <div className="mx-auto w-fit rounded-xl border border-slate-200 p-2"><QRCodeCanvas id={`qr-${t.id}`} value={urlFor(t.id)} size={150} includeMargin /></div>
            <div className="mt-1 break-all text-[10px] text-slate-400">{urlFor(t.id)}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 print:hidden">
              <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => download(t.id)}><Download size={13} /> PNG</button>
              <Link className="btn-ghost !px-2.5 !py-1 text-xs" to={`/table/${t.id}`}>Open</Link>
              <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => { setError(''); setForm({ ...t }) }}>Edit</button>
              {t.status === 'available' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => act('setTableStatus', { tableId: t.id, status: 'blocked' })}>Block</button>}
              {t.status === 'blocked' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => act('setTableStatus', { tableId: t.id, status: 'available' })}>Unblock</button>}
              {t.status === 'available' && <button className="btn-ghost !px-2.5 !py-1 text-xs text-red-600" onClick={async () => { const r = await act('deleteTable', { id: t.id }); if (!r.ok) setError(r.error) }}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
      {form && (
        <Modal title={state.tables.some((t) => t.id === form.id) ? `Edit ${form.id}` : 'Add table'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Table id"><input className="input" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} disabled={state.tables.some((t) => t.id === form.id)} /></Field>
            <Field label="Capacity"><input className="input" type="number" min={1} max={20} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Zone"><select className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>{state.layout.zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></Field>
            {error && <Notice tone="bad">{error}</Notice>}
            <button className="btn-primary w-full">Save table</button>
          </form>
        </Modal>
      )}
    </div>
  )
}
export const AdminTables = wrap('Tables & QR codes', TablesInner)

// ───────── kitchen & restaurant settings ─────────
function SettingsInner() {
  const { state, act } = useStore()
  const now = useNow(5000)
  const s = state.settings
  const load = stationLoad(state, now)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const patch = async (p) => { const r = await act('updateSettings', { patch: p }); setSaved(r.ok ? 'Saved' : ''); setError(r.ok ? '' : r.error) }
  const num = (k, min = 0, max = 240) => (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max) patch({ [k]: v }) }
  return (
    <div className="space-y-6">
      {saved && <Notice tone="good">{saved}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <section>
        <h2 className="mb-2 text-lg font-extrabold">Kitchen stations</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {load.map((l) => (
            <div key={l.station.id} className="card p-4">
              <div className="font-bold">{l.station.name}</div>
              <Field label="Chefs on shift (station capacity)"><input className="input" type="number" min={1} max={8} value={l.station.chefs} onChange={async (e) => { const r = await act('updateStation', { id: l.station.id, chefs: e.target.value }); setError(r.ok ? '' : r.error) }} /></Field>
              <div className="mt-2 text-xs text-slate-500">{l.activeTasks} active dishes · clears in ~{l.clearsInMin} min</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Chefs set how many dishes a station can cook at once. Per-dish prep times are set under Menu.</p>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="text-lg font-extrabold sm:col-span-2 lg:col-span-3">Restaurant</h2>
        <Field label="Restaurant name"><input className="input" defaultValue={s.restaurantName} maxLength={60} onBlur={(e) => e.target.value.trim() && patch({ restaurantName: e.target.value.trim() })} /></Field>
        <Field label="Opens"><input className="input" type="time" value={s.openTime} onChange={(e) => patch({ openTime: e.target.value })} /></Field>
        <Field label="Closes"><input className="input" type="time" value={s.closeTime} onChange={(e) => patch({ closeTime: e.target.value })} /></Field>
        <Field label="Queue grace period (min)" hint="How long a called group has to arrive."><input className="input" type="number" value={s.graceMinutes} onChange={num('graceMinutes', 1, 30)} /></Field>
        <Field label="Table cleaning time (min)"><input className="input" type="number" value={s.cleaningMinutes} onChange={num('cleaningMinutes', 0, 30)} /></Field>
        <Field label="Max times a group can be skipped" hint="Fairness rule: after this, the group is protected."><input className="input" type="number" value={s.maxSkips} onChange={num('maxSkips', 0, 10)} /></Field>
        <Field label="Average dining time: 1–2 people (min)"><input className="input" type="number" value={s.dining.small} onChange={(e) => patch({ dining: { ...s.dining, small: Number(e.target.value) || 45 } })} /></Field>
        <Field label="3–4 people (min)"><input className="input" type="number" value={s.dining.medium} onChange={(e) => patch({ dining: { ...s.dining, medium: Number(e.target.value) || 60 } })} /></Field>
        <Field label="5+ people (min)"><input className="input" type="number" value={s.dining.large} onChange={(e) => patch({ dining: { ...s.dining, large: Number(e.target.value) || 75 } })} /></Field>
        <Field label="Pre-order buffer: ready before seating (min)" hint="0 = ready exactly at seating. Negative values are not allowed."><input className="input" type="number" value={s.readyOffsetMinutes} onChange={num('readyOffsetMinutes', 0, 15)} /></Field>
        <Field label="Max minutes a dish may be prepared early" hint="Stops food waiting too long."><input className="input" type="number" value={s.maxEarlyMinutes} onChange={num('maxEarlyMinutes', 0, 30)} /></Field>
        <Field label="GST (%)"><input className="input" type="number" value={s.gstPercent} onChange={num('gstPercent', 0, 28)} /></Field>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Kiosk, QR codes & network</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kiosk exit PIN" hint="Staff enter this to leave the entrance kiosk. 4–8 digits."><input className="input" inputMode="numeric" defaultValue={s.kioskPin ?? ''} onBlur={(e) => patch({ kioskPin: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></Field>
          <Field label="Personal queue link valid for (hours)" hint="After this the QR code stops working."><input className="input" type="number" value={s.sessionHours} onChange={num('sessionHours', 1, 24)} /></Field>
          <div className="sm:col-span-2"><Field label="Public base URL for QR codes (optional)" hint="Leave empty to use this network address automatically. Set it when using a tunnel or hosted site, e.g. https://dineflow.example.com"><input className="input" placeholder="http://192.168.1.20:5173" defaultValue={s.publicBaseUrl ?? ''} onBlur={(e) => patch({ publicBaseUrl: e.target.value.trim() })} /></Field></div>
        </div>
        <Notice tone="info">DineFlow never sends SMS. Customers are notified inside their personal queue page, and staff see the same updates live.</Notice>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.autoNoShow} onChange={(e) => patch({ autoNoShow: e.target.checked })} /> Automatically release the table when a called group does not respond</label>
      </section>
    </div>
  )
}
export const AdminSettings = wrap('Kitchen & restaurant settings', SettingsInner)
