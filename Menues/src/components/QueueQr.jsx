import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Copy, ExternalLink, Check } from 'lucide-react'
import { useStore } from '../lib/store.jsx'
import { fmtTime } from '../lib/util.js'

// Personal queue QR. The address contains only a random secret, never a phone number.
export function personalUrl(baseUrl, secret) {
  return `${baseUrl.replace(/\/+$/, '')}/queue/session/${secret}`
}

export default function QueueQr({ secret, expiresAt, size = 220, scanned = false }) {
  const { baseUrl } = useStore()
  const [copied, setCopied] = useState(false)
  const url = personalUrl(baseUrl, secret)
  const copy = async () => {
    try { await navigator.clipboard.writeText(url) } catch {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="text-center">
      <div className="mx-auto inline-block rounded-2xl border border-line bg-white p-3">
        <QRCodeSVG value={url} size={size} level="M" marginSize={1} />
      </div>
      <div className="mt-2 text-xs text-muted">{scanned ? '✓ Scanned on the customer’s phone' : 'Customer scans this with their phone camera'}{expiresAt ? ` · valid until ${fmtTime(expiresAt)}` : ''}</div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <a className="btn-ghost !py-2 text-xs" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Simulate customer scan</a>
        <button className="btn-ghost !py-2 text-xs" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy customer URL'}</button>
      </div>
      <div className="mt-2 break-all text-[11px] text-muted">{url}</div>
    </div>
  )
}
