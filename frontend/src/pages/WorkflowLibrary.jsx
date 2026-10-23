/**
 * WorkflowLibrary — Phase 12
 * Lists the authenticated user's workflows AND allows browsing public workflows.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  GitBranch, Plus, Globe, Lock, Loader2, Play, ChevronRight, Search, Layers
} from 'lucide-react'
import apiClient from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'

function WorkflowCard({ wf, isOwner }) {
  return (
    <div className="card-hover p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm leading-snug truncate">{wf.name}</h3>
          {wf.description && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{wf.description}</p>
          )}
        </div>
        <span className={`shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
          wf.is_published ? 'bg-emerald-900/40 text-emerald-300' : 'bg-white/8 text-gray-400'
        }`}>
          {wf.is_published ? <Globe size={11} /> : <Lock size={11} />}
          {wf.is_published ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <Layers size={12} />
          {wf.step_count ?? 0} steps
        </span>
        {wf.run_count !== undefined && (
          <span className="flex items-center gap-1.5">
            <Play size={11} />
            {wf.run_count ?? 0} runs
          </span>
        )}
        {wf.creator_username && !isOwner && (
          <span>by {wf.creator_username}</span>
        )}
      </div>

      <div className="flex gap-2 mt-auto pt-2 border-t border-white/5">
        {isOwner ? (
          <>
            <Link
              to={`/workflows/${wf.id}/edit`}
              className="btn-secondary py-1.5 text-xs flex-1 justify-center"
            >
              Edit
            </Link>
            <Link
              to={`/workflows/${wf.id}/run`}
              className="btn-primary py-1.5 text-xs flex-1 justify-center"
            >
              <Play size={13} /> Run
            </Link>
          </>
        ) : (
          <Link
            to={`/workflows/${wf.id}/run`}
            className="btn-primary py-1.5 text-xs w-full justify-center"
          >
            <Play size={13} /> Run Workflow
          </Link>
        )}
      </div>
    </div>
  )
}

export default function WorkflowLibrary() {
  const { isAuthenticated } = useAuth()
  const [tab, setTab]     = useState('mine')
  const [search, setSearch] = useState('')

  const myWorkflows = useQuery({
    queryKey: ['workflows', 'mine'],
    queryFn: () => apiClient.get('/api/workflows/mine').then(r => r.data.workflows),
    enabled: isAuthenticated,
  })

  const publicWorkflows = useQuery({
    queryKey: ['workflows', 'public', search],
    queryFn: () => apiClient.get(`/api/workflows/public?q=${encodeURIComponent(search)}&limit=50`).then(r => r.data.workflows),
  })

  const activeTab = isAuthenticated ? tab : 'public'

  const workflows  = activeTab === 'mine' ? (myWorkflows.data ?? []) : (publicWorkflows.data ?? [])
  const isLoading  = activeTab === 'mine' ? myWorkflows.isLoading : publicWorkflows.isLoading
  const isError    = activeTab === 'mine' ? myWorkflows.isError   : publicWorkflows.isError

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="section-title flex items-center gap-2.5">
            <GitBranch size={26} className="text-brand-400" />
            Workflow Library
          </h1>
          <p className="text-muted text-sm mt-1">Chain AI tools together into multi-step workflows.</p>
        </div>
        {isAuthenticated && (
          <Link to="/workflows/new" className="btn-primary shrink-0">
            <Plus size={16} /> New Workflow
          </Link>
        )}
      </div>

      {/* Tabs */}
      {isAuthenticated && (
        <div className="flex gap-1 bg-white/4 rounded-lg p-1 mb-6 w-fit">
          {[
            { id: 'mine',   label: 'My Workflows' },
            { id: 'public', label: 'Public' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Search (public tab only) */}
      {activeTab === 'public' && (
        <div className="relative mb-6 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="input pl-9"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="text-center py-20 text-gray-500">Failed to load workflows. Please try again.</div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && workflows.length === 0 && (
        <div className="text-center py-20">
          <GitBranch size={44} className="mx-auto text-gray-700 mb-4" />
          <p className="text-gray-400 text-lg font-medium">
            {activeTab === 'mine' ? 'No workflows yet' : 'No public workflows found'}
          </p>
          {activeTab === 'mine' && isAuthenticated && (
            <Link to="/workflows/new" className="btn-primary mt-4 inline-flex">
              <Plus size={16} /> Create your first workflow
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {!isLoading && !isError && workflows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {workflows.map(wf => (
            <WorkflowCard key={wf.id} wf={wf} isOwner={activeTab === 'mine'} />
          ))}
        </div>
      )}
    </div>
  )
}
