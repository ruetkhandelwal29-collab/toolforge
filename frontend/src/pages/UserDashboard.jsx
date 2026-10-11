import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Heart, History, Coins, ArrowUpRight, ArrowDownLeft, RotateCcw } from 'lucide-react'
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

  const { data: favData, isLoading: favLoading, isError: favError } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => apiClient.get('/api/favorites').then(r => r.data),
  })

  const { data: historyData, isLoading: histLoading } = useQuery({
    queryKey: ['run-history'],
    queryFn: () => apiClient.get('/api/users/history').then(r => r.data),
  })

  const { data: creditData, isLoading: creditLoading } = useQuery({
    queryKey: ['credits'],
    queryFn: () => apiClient.get('/api/credits').then(r => r.data),
  })

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['credit-transactions'],
    queryFn: () => apiClient.get('/api/credits/transactions').then(r => r.data),
  })

  const favorites = favData?.favorites ?? []
  const transactions = txData?.transactions ?? []

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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Heart size={18} className="text-red-400 fill-red-400/20" /> Favorite Tools
              </h2>
              {favorites.length > 0 && (
                <span className="text-xs text-gray-500 font-medium">{favorites.length} saved</span>
              )}
            </div>

            {favLoading ? (
              <div className="flex justify-center py-10"><LoadingSpinner /></div>
            ) : favError ? (
              <div className="card p-6 text-center text-sm text-gray-500">
                Could not load favorites. Please refresh to try again.
              </div>
            ) : favorites.length === 0 ? (
              <div className="card p-8 text-center border-dashed border-white/10">
                <Heart size={28} className="text-gray-600 mx-auto mb-2" />
                <p className="text-gray-300 font-medium text-sm mb-1">No favorite tools saved yet</p>
                <p className="text-gray-500 text-xs mb-4">Click the bookmark heart on any tool in the marketplace to save it here.</p>
                <Link to="/marketplace" className="btn-secondary text-xs inline-flex">
                  Explore Marketplace →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {favorites.map(t => <ToolCard key={t.id} tool={t} />)}
              </div>
            )}
          </section>

          {/* Credit Transactions Ledger */}
          <section>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Coins size={18} className="text-amber-400" /> Credit History
            </h2>
            {txLoading ? (
              <LoadingSpinner />
            ) : transactions.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-500">
                No credit transactions yet.
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.slice(0, 10).map(tx => {
                  const isRefund = tx.type === 'refund' || tx.status === 'refunded' || tx.provider_tx_id?.startsWith('refund')
                  const isDebit = tx.direction === 'debit' || tx.provider_tx_id === 'tool_execution'
                  const isWelcome = tx.type === 'welcome_bonus' || tx.provider_tx_id === 'welcome_bonus'
                  const numAmount = Number(tx.amount)

                  return (
                    <div key={tx.id} className="card p-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isRefund
                            ? 'bg-blue-500/10 text-blue-400'
                            : isDebit
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {isRefund ? <RotateCcw size={14} /> : isDebit ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {tx.tool_name ? `Run: ${tx.tool_name}` : isWelcome ? 'Welcome Credit Bonus' : isRefund ? 'Execution Refund' : tx.provider_tx_id || 'Credit Adjustment'}
                          </p>
                          <p className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${
                          isRefund
                            ? 'text-blue-400'
                            : isDebit
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}>
                          {isRefund ? `+${numAmount} refunded` : isDebit ? `-${numAmount} credits` : `+${numAmount} credits`}
                        </p>
                        <span className={`badge text-[10px] ${
                          tx.status === 'completed'
                            ? isDebit ? 'bg-amber-900/30 text-amber-400' : 'bg-emerald-900/30 text-emerald-400'
                            : tx.status === 'refunded'
                            ? 'bg-blue-900/30 text-blue-400'
                            : 'bg-gray-800 text-gray-400'
                        }`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
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
          {/* Credit Balance Card */}
          <div className="card p-5 border-amber-500/20 bg-gradient-to-br from-surface-800 to-amber-950/20">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Coins size={16} className="text-amber-400" />
                </div>
                <span className="text-sm font-semibold text-gray-200">Credit Balance</span>
              </div>
              <span className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>
            <p className="text-3xl font-extrabold text-white mb-1">
              {creditLoading ? '…' : (creditData?.balance ?? 0)}
            </p>
            <p className="text-xs text-gray-400">
              Credits are deducted when running paid tools, and refunded automatically if an AI execution fails.
            </p>
          </div>

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
              <div className="flex justify-between">
                <span className="text-gray-500">Saved favorites</span>
                <span className="text-gray-300">{favorites.length}</span>
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
