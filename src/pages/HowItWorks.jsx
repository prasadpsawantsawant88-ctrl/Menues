import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, BellRing, ChefHat, ClipboardList, CreditCard, Flame, QrCode, Smartphone, Table2, Timer, UtensilsCrossed, Users, BookOpen, CheckCircle2, Eye, Clock, ShoppingBag, Hand } from 'lucide-react'

// Simple vector-style flow diagrams: icon + title + one plain-language line per step.
const FLOWS = [
  {
    id: 'A',
    title: 'A · Overall restaurant transformation',
    intro: 'One connected journey replaces the paper waiting list, shouting across the kitchen and guessing how long things take.',
    steps: [
      [Smartphone, 'Customer registration', 'Phone number and group size on a tablet or QR code.'],
      [Users, 'Queue management', 'A token and a live wait estimate. No paper list.'],
      [BookOpen, 'Menu browsing', 'Guests read the menu on their own phone.'],
      [ShoppingBag, 'Pre-order or wait', 'Order and pay while waiting, or just wait.'],
      [Table2, 'Table allocation', 'Staff seat the right group at the right table.'],
      [ChefHat, 'Kitchen processing', 'Each station gets its dishes at the right time.'],
      [UtensilsCrossed, 'Food served', 'Food arrives soon after sitting down.'],
    ],
  },
  {
    id: 'B',
    title: 'B · Pre-order journey',
    intro: 'The key idea: guests spend their waiting time ordering, and the kitchen cooks to the clock.',
    steps: [
      [Users, 'Join queue', 'Register at the kiosk or on your phone.'],
      [BellRing, 'Receive token', 'Q024 and a personal QR code (no SMS).'],
      [BookOpen, 'Browse menu', 'See dishes with prep estimates.'],
      [ShoppingBag, 'Select dishes', 'Choose, customise, add notes.'],
      [CreditCard, 'Test payment', 'Paid before the kitchen is told.'],
      [Timer, 'Kitchen scheduling', 'Cooking is timed to the seating time.'],
      [Table2, 'Table allocation', 'Staff call the guest to their table.'],
      [UtensilsCrossed, 'Food served', 'Dishes arrive hot and together.'],
    ],
  },
  {
    id: 'C',
    title: 'C · QR ordering at the table',
    intro: 'Scan, order, pay and watch it cook. Waiters take no orders, so nothing is misheard.',
    steps: [
      [Table2, 'Get seated', 'The host seats the group.'],
      [QrCode, 'Scan table QR', 'The page already knows the table.'],
      [BookOpen, 'View menu', 'Photos, prices, descriptions.'],
      [Clock, 'View prep estimates', 'Per dish and for the whole order.'],
      [ShoppingBag, 'Place order', 'Pay by test payment.'],
      [ChefHat, 'Kitchen receives', 'Order appears with the table number.'],
      [Flame, 'Preparing', 'Chefs start and tap Ready.'],
      [CheckCircle2, 'Ready → Served', 'The guest sees every step live.'],
    ],
  },
  {
    id: 'D',
    title: 'D · Intelligent kitchen scheduling',
    intro: 'Work backwards from the moment guests sit down so food is ready then, not 20 minutes earlier or later.',
    steps: [
      [Clock, 'Expected seating time', 'Predicted from tables and dining times.'],
      [Timer, 'Dish preparation times', 'Each dish has a standard time.'],
      [Flame, 'Station workload', 'Chefs per station and dishes already booked.'],
      [ClipboardList, 'Scheduled start times', 'Start = seating time − prep time.'],
      [CheckCircle2, 'Food ready', 'Everything finishes together at seating.'],
    ],
  },
]

function Flow({ flow }) {
  return (
    <section className="card p-5" id={`flow-${flow.id}`}>
      <h2 className="text-xl font-extrabold">{flow.title}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">{flow.intro}</p>
      <ol className="flex flex-col items-stretch gap-1 lg:flex-row lg:flex-wrap lg:items-stretch">
        {flow.steps.map(([Icon, title, text], i) => (
          <li key={title} className="flex flex-col items-center gap-1 lg:flex-row">
            <div className="w-full rounded-2xl border border-brand-100 bg-brand-50 p-3 lg:w-40">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white"><Icon size={16} /></span>
                <span className="text-[11px] font-bold text-brand-700">STEP {i + 1}</span>
              </div>
              <div className="mt-1.5 text-sm font-bold">{title}</div>
              <div className="text-xs text-slate-600">{text}</div>
            </div>
            {i < flow.steps.length - 1 && (
              <>
                <ArrowDown className="text-brand-600 lg:hidden" size={18} />
                <ArrowRight className="hidden text-brand-600 lg:block" size={18} />
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold">How it works</h1>
            <p className="text-slate-600">Four process flows for restaurant owners. No technical knowledge needed.</p>
          </div>
          <Link to="/" className="btn-ghost">← Home</Link>
        </div>
        {FLOWS.map((f) => <Flow key={f.id} flow={f} />)}
        <section className="card p-5">
          <h2 className="text-xl font-extrabold">Why it helps (what to measure)</h2>
          <ul className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <li>Shorter perceived waiting: guests are busy ordering instead of standing.</li>
            <li>Less time between sitting down and the first dish: cooking is timed to seating.</li>
            <li>Better table turnover: guests who pre-order eat sooner and free the table sooner.</li>
            <li>Fewer order mistakes: guests type their own order and the kitchen reads it on screen.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">These are the outcomes to measure in a real pilot. The demo's analytics page uses synthetic data and does not claim real improvements.</p>
        </section>
      </div>
    </div>
  )
}
