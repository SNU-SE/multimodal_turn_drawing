import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import AdminLayout from "./pages/admin/AdminLayout"
import AdminLogin from "./pages/admin/AdminLogin"
import AdminDashboard from "./pages/admin/AdminDashboard"
import AdminRoomGroup from "./pages/admin/AdminRoomGroup"
import AdminRecap from "./pages/admin/AdminRecap"
import AdminBank from "./pages/admin/AdminBank"
import AuthGuard from "./components/auth/AuthGuard"
import DeviceGuard from "./components/DeviceGuard"
import Home from "./pages/Home"
import RoomWrapper from "./pages/room/RoomWrapper"

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Admin Routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AuthGuard><AdminLayout /></AuthGuard>}>
                    <Route index element={<AdminDashboard />} />
                    <Route path="groups/:groupId" element={<AdminRoomGroup />} />
                    <Route path="recap/:roomId" element={<AdminRecap />} />
                    <Route path="questions" element={<AdminBank />} />
                </Route>

                {/* Public / Player Routes (with mobile guard) */}
                <Route path="/" element={<DeviceGuard><Home /></DeviceGuard>} />
                <Route path="/room/:code" element={<DeviceGuard><RoomWrapper /></DeviceGuard>} />

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    )
}
