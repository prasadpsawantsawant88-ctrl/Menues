import { Brand } from '../components/Brand.jsx'
import { Link } from 'react-router-dom'
import { ChefHat, ClipboardList, LayoutDashboard, Users, Utensils, Workflow, QrCode, Clock } from 'lucide-react'
import { useStore, useNow } from '../lib/store.jsx'
import { predictWait } from '../lib/engines.js'
import { StatusBanners, SyncBadge } from '../components/Layouts.jsx'

export default function Landing() {
  const { state } = useStore()
  const now = useNow(10000)
  const waiting = state.queue.filter((q) => q.status === 'waiting').length
  const p2 = predictWait(state, { partySize: 2 }, now)
  const p4 = predictWait(state, { partySize: 4 }, now)
  const occupied = state.tables.filter((t) => t.status === 'occupied').length

  const staffLinks = [
    { to: '/staff', icon: ClipboardList, title: 'Staff dashboard', text: 'Queue, tables, seating, pre-orders' },
    { to: '/kitchen', icon: ChefHat, title: 'Kitchen display', text: 'Orders by station, schedules, status' },
    { to: '/admin', icon: LayoutDashboard, title: 'Admin & analytics', text: 'Menu, tables, QR codes, KPIs' },
    { to: '/kiosk', icon: QrCode, title: 'Entrance kiosk', text: 'Check-in screen with personal QR', external: true },
    { to: '/how-it-works', icon: Workflow, title: 'How it works', text: 'The four process flow diagrams' },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <StatusBanners />
      <div className="bg-gradient-to-b from-brand-100 to-slate-50">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-8">
          <div className="flex items-center justify-between">
            <Brand name={state.settings.restaurantName} />
            <SyncBadge />
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <div className="chip bg-white text-brand-700">Digital transformation demo</div>
              <h1 className="mt-3 text-4xl font-extrabold leading-tight">{state.settings.restaurantName}</h1>
              <p className="mt-3 text-lg text-slate-600">Skip the crowd at the door. Join the queue from your phone, pre-order while you wait, and have your food ready when you sit down.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/join-queue" className="btn-primary !px-6 !py-3 text-base"><Users size={18} /> Join the queue</Link>
                <Link to="/menu" className="btn-ghost !px-6 !py-3 text-base">View menu</Link>
              </div>
            </div>
            <div className="card grid grid-cols-3 divide-x divide-slate-100 p-4 text-center">
              <div><div className="text-3xl font-extrabold">{waiting}</div><div className="text-xs text-slate-500">groups waiting</div></div>
              <div><div className="text-3xl font-extrabold">{p2.waitMin ?? '–'}<span className="text-base"> min</span></div><div className="text-xs text-slate-500">wait for 2</div></div>
              <div><div className="text-3xl font-extrabold">{p4.waitMin ?? '–'}<span className="text-base"> min</span></div><div className="text-xs text-slate-500">wait for 4</div></div>
              <div className="col-span-3 mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><Clock size={12} className="mr-1 inline" />{occupied} of {state.tables.length} tables occupied · waits are estimates</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-8 px-4 pb-16">
        <section>
          <h2 className="mb-3 text-lg font-extrabold">Restaurant team</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {staffLinks.map((l) => {
              const Tag = l.external ? 'a' : Link
              const target = l.external ? { href: l.to } : { to: l.to }
              return (
                <Tag key={l.to} {...target} className="card p-4 transition hover:border-brand-500">
                  <l.icon className="text-brand-600" />
                  <div className="mt-2 font-bold">{l.title}</div>
                  <div className="text-sm text-slate-500">{l.text}</div>
                </Tag>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">Demo logins: <code>staff / 1111</code> · <code>kitchen / 2222</code> · <code>admin / 9999</code> (admin can open every area).</p>
        </section>

        <section>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-extrabold"><QrCode size={18} /> Table QR ordering</h2>
          <p className="mb-3 text-sm text-slate-500">Each table has its own QR code (print them from Admin → Tables). Tap a table to open the page its QR opens. Tables with guests seated can order.</p>
          <div className="flex flex-wrap gap-2">
            {state.tables.map((t) => (
              <Link key={t.id} to={`/table/${t.id}`} className={`chip border px-3 py-1.5 ${t.status === 'occupied' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                {t.id} · {t.capacity} seats {t.status === 'occupied' ? '· seated' : ''}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
