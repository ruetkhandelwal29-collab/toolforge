import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../common/LoadingSpinner'

export default function AdminRoute() {
  const { isAuthenticated, isAdmin, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner size="lg" /></div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
