import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../common/LoadingSpinner'

export default function CreatorRoute() {
  const { isAuthenticated, isCreator, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner size="lg" /></div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isCreator) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
