import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import AdminLayout from "./pages/admin/AdminLayout"
import AdminDashboard from "./pages/admin/AdminDashboard"
import AdminRoomGroup from "./pages/admin/AdminRoomGroup"
import AdminRecap from "./pages/admin/AdminRecap"
import Home from "./pages/Home"
import RoomWrapper from "./pages/room/RoomWrapper"

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Admin Routes */}
                <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminDashboard />} />
                    <Route path="groups/:groupId" element={<AdminRoomGroup />} />
                    <Route path="recap/:roomId" element={<AdminRecap />} />
                    <Route path="questions" element={<div className="p-8">문제 은행 개발중...</div>} />
                </Route>

                {/* Public / Player Routes */}
                <Route path="/" element={<Home />} />
                <Route path="/room/:code" element={<RoomWrapper />} />

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    )
}
