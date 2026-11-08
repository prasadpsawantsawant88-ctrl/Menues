import { Link } from 'react-router-dom'
import { CustomerShell } from '../components/Layouts.jsx'
import MenuBrowser from '../components/MenuBrowser.jsx'
import { Notice } from '../components/ui.jsx'

export default function MenuPage() {
  return (
    <CustomerShell title="Our menu" back="/">
      <div className="mx-4 mt-3">
        <Notice tone="info">
          You can browse here. To order, <Link className="font-bold underline" to="/join-queue">join the queue</Link> and pre-order while you wait, or scan the QR code on your table.
        </Notice>
      </div>
      <MenuBrowser mode="browse" />
    </CustomerShell>
  )
}
