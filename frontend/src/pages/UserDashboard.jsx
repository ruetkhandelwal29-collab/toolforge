import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Heart, History } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import apiClient from '../services/apiClient'
import ToolCard from '../components/marketplace/ToolCard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

export default function UserDashboard() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [becomingCreator, setBecomingCreator] = useState(false)

  const { data: favData, isLoading: favLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => apiClient.get('/api/favorites').then(r => r.data),
  })

  const { data: historyData, isLoading: histLoading } = useQuery({
    queryKey: ['run-history'],
    queryFn: () => apiClient.get('/api/users/history').then(r => r.data),
  })

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-10">
        <div className="w-16 h-16 rounded-2xl bg-brand-700 flex items-center justify-center text-2xl font-bold text-white shrink-0">
          {profile?.username?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{profile?.full_name ?? profile?.username}</h1>
          <p className="text-sm text-gray-500">@{profile?.username} · <span className="capitalize">{profile?.role}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Favorites */}
          <section>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Heart size={18} className="text-red-400" /> Favorite Tools
            </h2>
            {favLoading ? (
              <LoadingSpinner />
            ) : favData?.favorites?.length === 0 ? (
              <p className="text-sm text-gray-500">
                No favorites yet.{' '}
                <Link to="/marketplace" className="text-brand-400 hover:text-brand-300">Browse tools →</Link>
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {favData?.favorites?.map(t => <ToolCard key={t.id} tool={t} />)}
              </div>
            )}
          </section>

          {/* Run History */}
          <section>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <History size={18} className="text-brand-400" /> Recent Runs
            </h2>
            {histLoading ? (
              <LoadingSpinner />
            ) : historyData?.runs?.length === 0 ? (
              <p className="text-sm text-gray-500">No runs yet. <Link to="/marketplace" className="text-brand-400 hover:text-brand-300">Try a tool →</Link></p>
            ) : (
              <div className="space-y-2">
                {historyData?.runs?.slice(0, 15).map(run => (
                  <div key={run.id} className="card p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link to={`/tools/${run.tool_slug}`} className="text-sm font-medium text-white hover:text-brand-300 truncate block">
                        {run.tool_name}
                      </Link>
                      <p className="text-xs text-gray-500 mt-0.5">{new Date(run.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {run.tokens_used && (
                        <span className="text-xs text-gray-600">{run.tokens_used} tokens</span>
                      )}
                      <span className={`badge text-xs ${
                        run.status === 'completed'
                          ? 'bg-emerald-900/40 text-emerald-300'
                          : 'bg-red-900/40 text-red-300'
                      }`}>
                        {run.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Account Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Role</span>
                <span className="text-gray-300 capitalize">{profile?.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Member since</span>
                <span className="text-gray-300">
                  {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total runs</span>
                <span className="text-gray-300">{historyData?.runs?.length ?? 0}</span>
              </div>
            </div>
            {profile?.role === 'user' && (
              <div className="border-t border-white/8 mt-4 pt-4">
                <p className="text-xs text-gray-500 mb-3">Want to publish your own AI tools?</p>
                <button
                  disabled={becomingCreator}
                  className="btn-primary w-full text-xs py-2"
                  onClick={async () => {
                    setBecomingCreator(true)
                    try {
                      await apiClient.post('/api/auth/become-creator')
                      await refreshProfile()
                      toast.success('You are now a creator!')
                      navigate('/creator/dashboard')
                    } catch {
                      toast.error('Could not upgrade account. Try again.')
                    } finally {
                      setBecomingCreator(false)
                    }
                  }}
                >
                  {becomingCreator ? 'Upgrading…' : 'Become a Creator'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
