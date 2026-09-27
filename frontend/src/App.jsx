import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import Landing from './pages/Landing'
import Marketplace from './pages/Marketplace'
import ToolDetail from './pages/ToolDetail'
import Login from './pages/Login'
import Register from './pages/Register'
import CreatorDashboard from './pages/CreatorDashboard'
import CreateTool from './pages/CreateTool'
import EditTool from './pages/EditTool'
import UserDashboard from './pages/UserDashboard'
import NotFound from './pages/NotFound'
import ProtectedRoute from './components/auth/ProtectedRoute'
import CreatorRoute from './components/auth/CreatorRoute'

export default function App() {
  return (
    <AuthProvider>
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/tools/:slug" element={<ToolDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<UserDashboard />} />
            </Route>
            <Route element={<CreatorRoute />}>
              <Route path="/creator/dashboard" element={<CreatorDashboard />} />
              <Route path="/creator/tools/new" element={<CreateTool />} />
              <Route path="/creator/tools/:id/edit" element={<EditTool />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </AuthProvider>
  )
}
