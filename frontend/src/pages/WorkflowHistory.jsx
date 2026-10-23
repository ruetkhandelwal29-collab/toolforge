/**
 * WorkflowHistory — Phase 12
 * Shows the authenticated user's workflow run history (all runs across all their workflows).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  GitBranch, CheckCircle2, XCircle, AlertTriangle, Clock,
  Coins, ChevronRight, Loader2, RefreshCw
} from 'lucide-react'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { useAuth } from '../contexts/AuthContext'

const PAGE_SIZE = 15

function StatusBadge({ status }) {
  const map = {
    completed: 'bg-emerald-900/40 text-emerald-300',
    failed:    'bg-red-900/40 text-red-300',
    partial:   'bg-amber-900/40 text-amber-300',
    running:   'bg-brand-900/40 text-brand-300',
    pending:   'bg-white/8 text-gray-400',
  }
  const icons = {
    completed: <CheckCircle2 size={11} />,
    failed:    <XCircle size={11} />,
    partial:   <AlertTriangle size={11} />,
    running:   <Loader2 size={11} className="animate-spin" />,
    pending:   <Clock size={11} />,
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-white/8 text-gray-400'}`}>
      {icons[status]}
      {status}
    </span>
  )
}

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function WorkflowHistory() {
  const { isAuthenticated } = useAuth()
  const [page, setPage] = useState(0)

  const offset = page * PAGE_SIZE
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['workflow-runs-user', page],
    queryFn: () => apiClient.get(`/api/workflows/user/runs?limit=${PAGE_SIZE}&offset=${offset}`).then(r => r.data),
    enabled: isAuthenticated,
    staleTime: 30000,
  })

  const runs  = data?.runs ?? []
  const total = data?.total ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title flex items-center gap-2.5">
            <GitBranch size={24} className="text-brand-400" />
            Workflow History
          </h1>
          <p className="text-muted text-sm mt-1">All your workflow execution runs.</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary py-1.5 text-xs"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      )}

      {isError && (
        <div className="text-center py-20 text-gray-500">Failed to load history. Please try again.</div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <div className="text-center py-20">
          <GitBranch size={44} className="mx-auto text-gray-700 mb-4" />
          <p className="text-gray-400 font-medium">No workflow runs yet</p>
          <Link to="/workflows" className="btn-primary mt-4 inline-flex">Browse Workflows</Link>
        </div>
      )}

      {!isLoading && runs.length > 0 && (
        <>
          <div className="card divide-y divide-white/5">
            {runs.map(run => (
              <div key={run.id} className="flex items-center gap-4 px-5 py-4 hover:bg-white/2 transition-colors">
                <StatusBadge status={run.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{run.workflow_name}</p>
                  <p className="text-xs text-gray-500">{formatTime(run.created_at)}</p>
                </div>
                {run.credits_total > 0 && (
                  <div className="flex items-center gap-1 text-xs text-amber-400 shrink-0">
                    <Coins size={12} /> {run.credits_total}
                  </div>
                )}
                <Link
                  to={`/workflows/runs/${run.id}`}
                  className="shrink-0 text-gray-500 hover:text-white transition-colors"
                >
                  <ChevronRight size={16} />
                </Link>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <span className="text-xs text-gray-500">{total} total runs</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="btn-secondary py-1.5 text-xs disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-400">
                  {page + 1} / {pages}
                </span>
                <button
                  disabled={page >= pages - 1}
                  onClick={() => setPage(p => p + 1)}
                  className="btn-secondary py-1.5 text-xs disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
