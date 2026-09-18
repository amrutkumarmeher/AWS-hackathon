import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout, Guard, PublicLayout, StaffLayout } from "./layouts";
import {
  CustomerLogin,
  HowItWorks,
  Landing,
  LiveQueue,
  RatePage,
  ServiceDetail,
  ServicesPage,
  Tracker,
} from "./pages/public";
import { StaffDashboard, StaffHistory, StaffLogin, StaffQueue } from "./pages/staff";
import {
  AdminAlerts,
  AdminAnalytics,
  AdminChannels,
  AdminCounters,
  AdminDashboard,
  AdminLogin,
  AdminQueues,
  AdminServices,
  AdminSettings,
  AdminStaff,
} from "./pages/admin";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/services/:id" element={<ServiceDetail />} />
          <Route path="/login" element={<CustomerLogin />} />
          <Route path="/queue/:id" element={<Tracker />} />
          <Route path="/queue/live/:id" element={<LiveQueue />} />
          <Route path="/rate/:id" element={<RatePage />} />
        </Route>
        <Route path="/staff/login" element={<StaffLogin />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/staff"
          element={
            <Guard role="staff">
              <StaffLayout />
            </Guard>
          }
        >
          <Route index element={<StaffDashboard />} />
          <Route path="queue" element={<StaffQueue />} />
          <Route path="history" element={<StaffHistory />} />
        </Route>
        <Route
          path="/admin"
          element={
            <Guard role="admin">
              <AdminLayout />
            </Guard>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="queues" element={<AdminQueues />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="counters" element={<AdminCounters />} />
          <Route path="staff" element={<AdminStaff />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="channels" element={<AdminChannels />} />
          <Route path="alerts" element={<AdminAlerts />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
