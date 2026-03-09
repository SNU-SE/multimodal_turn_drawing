import { useEffect, useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
// Super Admin
import SuperAdminLogin from "./pages/superadmin/SuperAdminLogin"
import SuperAdminLayout from "./pages/superadmin/SuperAdminLayout"
import SuperAdminDashboard from "./pages/superadmin/SuperAdminDashboard"
import OrgDetail from "./pages/superadmin/OrgDetail"
// Org (shared admin components)
import OrgLogin from "./pages/org/OrgLogin"
import OrgLayout from "./pages/org/OrgLayout"
import OrgAdminDashboard from "./pages/org/OrgAdminDashboard"
// Shared admin components (reused by super_admin and teacher)
import AdminDashboard from "./pages/admin/AdminDashboard"
import AdminRoomGroup from "./pages/admin/AdminRoomGroup"
import AdminRecap from "./pages/admin/AdminRecap"
import AdminBank from "./pages/admin/AdminBank"
import AdminObserve from "./pages/admin/AdminObserve"
// Auth
import AuthGuard from "./components/auth/AuthGuard"
// Player
import DeviceGuard from "./components/DeviceGuard"
import Home from "./pages/Home"
import RoomWrapper from "./pages/room/RoomWrapper"
import { getMyProfile } from "./lib/auth"

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Super Admin Routes */}
                <Route path="/superadmin/login" element={<SuperAdminLogin />} />
                <Route path="/superadmin" element={
                    <AuthGuard allowedRoles={["super_admin"]} redirectTo="/superadmin/login">
                        <SuperAdminLayout />
                    </AuthGuard>
                }>
                    <Route index element={<SuperAdminDashboard />} />
                    <Route path="orgs/:neisCode" element={<OrgDetail />} />
                    <Route path="groups" element={<AdminDashboard />} />
                    <Route path="groups/:groupId" element={<AdminRoomGroup />} />
                    <Route path="recap/:roomId" element={<AdminRecap />} />
                    <Route path="observe/:roomId" element={<AdminObserve />} />
                    <Route path="questions" element={<AdminBank />} />
                </Route>

                {/* Organization Routes (org_admin + teacher) */}
                <Route path="/:neis/admin/login" element={<OrgLogin />} />
                <Route path="/:neis/admin" element={
                    <AuthGuard allowedRoles={["org_admin", "teacher"]} redirectTo="login">
                        <OrgLayout />
                    </AuthGuard>
                }>
                    <Route index element={<OrgRouteIndex />} />
                    <Route path="groups/:groupId" element={<AdminRoomGroup />} />
                    <Route path="recap/:roomId" element={<AdminRecap />} />
                    <Route path="observe/:roomId" element={<AdminObserve />} />
                    <Route path="questions" element={<AdminBank />} />
                </Route>

                {/* Public / Player Routes */}
                <Route path="/" element={<DeviceGuard><Home /></DeviceGuard>} />
                <Route path="/room/:code" element={<DeviceGuard><RoomWrapper /></DeviceGuard>} />

                {/* Legacy redirect */}
                <Route path="/admin/*" element={<Navigate to="/" replace />} />

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    )
}

/** Route index component: shows org_admin dashboard or teacher dashboard based on role */
function OrgRouteIndex() {
    const [role, setRole] = useState<string | null>(null)

    useEffect(() => {
        getMyProfile().then((p) => setRole(p?.role || null))
    }, [])

    if (!role) return null
    if (role === "org_admin") return <OrgAdminDashboard />
    return <AdminDashboard />
}
