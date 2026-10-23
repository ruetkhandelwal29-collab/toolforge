/**
 * WorkflowRunDetail — Phase 12
 * Shows full detail for a single workflow run: status, step-by-step outputs.
 */
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  GitBranch, CheckCircle2, XCircle, AlertTriangle, Clock,
  Loader2, SkipForward, Coins, ChevronRight, Copy, CheckCheck
} from 'lucide-react'
import { useState } from 'react'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'

function StatusIcon({ status, size = 16 }) {
  if (status === 'completed') return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />
  if (status === 'failed')    return <XCircle size={size}       className="text-red-400 shrink-0" />
  if (status === 'partial')   return <AlertTriangle size={size} className="text-amber-400 shrink-0" />
  if (status === 'running')   return <Loader2 size={size}       className="text-brand-400 animate-spin shrink-0" />
  if (status === 'skipped')   return <SkipForward size={size}   className="text-gray-600 shrink-0" />
  return <Clock size={size} className="text-gray-600 shrink-0" />
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
      {copied ? <><CheckCheck size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  )
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function WorkflowRunDetail() {
  const { runId } = useParams()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workflow-run-detail', runId],
    queryFn: () => apiClient.get(`/api/workflows/runs/${runId}`).then(r => r.data.run),
    enabled: !!runId,
  })

  if (isLoading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (isError || !data) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-gray-400 text-lg">Run not found or access denied.</p>
      <Link to="/workflows/history" className="btn-secondary mt-4 inline-flex">Back to History</Link>
    </div>
  )

  const run = data
  const stepRuns = run.step_runs ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-6">
        <Link to="/workflows" className="hover:text-gray-300">Workflows</Link>
        <ChevronRight size={12} />
        <Link to="/workflows/history" className="hover:text-gray-300">History</Link>
        <ChevronRight size={12} />
        <span className="text-gray-400">Run Detail</span>
      </div>

      {/* Run summary */}
      <div className={`card p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 ${
        run.status === 'completed' ? 'border-emerald-700/40' :
        run.status === 'partial'   ? 'border-amber-700/40'   :
        run.status === 'failed'    ? 'border-red-700/40'     : ''
      }`}>
        <StatusIcon status={run.status} size={28} />
        <div className="flex-1">
          <p className="text-base font-semibold text-white">{run.workflow_name}</p>
          <p className="text-xs text-gray-500 capitalize mt-0.5">{run.status}</p>
        </div>
        <div className="text-xs text-gray-500 space-y-1 text-right">
          {run.credits_total > 0 && (
            <p className="flex items-center gap-1 justify-end text-amber-400">
              <Coins size={12} /> {run.credits_total} credits used
            </p>
          )}
          <p>Started: {formatTime(run.started_at)}</p>
          <p>Completed: {formatTime(run.completed_at)}</p>
        </div>
      </div>

      {/* Step runs */}
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Step Results</h2>
      <div className="space-y-3">
        {stepRuns.map((sr, idx) => (
          <div key={sr.id} className={`card ${
            sr.status === 'completed' ? 'border-emerald-800/30' :
            sr.status === 'failed'    ? 'border-red-800/30'     :
            sr.status === 'skipped'   ? 'opacity-50'            : ''
          }`}>
            <div className="flex items-center gap-3 px-4 py-3">
              <StatusIcon status={sr.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">
                  Step {sr.step_order}: {sr.label || sr.tool_name}
                </p>
                {sr.credits_charged > 0 && (
                  <p className="text-xs text-gray-500">{sr.credits_charged} credit{sr.credits_charged !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>

            {sr.status === 'completed' && sr.output && (
              <div className="border-t border-white/5 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500 font-medium">Output</p>
                  <CopyButton text={sr.output} />
                </div>
                <div className="bg-black/30 rounded-lg p-3 max-h-72 overflow-y-auto border border-white/5">
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{sr.output}</p>
                </div>
              </div>
            )}

            {sr.status === 'failed' && sr.error_msg && (
              <div className="border-t border-red-900/20 px-4 py-3">
                <p className="text-xs text-red-400 bg-red-900/20 rounded p-2">{sr.error_msg}</p>
              </div>
            )}

            {sr.status === 'skipped' && (
              <div className="border-t border-white/5 px-4 py-2">
                <p className="text-xs text-gray-600">Skipped due to a prior step failure.</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-between">
        <Link to="/workflows/history" className="btn-secondary text-sm">← Back to History</Link>
        <Link to={`/workflows/${run.workflow_id}/run`} className="btn-primary text-sm">Run Again</Link>
      </div>
    </div>
  )
}
