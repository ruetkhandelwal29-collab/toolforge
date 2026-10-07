import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { X, Loader2, Copy, CheckCheck } from 'lucide-react'
import apiClient from '../../services/apiClient'
import toast from 'react-hot-toast'

export default function DynamicToolRunner({ tool, onClose }) {
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [output, setOutput] = useState(null)
  const [copied, setCopied] = useState(false)
  const schema = tool.input_schema ?? []

  const runMutation = useMutation({
    mutationFn: (inputs) => apiClient.post(`/api/execute/${tool.id}`, { inputs }).then(r => r.data),
    onSuccess: (data) => { setOutput(data.output); toast.success('Tool ran successfully!') },
    onError: (err) => toast.error(err.message || 'Execution failed'),
  })

  async function copyOutput() {
    if (!output) return
    await navigator.clipboard.writeText(typeof output === 'string' ? output : JSON.stringify(output, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-300">Run Tool</p>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
      </div>
      {!output ? (
        <form onSubmit={handleSubmit(d => runMutation.mutate(d))} className="space-y-3">
          {schema.map(field => (
            <div key={field.name}>
              <label className="label">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  {...register(field.name, { required: field.required ? `${field.label} is required` : false })}
                  placeholder={field.placeholder}
                  rows={4}
                  className="input resize-none"
                />
              ) : field.type === 'select' ? (
                <select
                  {...register(field.name, { required: field.required ? `${field.label} is required` : false })}
                  defaultValue={field.default ?? ''}
                  className="input"
                >
                  {!field.required && <option value="">Select…</option>}
                  {field.required && <option value="" disabled>Select {field.label}…</option>}
                  {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  {...register(field.name, {
                    required: field.required ? `${field.label} is required` : false,
                    valueAsNumber: true,
                  })}
                  placeholder={field.placeholder}
                  defaultValue={field.default}
                  className="input"
                />
              ) : field.type === 'boolean' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`field-${field.name}`}
                    {...register(field.name)}
                    className="w-4 h-4 accent-brand-500"
                  />
                  <label htmlFor={`field-${field.name}`} className="text-sm text-gray-400 cursor-pointer">
                    {field.placeholder || `Enable ${field.label}`}
                  </label>
                </div>
              ) : (
                <input
                  type="text"
                  {...register(field.name, { required: field.required ? `${field.label} is required` : false })}
                  placeholder={field.placeholder}
                  className="input"
                />
              )}
              {errors[field.name] && <p className="text-xs text-red-400 mt-1">{errors[field.name].message}</p>}
            </div>
          ))}
          {schema.length === 0 && <p className="text-xs text-gray-500">No configurable inputs. Click Run to execute.</p>}
          <button type="submit" className="btn-primary w-full" disabled={runMutation.isPending}>
            {runMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Running…</> : 'Run Tool'}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400">Output</p>
            <button onClick={copyOutput} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300">
              {copied ? <><CheckCheck size={13} />Copied</> : <><Copy size={13} />Copy</>}
            </button>
          </div>
          <div className="bg-black/30 border border-white/8 rounded-lg p-3 max-h-64 overflow-y-auto">
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</p>
          </div>
          <button onClick={() => setOutput(null)} className="btn-secondary w-full text-xs py-2">Run Again</button>
        </div>
      )}
    </div>
  )
}
