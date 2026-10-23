/**
 * WorkflowRunner — Phase 12
 * Displays workflow details, collects user_inputs for all user_input-sourced
 * step fields, then triggers the run and shows live step-by-step results.
 */
import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  GitBranch, Play, Loader2, CheckCircle2, XCircle, Clock,
  SkipForward, Copy, CheckCheck, ChevronDown, ChevronUp, Coins, Layers
} from 'lucide-react'
import apiClient from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/common/LoadingSpinner'
import toast from 'react-hot-toast'

function StatusIcon({ status, size = 16 }) {
  if (status === 'completed') return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />
  if (status === 'failed')    return <XCircle size={size}       className="text-red-400 shrink-0" />
  if (status === 'running')   return <Loader2 size={size}       className="text-brand-400 animate-spin shrink-0" />
  if (status === 'skipped')   return <SkipForward size={size}   className="text-gray-600 shrink-0" />
  return <Clock size={size} className="text-gray-600 shrink-0" />
}

function StepResultCard({ sr, idx }) {
  const [expanded, setExpanded] = useState(sr.status === 'completed')
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(sr.output ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`card border transition-colors ${
      sr.status === 'completed' ? 'border-emerald-800/40' :
      sr.status === 'failed'    ? 'border-red-800/40'     :
      sr.status === 'skipped'   ? 'border-white/5 opacity-50' :
      'border-white/8'
    }`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <StatusIcon status={sr.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">
            Step {sr.step_order}: {sr.label || sr.tool_name || 'Tool'}
          </p>
          {sr.credits_charged > 0 && (
            <p className="text-xs text-gray-500">{sr.credits_charged} credit{sr.credits_charged !== 1 ? 's' : ''}</p>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-4 py-3">
          {sr.status === 'completed' && sr.output && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">Output</p>
                <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
                  {copied ? <><CheckCheck size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
              <div className="bg-black/30 rounded-lg p-3 max-h-64 overflow-y-auto border border-white/5">
                <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{sr.output}</p>
              </div>
            </div>
          )}
          {sr.status === 'failed' && sr.error_msg && (
            <p className="text-xs text-red-400 bg-red-900/20 rounded p-2">{sr.error_msg}</p>
          )}
          {sr.status === 'skipped' && (
            <p className="text-xs text-gray-500">Skipped due to a prior step failure.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function WorkflowRunner() {
  const { id } = useParams()
  const { isAuthenticated, profile } = useAuth()

  // Load workflow details
  const { data: wfData, isLoading, isError } = useQuery({
    queryKey: ['workflow-run-view', id],
    queryFn: () => {
      // Try public endpoint first; owner can use private GET too
      return apiClient.get(`/api/workflows/public/${id}`)
        .catch(() => apiClient.get(`/api/workflows/${id}`))
        .then(r => r.data.workflow)
    },
    enabled: !!id,
  })

  // Collect all unique user_input fields from all step mappings
  const userInputFields = useMemo(() => {
    if (!wfData?.steps) return []
    const seen = new Set()
    const fields = []
    for (const step of wfData.steps) {
      const mappings = Array.isArray(step.input_mappings) ? step.input_mappings : []
      const schema   = Array.isArray(step.input_schema)   ? step.input_schema   : []
      const schemaMap = new Map(schema.map(f => [f.name, f]))
      for (const m of mappings) {
        if (m.source === 'user_input') {
          const key = m.key || m.field
          if (!seen.has(key)) {
            seen.add(key)
            const sField = schemaMap.get(m.field)
            fields.push({
              key,
              label: sField?.label || key,
              type: sField?.type || 'text',
              required: sField?.required ?? false,
              placeholder: sField?.placeholder || '',
              options: sField?.options,
            })
          }
        }
      }
    }
    return fields
  }, [wfData])

  const [userInputs, setUserInputs] = useState({})
  const [runResult, setRunResult]   = useState(null)

  const runMutation = useMutation({
    mutationFn: (inputs) =>
      apiClient.post(`/api/workflows/${id}/run`, { user_inputs: inputs }).then(r => r.data),
    onSuccess: (data) => {
      setRunResult(data)
      if (data.status === 'completed') toast.success('Workflow completed!')
      else if (data.status === 'partial') toast.error('Workflow partially completed — one or more steps failed.')
      else toast.error('Workflow failed.')
    },
    onError: err => toast.error(err.message || 'Execution failed'),
  })

  if (isLoading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (isError || !wfData) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-gray-400 text-lg">Workflow not found or not available.</p>
      <Link to="/workflows" className="btn-secondary mt-4 inline-flex">Back to Library</Link>
    </div>
  )

  const estimatedCredits = (wfData.estimated_credits ?? wfData.steps?.reduce((sum, s) => {
    const isPaid = s.pricing_type === 'credits' || s.pricing_type === 'paid'
    return sum + (isPaid ? Math.max(Number(s.credits_per_run) || 1, 1) : 0)
  }, 0)) ?? 0

  function handleRun() {
    if (!isAuthenticated) return toast.error('Please sign in to run workflows')
    // Validate required inputs
    for (const f of userInputFields) {
      if (f.required && !String(userInputs[f.key] ?? '').trim()) {
        return toast.error(`${f.label} is required`)
      }
    }
    runMutation.mutate(userInputs)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <Link to="/workflows" className="hover:text-gray-300">Workflows</Link>
          <span>/</span>
          <span className="text-gray-300">{wfData.name}</span>
        </div>
        <h1 className="section-title flex items-center gap-2.5">
          <GitBranch size={24} className="text-brand-400" />
          {wfData.name}
        </h1>
        {wfData.description && (
          <p className="text-muted text-sm mt-2">{wfData.description}</p>
        )}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <Layers size={12} /> {wfData.steps?.length ?? 0} steps
          </span>
          {estimatedCredits > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <Coins size={12} /> ~{estimatedCredits} credit{estimatedCredits !== 1 ? 's' : ''}
            </span>
          )}
          <span>by {wfData.creator_username}</span>
        </div>
      </div>

      {/* Results view */}
      {runResult ? (
        <div className="space-y-4">
          <div className={`card p-4 flex items-center gap-3 ${
            runResult.status === 'completed' ? 'border-emerald-700/40 bg-emerald-900/10' :
            runResult.status === 'partial'   ? 'border-amber-700/40 bg-amber-900/10' :
                                              'border-red-700/40 bg-red-900/10'
          }`}>
            <StatusIcon status={runResult.status} size={20} />
            <div>
              <p className="font-semibold text-white text-sm capitalize">{runResult.status}</p>
              <p className="text-xs text-gray-500">{runResult.creditsTotal} credit{runResult.creditsTotal !== 1 ? 's' : ''} used</p>
            </div>
            <button
              onClick={() => { setRunResult(null) }}
              className="ml-auto btn-secondary py-1.5 text-xs"
            >
              Run Again
            </button>
          </div>

          <div className="space-y-3">
            {(runResult.stepResults ?? []).map((sr, i) => (
              <StepResultCard key={i} sr={sr} idx={i} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Step preview */}
          <div className="card p-4">
            <p className="text-xs font-medium text-gray-400 mb-3">Workflow Steps</p>
            <div className="space-y-2">
              {(wfData.steps ?? []).map((step, idx) => (
                <div key={step.id} className="flex items-center gap-2.5 text-sm">
                  <div className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700 flex items-center justify-center text-xs text-brand-300 shrink-0">
                    {idx + 1}
                  </div>
                  <span className="text-gray-300">{step.label || step.tool_name}</span>
                  {(step.pricing_type === 'credits' || step.pricing_type === 'paid') && (
                    <span className="text-xs text-amber-500 ml-auto">{step.credits_per_run}cr</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* User inputs */}
          {userInputFields.length > 0 && (
            <div className="card p-5 space-y-4">
              <p className="text-sm font-medium text-gray-300">Your Inputs</p>
              {userInputFields.map(field => (
                <div key={field.key}>
                  <label className="label">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      placeholder={field.placeholder}
                      className="input resize-none"
                      value={userInputs[field.key] ?? ''}
                      onChange={e => setUserInputs(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  ) : field.type === 'select' && field.options?.length ? (
                    <select
                      className="input"
                      value={userInputs[field.key] ?? ''}
                      onChange={e => setUserInputs(prev => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder}
                      className="input"
                      value={userInputs[field.key] ?? ''}
                      onChange={e => setUserInputs(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {userInputFields.length === 0 && (
            <div className="card p-4 text-sm text-gray-500 text-center">
              This workflow has no user inputs — it will run with pre-configured values.
            </div>
          )}

          {!isAuthenticated && (
            <div className="card p-4 text-center text-sm text-amber-400 border-amber-700/40">
              <Link to="/login" className="underline">Sign in</Link> to run this workflow.
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={runMutation.isPending || !isAuthenticated}
            className="btn-primary w-full py-3 text-base"
          >
            {runMutation.isPending
              ? <><Loader2 size={18} className="animate-spin" /> Running workflow…</>
              : <><Play size={18} /> Run Workflow</>}
          </button>

          {estimatedCredits > 0 && (
            <p className="text-center text-xs text-gray-600">
              Running will deduct approximately {estimatedCredits} credit{estimatedCredits !== 1 ? 's' : ''} from your balance.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
