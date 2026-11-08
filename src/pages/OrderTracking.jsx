import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CustomerShell } from '../components/Layouts.jsx'
import { OrderCard } from '../components/OrderStatus.jsx'
import { Notice } from '../components/ui.jsx'
import { useStore } from '../lib/store.jsx'

export default function OrderTracking() {
  const { orderId } = useParams()
  const { state, act } = useStore()
  const [error, setError] = useState('')
  const order = state.orders.find((o) => o.id === orderId)

  if (!order) {
    return (
      <CustomerShell title="Order" back="/">
        <div className="p-6 text-center text-sm text-slate-500">We could not find this order.</div>
      </CustomerShell>
    )
  }
  const back = order.type === 'qr' ? `/table/${order.tableId}` : `/queue/${order.queueEntryId}`
  const cancelItem = async (item) => {
    const r = await act('cancelOrderItem', { orderItemId: item.id })
    if (!r.ok) setError(r.error)
  }
  return (
    <CustomerShell title={`Order ${order.orderNo}`} subtitle="Live tracking" back={back}>
      <div className="space-y-4 p-4">
        <OrderCard order={order} link={false} allowCancel onCancelItem={cancelItem} />
        {error && <Notice tone="bad">{error}</Notice>}
        {order.status === 'pending_payment' && <Notice tone="warn">This order has not been paid yet, so the kitchen has not received it.</Notice>}
        <Link to={back} className="btn-primary w-full">{order.type === 'qr' ? 'Order more' : 'Back to my queue'}</Link>
      </div>
    </CustomerShell>
  )
}
