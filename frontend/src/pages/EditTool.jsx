import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Eye, EyeOff } from 'lucide-react'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import toast from 'react-hot-toast'

export default function EditTool() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const { data: tool, isLoading, isError } = useQuery({
    queryKey: ['tool-edit', id],
    queryFn:  () => apiClient.get(`/api/tools/id/${id}`).then(r => r.data.tool),
  })

  const publishMutation = useMutation({
    mutationFn: (publish) =>
      apiClient.patch(`/api/tools/${id}/publish`, { publish }).then(r => r.data),
    onSuccess: (data) => {
      queryClient.setQueryData(['tool-edit', id], data.tool)
      queryClient.invalidateQueries({ queryKey: ['my-tools'] })
      toast.success(data.tool.is_published ? 'Tool submitted for approval!' : 'Tool unpublished.')
    },
    onError: (err) => toast.error(err.message),
  })

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

      {/* Tool header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{tool.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant={tool.is_published ? 'success' : 'default'}>
              {tool.is_published ? 'Published' : 'Draft'}
            </Badge>
            {tool.is_published && !tool.is_approved && (
              <Badge variant="warning">Pending Admin Approval</Badge>
            )}
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
            {tool.is_published ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}
          </button>
        </div>
      </div>

      {/* Current configuration summary */}
      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Tool Configuration</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: 'Category',     value: tool.category?.name },
              { label: 'Provider',     value: tool.provider },
              { label: 'Model',        value: tool.model },
              { label: 'Pricing',      value: tool.pricing_type },
              { label: 'Input Fields', value: `${(tool.input_schema ?? []).length} field(s)` },
              { label: 'Runs',         value: (tool.run_count || 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-300 capitalize font-medium">{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Prompt preview */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Prompt Template</h2>
          <pre className="text-xs text-gray-400 bg-black/30 border border-white/8 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">
            {tool.prompt_template}
          </pre>
        </div>

        {/* Input schema preview */}
        {(tool.input_schema ?? []).length > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Input Fields</h2>
            <div className="space-y-2">
              {(tool.input_schema ?? []).map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-2 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <code className="text-brand-400 bg-brand-950/50 px-1.5 py-0.5 rounded">
                      {'{{'}{f.name}{'}}'}
                    </code>
                    <span className="text-gray-400">{f.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className="capitalize">{f.type}</span>
                    {f.required && <Badge variant="danger">required</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full editor notice */}
        <div className="card p-5 border-brand-900/40 bg-brand-950/20">
          <p className="text-sm text-gray-400">
            <span className="text-brand-300 font-medium">Full editor coming in Phase 4.</span>{' '}
            You can currently publish/unpublish your tool. Complete editing (name, description, prompt, inputs) will be available in the next update.
          </p>
        </div>
      </div>
    </div>
  )
}
