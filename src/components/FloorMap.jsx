// Floor plan drawn from state.layout and state.tables. Used read-only on the staff screen and, with
// drag handlers, in the admin floor-plan editor.
const STATUS_FILL = { available: '#dcfce7', occupied: '#fee2e2', cleaning: '#fef3c7', held: '#dbeafe', blocked: '#e2e8f0' }
const STATUS_STROKE = { available: '#16a34a', occupied: '#dc2626', cleaning: '#d97706', held: '#2563eb', blocked: '#64748b' }

export function FloorMap({ layout, tables, selected, onSelect, onDown, svgRef, byZone = false, onMove, onUp }) {
  const zoneColor = (name) => layout.zones.find((z) => z.name === name)?.color || '#94a3b8'
  return (
    <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full touch-none select-none rounded-2xl border border-slate-200 bg-white" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="1" /></pattern></defs>
      <rect width={layout.width} height={layout.height} fill="url(#grid)" />
      {layout.items.map((it) => (
        <g key={it.id} onPointerDown={onDown ? (e) => onDown(e, 'item', it) : undefined} onClick={() => onSelect?.('item', it.id)} style={{ cursor: onDown ? 'move' : 'default' }}>
          <rect x={it.x} y={it.y} width={it.w} height={it.h} rx="8" fill="#f1f5f9" stroke={selected === it.id ? '#0f766e' : '#cbd5e1'} strokeWidth={selected === it.id ? 3 : 1.5} strokeDasharray="6 4" />
          <text x={it.x + it.w / 2} y={it.y + it.h / 2 + 5} textAnchor="middle" fontSize="14" fill="#475569" fontWeight="600">{it.label}</text>
        </g>
      ))}
      {tables.map((t) => {
        const fill = byZone ? zoneColor(t.zone) + '33' : STATUS_FILL[t.status] || '#fff'
        const stroke = byZone ? zoneColor(t.zone) : STATUS_STROKE[t.status] || '#64748b'
        const common = { fill, stroke: selected === t.id ? '#0f172a' : stroke, strokeWidth: selected === t.id ? 3.5 : 2 }
        return (
          <g key={t.id} onPointerDown={onDown ? (e) => onDown(e, 'table', t) : undefined} onClick={() => onSelect?.('table', t.id)} style={{ cursor: onDown ? 'move' : onSelect ? 'pointer' : 'default' }}>
            {t.shape === 'round' ? <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w / 2} ry={t.h / 2} {...common} /> : <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.shape === 'square' ? 8 : 6} {...common} />}
            <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 2} textAnchor="middle" fontSize="15" fontWeight="800" fill="#0f172a">{t.id}</text>
            <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 14} textAnchor="middle" fontSize="11" fill="#475569">{t.capacity} seats</text>
          </g>
        )
      })}
    </svg>
  )
}

export function FloorLegend({ layout, byZone }) {
  const items = byZone ? layout.zones.map((z) => [z.color, z.name]) : [['#16a34a', 'Free'], ['#dc2626', 'Occupied'], ['#d97706', 'Cleaning'], ['#2563eb', 'Held for a group'], ['#64748b', 'Blocked']]
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {items.map(([c, n]) => <span key={n} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: c }} />{n}</span>)}
    </div>
  )
}
