// The restaurant's logo mark and name. Files live in /public (logo-mark.png, logo-mark-white.png, logo-full.png).
export function LogoMark({ size = 36, white = false, className = '' }) {
  return <img src={white ? '/logo-mark-white.png' : '/logo-mark.png'} alt="" width={size} height={size} className={`shrink-0 object-contain ${className}`} />
}

// Mark + name side by side, for headers.
export function Brand({ name = 'Menues', size = 34, white = false, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} white={white} />
      <span className={`font-brand text-[1.45rem] font-bold leading-none ${white ? 'text-white' : 'text-navy'}`}>{name}</span>
    </span>
  )
}

// The full logo (mark above name) for big spots such as the home page.
export function LogoFull({ width = 200, className = '' }) {
  return <img src="/logo-full.png" alt="Menues" width={width} className={`mx-auto h-auto ${className}`} />
}
