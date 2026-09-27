import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, ArrowLeft, Info } from 'lucide-react'
import apiClient from '../services/apiClient'
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
  options:     z.string().optional(), // comma-separated for select
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

export default function CreateTool() {
  const navigate = useNavigate()

  const { register, control, handleSubmit, formState: { errors } } = useForm({
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

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn:  () => apiClient.get('/api/categories').then(r => r.data.categories),
  })

  const createMutation = useMutation({
    mutationFn: (payload) => apiClient.post('/api/tools', payload).then(r => r.data),
    onSuccess: (data) => {
      toast.success('Tool created! You can now publish it.')
      navigate(`/creator/tools/${data.tool.id}/edit`)
    },
    onError: (err) => toast.error(err.message),
  })

  function onSubmit(data) {
    // Convert input_fields → input_schema (parse options string to array)
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
    createMutation.mutate({ ...rest, input_schema })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        to="/creator/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-6"
      >
        <ArrowLeft size={15} /> Back to Studio
      </Link>

      <h1 className="text-2xl font-bold text-white mb-1">Create New Tool</h1>
      <p className="text-sm text-gray-500 mb-8">
        Define your AI tool. It will be saved as a draft until you publish and it gets approved.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

        {/* ── Basic Information ── */}
        <section className="card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-200 pb-3 border-b border-white/8">
            Basic Information
          </h2>

          <div>
            <label className="label">Tool Name *</label>
            <input {...register('name')} placeholder="e.g. Blog Post Generator" className="input" />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="label">
              Short Description *{' '}
              <span className="text-gray-600 font-normal">(shown on tool card, max 300 chars)</span>
            </label>
            <textarea
              {...register('description')}
              rows={2}
              placeholder="What does this tool do? Keep it short and clear."
              className="input resize-none"
            />
            {errors.description && <p className="text-xs text-red-400 mt-1">{errors.description.message}</p>}
          </div>

          <div>
            <label className="label">
              Full Description{' '}
              <span className="text-gray-600 font-normal">(shown on detail page)</span>
            </label>
            <textarea
              {...register('long_description')}
              rows={5}
              placeholder="Detailed explanation, use cases, example outputs, limitations..."
              className="input resize-none"
            />
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
                Use <code className="text-brand-400 bg-brand-950/60 px-1 rounded">{'{{variable_name}}'}</code> placeholders.
                These map to the input fields you define below. Example:{' '}
                <code className="text-brand-400 bg-brand-950/60 px-1 rounded">Write a {'{{tone}}'} post about {'{{topic}}'}.</code>
              </p>
            </div>
            <textarea
              {...register('prompt_template')}
              rows={7}
              placeholder="Write a {{tone}} blog post about {{topic}} that is approximately {{length}} words long. Focus on engaging the reader and providing actionable insights."
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
              <p className="text-xs text-gray-500 mt-0.5">
                Define what users fill in before running the tool.
              </p>
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
              <p className="text-sm text-gray-500">No input fields defined yet.</p>
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

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`req-${i}`}
                    {...register(`input_fields.${i}.required`)}
                    defaultChecked
                    className="w-3.5 h-3.5 accent-brand-500"
                  />
                  <label htmlFor={`req-${i}`} className="text-xs text-gray-400 cursor-pointer">
                    Required field
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ── */}
        <section className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 pb-3 border-b border-white/8">
            Pricing
          </h2>
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
              Paid and credit pricing requires monetization setup. Start with <strong>Free</strong> to get your tool live first.
            </p>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-4">
          <button
            type="submit"
            className="btn-primary px-8"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Tool'}
          </button>
          <Link to="/creator/dashboard" className="btn-secondary">Cancel</Link>
        </div>

      </form>
    </div>
  )
}
