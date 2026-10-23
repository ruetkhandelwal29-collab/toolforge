/**
 * WorkflowEditor — Phase 12
 * Create and edit workflows: name/description + step builder.
 * Steps pull from real approved/published tools only.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GitBranch, Save, Plus, Trash2, ArrowUp, ArrowDown, ChevronRight,
  Globe, Lock, Loader2, Search, Info, X, Layers, ArrowRight
} from 'lucide-react'
import apiClient from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/common/LoadingSpinner'
import toast from 'react-hot-toast'

// ─────────────────────────────────────────────────────────────────────────────
// Tool Picker Modal
// ─────────────────────────────────────────────────────────────────────────────
function ToolPickerModal({ onPick, onClose }) {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['tools-for-workflow', search],
    queryFn: () =>
      apiClient
        .get(`/api/tools?q=${encodeURIComponent(search)}&limit=50&sort=popular`)
        .then(r => r.data.tools ?? []),
    staleTime: 30000,
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h3 className="font-semibold text-white text-sm">Add a Tool Step</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-white/5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search approved tools..."
              className="input pl-9 text-xs py-2"
              autoFocus
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
          {isLoading && (
            <div className="flex justify-center py-10"><LoadingSpinner /></div>
          )}
          {!isLoading && (data ?? []).length === 0 && (
            <div className="text-center py-10 text-gray-500 text-sm">No tools found</div>
          )}
          {!isLoading && (data ?? []).map(tool => (
            <button
              key={tool.id}
              onClick={() => onPick(tool)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{tool.name}</p>
                <p className="text-xs text-gray-500 truncate">{tool.description}</p>
              </div>
              <span className="text-xs text-gray-600 shrink-0">
                {tool.pricing_type === 'free' ? 'Free' : `${tool.credits_per_run}cr`}
              </span>
              <ArrowRight size={14} className="text-gray-600 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// InputMappingRow
// ─────────────────────────────────────────────────────────────────────────────
function InputMappingRow({ field, mapping, onChange, previousSteps }) {
  const source = mapping?.source ?? 'user_input'

  function update(patch) {
    onChange({ ...(mapping ?? { field: field.name, source: 'user_input' }), ...patch })
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
      <div className="flex items-center gap-1.5 text-gray-400">
        <span className="font-mono bg-white/5 rounded px-1.5 py-0.5 text-brand-300">{field.name}</span>
        {field.required && <span className="text-red-400">*</span>}
      </div>
      <select
        className="input text-xs py-1.5"
        value={source}
        onChange={e => update({ source: e.target.value, key: undefined, step_id: undefined, static_value: undefined })}
      >
        <option value="user_input">From user input</option>
        <option value="step_output" disabled={previousSteps.length === 0}>From prior step output</option>
        <option value="static">Static value</option>
      </select>

      {source === 'user_input' && (
        <input
          type="text"
          className="input text-xs py-1.5"
          placeholder={`Input key (default: ${field.name})`}
          value={mapping?.key ?? ''}
          onChange={e => update({ key: e.target.value || undefined })}
        />
      )}
      {source === 'step_output' && (
        <select
          className="input text-xs py-1.5"
          value={mapping?.step_id ?? ''}
          onChange={e => update({ step_id: e.target.value })}
        >
          <option value="">Select prior step…</option>
          {previousSteps.map(s => (
            <option key={s.tempId} value={s.tempId}>
              Step {s.step_order}: {s.tool_name}
            </option>
          ))}
        </select>
      )}
      {source === 'static' && (
        <input
          type="text"
          className="input text-xs py-1.5"
          placeholder="Static value"
          value={mapping?.static_value ?? ''}
          onChange={e => update({ static_value: e.target.value })}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// StepCard
// ─────────────────────────────────────────────────────────────────────────────
function StepCard({ step, stepIdx, totalSteps, previousSteps, onChange, onRemove, onMoveUp, onMoveDown }) {
  const [expanded, setExpanded] = useState(false)
  const schema = step.tool_input_schema ?? []

  function updateMapping(fieldName, mapping) {
    const current = Array.isArray(step.input_mappings) ? step.input_mappings : []
    const filtered = current.filter(m => m.field !== fieldName)
    onChange({ ...step, input_mappings: mapping ? [...filtered, { ...mapping, field: fieldName }] : filtered })
  }

  function getMappingFor(fieldName) {
    return (step.input_mappings ?? []).find(m => m.field === fieldName)
  }

  return (
    <div className="card border-white/10">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={stepIdx === 0}
            className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-30"
            title="Move up"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={stepIdx === totalSteps - 1}
            className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-30"
            title="Move down"
          >
            <ArrowDown size={13} />
          </button>
        </div>

        <div className="w-6 h-6 rounded-full bg-brand-800 border border-brand-600 flex items-center justify-center text-xs font-bold text-brand-300 shrink-0">
          {stepIdx + 1}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{step.tool_name}</p>
          <p className="text-xs text-gray-500">
            {step.pricing_type === 'free' ? 'Free' : `${step.credits_per_run ?? 1} credit${(step.credits_per_run ?? 1) !== 1 ? 's' : ''}`}
          </p>
        </div>

        <input
          type="text"
          placeholder="Step label (optional)"
          value={step.label ?? ''}
          onChange={e => onChange({ ...step, label: e.target.value })}
          className="input text-xs py-1.5 w-36 hidden sm:block"
        />

        <button
          onClick={() => setExpanded(v => !v)}
          className="btn-ghost py-1 text-xs"
        >
          {schema.length > 0 ? (expanded ? 'Hide inputs' : 'Map inputs') : ''}
        </button>

        <button
          onClick={onRemove}
          className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
          title="Remove step"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Input mappings */}
      {expanded && schema.length > 0 && (
        <div className="border-t border-white/5 px-4 py-3 space-y-2.5 bg-black/10">
          <p className="text-xs font-medium text-gray-400 mb-2">Input Mappings</p>
          {schema.map(field => (
            <InputMappingRow
              key={field.name}
              field={field}
              mapping={getMappingFor(field.name)}
              onChange={m => updateMapping(field.name, m)}
              previousSteps={previousSteps}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEditor main
// ─────────────────────────────────────────────────────────────────────────────
export default function WorkflowEditor() {
  const { id } = useParams()           // undefined when creating
  const isEdit  = !!id
  const navigate = useNavigate()
  const qc      = useQueryClient()

  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [steps,       setSteps]       = useState([])
  const [showPicker,  setShowPicker]  = useState(false)
  const [dirty,       setDirty]       = useState(false)

  // Load existing workflow when editing
  const { data: wfData, isLoading: wfLoading } = useQuery({
    queryKey: ['workflow-edit', id],
    queryFn: () => apiClient.get(`/api/workflows/${id}`).then(r => r.data.workflow),
    enabled: isEdit,
  })

  useEffect(() => {
    if (wfData) {
      setName(wfData.name ?? '')
      setDescription(wfData.description ?? '')
      setSteps(
        (wfData.steps ?? []).map((s, i) => ({
          tempId:            s.id,
          backendId:         s.id,
          tool_id:           s.tool_id,
          tool_name:         s.tool_name,
          pricing_type:      s.pricing_type,
          credits_per_run:   s.credits_per_run,
          tool_input_schema: s.input_schema ?? [],
          step_order:        s.step_order ?? i + 1,
          label:             s.label ?? '',
          input_mappings:    Array.isArray(s.input_mappings) ? s.input_mappings : [],
        }))
      )
    }
  }, [wfData])

  // Create workflow
  const createMutation = useMutation({
    mutationFn: (body) => apiClient.post('/api/workflows', body).then(r => r.data.workflow),
    onSuccess: async (newWf) => {
      // Save steps
      if (steps.length > 0) {
        await saveStepsMutation.mutateAsync({ wfId: newWf.id, steps })
      }
      qc.invalidateQueries({ queryKey: ['workflows', 'mine'] })
      toast.success('Workflow created!')
      navigate(`/workflows/${newWf.id}/edit`)
    },
    onError: err => toast.error(err.message),
  })

  // Update metadata
  const updateMutation = useMutation({
    mutationFn: (body) => apiClient.patch(`/api/workflows/${id}`, body).then(r => r.data.workflow),
    onSuccess: () => {
      toast.success('Workflow saved!')
      qc.invalidateQueries({ queryKey: ['workflow-edit', id] })
      setDirty(false)
    },
    onError: err => toast.error(err.message),
  })

  // Replace steps
  const saveStepsMutation = useMutation({
    mutationFn: ({ wfId, steps: s }) =>
      apiClient.post(`/api/workflows/${wfId ?? id}/steps`, {
        steps: s.map((st, i) => ({
          tool_id:        st.tool_id,
          step_order:     i + 1,
          label:          st.label || undefined,
          input_mappings: st.input_mappings ?? [],
        })),
      }).then(r => r.data),
    onSuccess: () => {
      toast.success('Steps saved!')
      qc.invalidateQueries({ queryKey: ['workflow-edit', id] })
      setDirty(false)
    },
    onError: err => toast.error(err.message),
  })

  // Toggle publish
  const publishMutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/workflows/${id}/publish`).then(r => r.data.workflow),
    onSuccess: (wf) => {
      toast.success(wf.is_published ? 'Workflow published!' : 'Workflow unpublished')
      qc.invalidateQueries({ queryKey: ['workflow-edit', id] })
      qc.invalidateQueries({ queryKey: ['workflows', 'mine'] })
    },
    onError: err => toast.error(err.message),
  })

  const isPublished = wfData?.is_published ?? false

  function handleAddTool(tool) {
    setShowPicker(false)
    setSteps(prev => {
      const newStep = {
        tempId:            `temp-${Date.now()}`,
        tool_id:           tool.id,
        tool_name:         tool.name,
        pricing_type:      tool.pricing_type,
        credits_per_run:   tool.credits_per_run,
        tool_input_schema: tool.input_schema ?? [],
        step_order:        prev.length + 1,
        label:             '',
        input_mappings:    [],
      }
      return [...prev, newStep]
    })
    setDirty(true)
  }

  function moveStep(idx, dir) {
    setSteps(prev => {
      const arr = [...prev]
      const target = idx + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr.map((s, i) => ({ ...s, step_order: i + 1 }))
    })
    setDirty(true)
  }

  function removeStep(idx) {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })))
    setDirty(true)
  }

  function updateStep(idx, updated) {
    setSteps(prev => prev.map((s, i) => i === idx ? updated : s))
    setDirty(true)
  }

  async function handleSaveAll() {
    if (!name.trim()) return toast.error('Workflow name is required')
    if (isEdit) {
      await updateMutation.mutateAsync({ name: name.trim(), description: description || undefined })
      if (steps.length > 0) await saveStepsMutation.mutateAsync({ steps })
    } else {
      await createMutation.mutateAsync({ name: name.trim(), description: description || undefined })
    }
  }

  const estimatedCredits = steps.reduce((sum, s) => {
    const isPaid = s.pricing_type === 'credits' || s.pricing_type === 'paid'
    return sum + (isPaid ? Math.max(Number(s.credits_per_run) || 1, 1) : 0)
  }, 0)

  const isSaving = createMutation.isPending || updateMutation.isPending || saveStepsMutation.isPending

  if (isEdit && wfLoading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><LoadingSpinner size="lg" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {showPicker && <ToolPickerModal onPick={handleAddTool} onClose={() => setShowPicker(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-2.5">
          <GitBranch size={22} className="text-brand-400" />
          <h1 className="section-title">{isEdit ? 'Edit Workflow' : 'New Workflow'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && (
            <>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || steps.length === 0}
                className={`btn-secondary py-2 text-xs ${isPublished ? 'text-amber-300' : 'text-emerald-300'}`}
              >
                {publishMutation.isPending ? <Loader2 size={13} className="animate-spin" /> :
                  isPublished ? <><Lock size={13} /> Unpublish</> : <><Globe size={13} /> Publish</>}
              </button>
            </>
          )}
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="btn-primary py-2 text-sm"
          >
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="card p-5 mb-6 space-y-4">
        <div>
          <label className="label">Workflow Name <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true) }}
            placeholder="e.g. Blog Post Generator"
            className="input"
            maxLength={120}
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            value={description}
            onChange={e => { setDescription(e.target.value); setDirty(true) }}
            placeholder="What does this workflow do?"
            rows={2}
            className="input resize-none"
            maxLength={2000}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Layers size={15} />
          Steps ({steps.length})
          {estimatedCredits > 0 && (
            <span className="text-xs text-amber-400 font-normal ml-1">
              ~ {estimatedCredits} credit{estimatedCredits !== 1 ? 's' : ''} per run
            </span>
          )}
        </h2>
        <button
          onClick={() => setShowPicker(true)}
          className="btn-secondary py-1.5 text-xs"
        >
          <Plus size={14} /> Add Step
        </button>
      </div>

      {steps.length === 0 && (
        <div className="card border-dashed border-white/10 flex flex-col items-center justify-center py-14 text-center">
          <Layers size={36} className="text-gray-700 mb-3" />
          <p className="text-gray-400 text-sm font-medium">No steps yet</p>
          <p className="text-gray-600 text-xs mt-1">Click "Add Step" to choose an AI tool</p>
          <button onClick={() => setShowPicker(true)} className="btn-primary mt-4 text-sm">
            <Plus size={15} /> Add First Step
          </button>
        </div>
      )}

      <div className="space-y-3">
        {steps.map((step, idx) => (
          <StepCard
            key={step.tempId}
            step={step}
            stepIdx={idx}
            totalSteps={steps.length}
            previousSteps={steps.slice(0, idx).map(s => ({ tempId: s.tempId, step_order: s.step_order, tool_name: s.tool_name }))}
            onChange={updated => updateStep(idx, updated)}
            onRemove={() => removeStep(idx)}
            onMoveUp={() => moveStep(idx, -1)}
            onMoveDown={() => moveStep(idx, 1)}
          />
        ))}
      </div>

      {/* Run button (edit mode only, with steps) */}
      {isEdit && steps.length > 0 && (
        <div className="mt-8 flex justify-end">
          <a
            href={`/workflows/${id}/run`}
            className="btn-primary"
          >
            <ChevronRight size={16} /> Run This Workflow
          </a>
        </div>
      )}
    </div>
  )
}
