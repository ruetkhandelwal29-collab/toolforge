import { useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ExternalLink, Eye, EyeOff, Plus, Trash2, Info, Loader2 } from 'lucide-react'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import toast from 'react-hot-toast'

const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'boolean']

const GEMINI_MODELS = [
  { value: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash (recommended)' },
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (fastest)' },
  { value: 'gemini-3.1-pro-preview',label: 'Gemini 3.1 Pro (advanced reasoning)' },
]

const inputFieldSchema = z.object({
  name:        z.string().min(1, 'Required').regex(/^[a-z_]+$/, 'Lowercase letters and underscores only'),
  label:       z.string().min(1, 'Required'),
  type:        z.enum(['text', 'textarea', 'number', 'select', 'boolean']),
  required:    z.boolean().default(true),
  placeholder: z.string().optional(),
  options:     z.string().optional(),
})

const schema = z.object({
  name:             z.string().min(3, 'Min 3 chars').max(100),
  description:      z.string().min(10, 'Min 10 chars').max(300),
  long_description: z.string().optional(),
  category_id:      z.coerce.number().positive('Select a category'),
  tool_type:        z.enum(['text', 'image', 'audio', 'video', 'other']),
  provider:         z.string().min(1),
  model:            z.string().min(1),
  prompt_template:  z.string().min(10, 'Prompt template is required'),
  pricing_type:     z.enum(['free', 'paid', 'credits']),
  input_fields:     z.array(inputFieldSchema).default([]),
})

export default function EditTool() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Load the tool — enforced server-side to only return tools owned by this creator
  const { data: tool, isLoading, isError } = useQuery({
    queryKey: ['tool-edit', id],
    queryFn:  () => apiClient.get(`/api/tools/id/${id}`).then(r => r.data.tool),
  })

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn:  () => apiClient.get('/api/categories').then(r => r.data.categories),
  })

  const { register, control, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      tool_type:    'text',
      provider:     'gemini',
      model:        'gemini-3.8-flash',
      pricing_type: 'free',
      input_fields: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'input_fields' })

  // Pre-populate form once tool data is loaded
  useEffect(() => {
    if (!tool) return
    const existingSchema = Array.isArray(tool.input_schema) ? tool.input_schema : []
    reset({
      name:             tool.name,
      description:      tool.description,
      long_description: tool.long_description ?? '',
      category_id:      tool.category_id,
      tool_type:        tool.tool_type,
      provider:         tool.provider,
      model:            tool.model,
      prompt_template:  tool.prompt_template,
      pricing_type:     tool.pricing_type,
      // Convert stored input_schema back to form's input_fields shape
      input_fields: existingSchema.map(f => ({
        name:        f.name,
        label:       f.label,
        type:        f.type,
        required:    !!f.required,
        placeholder: f.placeholder ?? '',
        options:     Array.isArray(f.options) ? f.options.join(', ') : (f.options ?? ''),
      })),
    })
  }, [tool, reset])

  const updateMutation = useMutation({
    mutationFn: (payload) => apiClient.patch(`/api/tools/${id}`, payload).then(r => r.data),
    onSuccess: (data) => {
      queryClient.setQueryData(['tool-edit', id], data.tool)
      queryClient.invalidateQueries({ queryKey: ['my-tools'] })
      toast.success('Tool saved!')
    },
    onError: (err) => toast.error(err.message),
  })

  const publishMutation = useMutation({
    mutationFn: (publish) =>
      apiClient.patch(`/api/tools/${id}/publish`, { publish }).then(r => r.data),
    onSuccess: (data) => {
      queryClient.setQueryData(['tool-edit', id], data.tool)
      queryClient.invalidateQueries({ queryKey: ['my-tools'] })
      toast.success(data.tool.is_published ? 'Tool published! It is now live on the marketplace.' : 'Tool unpublished.')
    },
    onError: (err) => toast.error(err.message),
  })

  function onSubmit(data) {
    const input_schema = data.input_fields.map(f => ({
      name:        f.name,
      label:       f.label,
      type:        f.type,
      required:    f.required,
      placeholder: f.placeholder,
      options:     f.type === 'select' && f.options
        ? f.options.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
    }))
    const { input_fields, ...rest } = data
    updateMutation.mutate({ ...rest, input_schema })
  }

  if (isLoading) return <div className="flex justify-center py-24"><LoadingSpinner size="lg" /></div>
  if (isError || !tool) return (
    <div className="text-center py-24 text-gray-500">
      Tool not found or you don't have permission to edit it.
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        to="/creator/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-6"
      >
        <ArrowLeft size={15} /> Back to Studio
      </Link>

      {/* Tool header with status + actions */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{tool.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant={tool.is_published ? 'success' : 'default'}>
              {tool.is_published ? 'Published' : 'Draft'}
            </Badge>
            {tool.is_approved && <Badge variant="brand">Live on Marketplace</Badge>}
            <span className="text-xs text-gray-500 capitalize">{tool.tool_type} · {tool.provider}</span>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {tool.is_approved && (
            <Link
              to={`/tools/${tool.slug}`}
              target="_blank"
              className="btn-ghost text-xs py-1.5 px-3"
            >
              <ExternalLink size={13} /> View Live
            </Link>
          )}
          <button
            onClick={() => publishMutation.mutate(!tool.is_published)}
            disabled={publishMutation.isPending}
            className={tool.is_published ? 'btn-secondary text-xs py-2' : 'btn-primary text-xs py-2'}
          >
            {publishMutation.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : tool.is_published
                ? <><EyeOff size={13} /> Unpublish</>
                : <><Eye size={13} /> Publish</>}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

        {/* ── Basic Information ── */}
        <section className="card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-200 pb-3 border-b border-white/8">
            Basic Information
          </h2>

          <div>
            <label className="label">Tool Name *</label>
            <input {...register('name')} className="input" />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="label">
              Short Description *{' '}
              <span className="text-gray-600 font-normal">(max 300 chars)</span>
            </label>
            <textarea {...register('description')} rows={2} className="input resize-none" />
            {errors.description && <p className="text-xs text-red-400 mt-1">{errors.description.message}</p>}
          </div>

          <div>
            <label className="label">
              Full Description{' '}
              <span className="text-gray-600 font-normal">(shown on detail page)</span>
            </label>
            <textarea {...register('long_description')} rows={5} className="input resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Category *</label>
              <select {...register('category_id')} className="input">
                <option value="">Select a category</option>
                {catData?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.category_id && <p className="text-xs text-red-400 mt-1">{errors.category_id.message}</p>}
            </div>
            <div>
              <label className="label">Output Type *</label>
              <select {...register('tool_type')} className="input">
                <option value="text">Text</option>
                <option value="image">Image</option>
                <option value="audio">Audio</option>
                <option value="video">Video</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </section>

        {/* ── AI Configuration ── */}
        <section className="card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-200 pb-3 border-b border-white/8">
            AI Configuration
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">AI Provider *</label>
              <select {...register('provider')} className="input">
                <option value="gemini">Google Gemini</option>
                <option value="openai" disabled>OpenAI (coming soon)</option>
              </select>
            </div>
            <div>
              <label className="label">Model *</label>
              <select {...register('model')} className="input">
                {GEMINI_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Prompt Template *</label>
            <div className="flex items-start gap-2 mb-2">
              <Info size={13} className="text-brand-400 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-500">
                Use <code className="text-brand-400 bg-brand-950/60 px-1 rounded">{'{{variable_name}}'}</code> placeholders
                matching the input fields below.
              </p>
            </div>
            <textarea
              {...register('prompt_template')}
              rows={7}
              className="input resize-none font-mono text-xs leading-relaxed"
            />
            {errors.prompt_template && (
              <p className="text-xs text-red-400 mt-1">{errors.prompt_template.message}</p>
            )}
          </div>
        </section>

        {/* ── Input Fields / Schema ── */}
        <section className="card p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-white/8">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Input Fields</h2>
              <p className="text-xs text-gray-500 mt-0.5">Define what users fill in before running the tool.</p>
            </div>
            <button
              type="button"
              className="btn-ghost text-xs py-1.5 px-3"
              onClick={() => append({ name: '', label: '', type: 'text', required: true, placeholder: '' })}
            >
              <Plus size={13} /> Add Field
            </button>
          </div>

          {fields.length === 0 && (
            <div className="text-center py-6 border border-dashed border-white/10 rounded-lg">
              <p className="text-sm text-gray-500">No input fields defined.</p>
              <p className="text-xs text-gray-600 mt-1">
                Add fields that correspond to the <code className="text-brand-400">{'{{variables}}'}</code> in your prompt.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {fields.map((field, i) => (
              <div key={field.id} className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-400">Field {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Field Name (internal) *</label>
                    <input
                      {...register(`input_fields.${i}.name`)}
                      placeholder="e.g. topic"
                      className="input text-xs"
                    />
                    {errors.input_fields?.[i]?.name && (
                      <p className="text-xs text-red-400 mt-1">{errors.input_fields[i].name.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="label text-xs">Label (shown to user) *</label>
                    <input
                      {...register(`input_fields.${i}.label`)}
                      placeholder="e.g. Topic"
                      className="input text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Field Type</label>
                    <select {...register(`input_fields.${i}.type`)} className="input text-xs">
                      {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Placeholder text</label>
                    <input
                      {...register(`input_fields.${i}.placeholder`)}
                      placeholder="e.g. climate change"
                      className="input text-xs"
                    />
                  </div>
                </div>

                {watch(`input_fields.${i}.type`) === 'select' && (
                  <div>
                    <label className="label text-xs">Options (comma-separated)</label>
                    <input
                      {...register(`input_fields.${i}.options`)}
                      placeholder="formal, casual, friendly"
                      className="input text-xs"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`req-${field.id}`}
                    {...register(`input_fields.${i}.required`)}
                    className="w-3.5 h-3.5 accent-brand-500"
                  />
                  <label htmlFor={`req-${field.id}`} className="text-xs text-gray-400 cursor-pointer">
                    Required field
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ── */}
        <section className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 pb-3 border-b border-white/8">Pricing</h2>
          <div>
            <label className="label">Pricing Model</label>
            <select {...register('pricing_type')} className="input">
              <option value="free">Free — users run at no cost</option>
              <option value="credits">Credits — deduct credits per run</option>
              <option value="paid">Paid — charge USD per run</option>
            </select>
          </div>
          <div className="flex items-start gap-2 bg-brand-950/40 border border-brand-900/50 rounded-lg px-3 py-2.5">
            <Info size={13} className="text-brand-400 mt-0.5 shrink-0" />
            <p className="text-xs text-brand-300">
              Paid and credit pricing requires monetization setup. Use <strong>Free</strong> to get your tool live first.
            </p>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-4">
          <button
            type="submit"
            className="btn-primary px-8"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending
              ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : 'Save Changes'}
          </button>
          {!tool.is_published && (
            <button
              type="button"
              className="btn-secondary"
              disabled={isDirty || publishMutation.isPending}
              title={isDirty ? 'Save changes first before publishing' : ''}
              onClick={() => publishMutation.mutate(true)}
            >
              <Eye size={14} />
              {publishMutation.isPending ? 'Publishing…' : 'Save & Publish'}
            </button>
          )}
          <Link to="/creator/dashboard" className="btn-ghost">Cancel</Link>
        </div>

      </form>
    </div>
  )
}
