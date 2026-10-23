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
import AdminDashboard from './pages/AdminDashboard'
import WorkflowLibrary from './pages/WorkflowLibrary'
import WorkflowEditor from './pages/WorkflowEditor'
import WorkflowRunner from './pages/WorkflowRunner'
import WorkflowHistory from './pages/WorkflowHistory'
import WorkflowRunDetail from './pages/WorkflowRunDetail'
import ProtectedRoute from './components/auth/ProtectedRoute'
import CreatorRoute from './components/auth/CreatorRoute'
import AdminRoute from './components/auth/AdminRoute'

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
            {/* Workflow routes — library and runner are public-accessible */}
            <Route path="/workflows" element={<WorkflowLibrary />} />
            <Route path="/workflows/history" element={<WorkflowHistory />} />
            <Route path="/workflows/runs/:runId" element={<WorkflowRunDetail />} />
            <Route path="/workflows/:id/run" element={<WorkflowRunner />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<UserDashboard />} />
              <Route path="/workflows/new" element={<WorkflowEditor />} />
              <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
            </Route>
            <Route element={<CreatorRoute />}>
              <Route path="/creator/dashboard" element={<CreatorDashboard />} />
              <Route path="/creator/tools/new" element={<CreateTool />} />
              <Route path="/creator/tools/:id/edit" element={<EditTool />} />
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </AuthProvider>
  )
}
