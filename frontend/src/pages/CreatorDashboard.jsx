import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, BarChart2, Edit, Eye, EyeOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import toast from 'react-hot-toast'

export default function CreatorDashboard() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['my-tools'],
    queryFn: () => apiClient.get('/api/creators/tools').then(r => r.data),
  })

  const publishMutation = useMutation({
    mutationFn: ({ id, publish }) =>
      apiClient.patch(`/api/tools/${id}/publish`, { publish }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tools'] })
      toast.success('Tool updated!')
    },
    onError: (err) => toast.error(err.message),
  })

  const tools = data?.tools ?? []
  const totalRuns = tools.reduce((s, t) => s + (t.run_count || 0), 0)
  const publishedCount = tools.filter(t => t.is_published).length

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Creator Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Build, publish, and manage your AI tools.</p>
        </div>
        <Link to="/creator/tools/new" className="btn-primary">
          <Plus size={16} /> New Tool
        </Link>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Tools',  value: tools.length },
          { label: 'Published',    value: publishedCount },
          { label: 'Total Runs',   value: totalRuns.toLocaleString() },
          { label: 'Earnings',     value: '$0.00', note: 'Monetization coming soon' },
        ].map(({ label, value, note }) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {note && <p className="text-xs text-gray-600 mt-0.5">{note}</p>}
          </div>
        ))}
      </div>

      {/* Tools table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">My Tools</h2>
          <span className="text-xs text-gray-500">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : tools.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 font-medium mb-1">No tools yet</p>
            <p className="text-sm text-gray-600 mb-5">Create your first AI tool and start earning.</p>
            <Link to="/creator/tools/new" className="btn-primary">
              <Plus size={15} /> Create Your First Tool
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {tools.map(tool => (
              <div key={tool.id} className="flex items-center gap-4 px-5 py-4 hover:bg-white/2 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white text-sm truncate">{tool.name}</p>
                    <Badge variant={tool.is_published ? 'success' : 'default'}>
                      {tool.is_published ? 'Published' : 'Draft'}
                    </Badge>
                    {tool.is_published && !tool.is_approved && (
                      <Badge variant="warning">Pending Approval</Badge>
                    )}
                    {tool.is_approved && <Badge variant="brand">Live</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{tool.description}</p>
                </div>

                <div className="hidden sm:flex items-center gap-4 text-xs text-gray-500 shrink-0">
                  <span className="flex items-center gap-1">
                    <BarChart2 size={12} />
                    {(tool.run_count || 0).toLocaleString()} runs
                  </span>
                  <span className="text-gray-600 capitalize">{tool.tool_type}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => publishMutation.mutate({ id: tool.id, publish: !tool.is_published })}
                    disabled={publishMutation.isPending}
                    className="btn-ghost py-1 px-2.5 text-xs"
                    title={tool.is_published ? 'Unpublish' : 'Publish'}
                  >
                    {tool.is_published ? <EyeOff size={13} /> : <Eye size={13} />}
                    {tool.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  <Link to={`/creator/tools/${tool.id}/edit`} className="btn-ghost py-1 px-2.5 text-xs">
                    <Edit size={13} /> Edit
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
