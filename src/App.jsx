import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import JoinQueue from './pages/JoinQueue.jsx'
import QueueSession from './pages/QueueSession.jsx'
import QueueTracker from './pages/QueueTracker.jsx'
import MenuPage from './pages/MenuPage.jsx'
import TableOrder from './pages/TableOrder.jsx'
import OrderTracking from './pages/OrderTracking.jsx'
import Staff from './pages/Staff.jsx'
import Kitchen from './pages/Kitchen.jsx'
import Analytics from './pages/Analytics.jsx'
import HowItWorks from './pages/HowItWorks.jsx'
import { AdminInventory, AdminPrepAI, AdminFloorPlan, AdminLoyalty } from './pages/AdminOps.jsx'
import { AdminMenu, AdminOverview, AdminSettings, AdminTables } from './pages/Admin.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/join-queue" element={<JoinQueue />} />
      <Route path="/queue/session/:secret" element={<QueueSession />} />
      <Route path="/queue/:token" element={<QueueTracker />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/table/:tableId" element={<TableOrder />} />
      <Route path="/order/:orderId" element={<OrderTracking />} />
      <Route path="/staff" element={<Staff />} />
      <Route path="/kitchen" element={<Kitchen />} />
      <Route path="/admin" element={<AdminOverview />} />
      <Route path="/admin/menu" element={<AdminMenu />} />
      <Route path="/admin/tables" element={<AdminTables />} />
      <Route path="/admin/analytics" element={<Analytics />} />
      <Route path="/admin/inventory" element={<AdminInventory />} />
      <Route path="/admin/prep-ai" element={<AdminPrepAI />} />
      <Route path="/admin/floor-plan" element={<AdminFloorPlan />} />
      <Route path="/admin/loyalty" element={<AdminLoyalty />} />
      <Route path="/admin/settings" element={<AdminSettings />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
