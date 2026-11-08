import { useEffect } from 'react'
import { X } from 'lucide-react'
import { STATUS_STYLES, statusLabel } from '../lib/util.js'

export function StatusChip({ status, label }) {
  return <span className={`chip ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'}`}>{label || statusLabel(status)}</span>
}

// Food "photograph": uses the dish image when one exists (admin upload / URL), otherwise an emoji tile.
export function DishImage({ item, className = 'h-24 w-24', rounded = 'rounded-2xl' }) {
  if (item.image) {
    return <img src={item.image} alt={item.name} loading="lazy" className={`${className} ${rounded} object-cover`} onError={(e) => (e.currentTarget.style.display = 'none')} />
  }
  const hue = [...item.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360
  return (
    <div
      className={`${className} ${rounded} flex shrink-0 items-center justify-center text-4xl`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 80% 92%), hsl(${(hue + 40) % 360} 75% 86%))` }}
      role="img"
      aria-label={item.name}
    >
      {item.emoji || '🍽️'}
    </div>
  )
}

export function VegMark({ veg }) {
  const color = veg ? 'border-green-600' : 'border-red-600'
  const dot = veg ? 'bg-green-600' : 'bg-red-600'
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border-2 ${color}`} title={veg ? 'Vegetarian' : 'Non-vegetarian'}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </span>
  )
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Stat({ label, value, sub, tone = 'default' }) {
  const tones = { default: 'text-slate-900', good: 'text-emerald-700', warn: 'text-amber-600', bad: 'text-red-600' }
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'bg-sky-50 border-sky-200 text-sky-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    bad: 'bg-red-50 border-red-200 text-red-800',
    good: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }
  return <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]}`}>{children}</div>
}

export function Confidence({ level }) {
  if (!level) return null
  const map = { high: ['bg-emerald-100 text-emerald-800', 'High confidence'], medium: ['bg-amber-100 text-amber-800', 'Medium confidence'], low: ['bg-red-100 text-red-700', 'Low confidence'] }
  const [cls, text] = map[level]
  return <span className={`chip ${cls}`}>{text}</span>
}

export function Empty({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>
}
