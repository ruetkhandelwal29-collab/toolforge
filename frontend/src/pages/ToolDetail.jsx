import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Heart, Play, ArrowLeft, User, BarChart2, Zap, Loader2, Flag, X } from 'lucide-react'
import apiClient from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StarRating from '../components/common/StarRating'
import DynamicToolRunner from '../components/tool/DynamicToolRunner'
import ReviewList from '../components/reviews/ReviewList'
import toast from 'react-hot-toast'

function formatCount(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export default function ToolDetail() {
  const { slug } = useParams()
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const [runnerOpen, setRunnerOpen] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportReason, setReportReason] = useState('Inappropriate or harmful content')
  const [reportDetails, setReportDetails] = useState('')

  const { data: tool, isLoading, isError } = useQuery({
    queryKey: ['tool', slug],
    queryFn: () => apiClient.get(`/api/tools/${slug}`).then(r => r.data.tool),
  })

  const favMutation = useMutation({
    mutationFn: () => {
      if (tool.is_favorited) {
        return apiClient.delete(`/api/favorites/${tool.id}`).then(r => r.data)
      } else {
        return apiClient.post(`/api/favorites/${tool.id}`).then(r => r.data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool', slug] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
      queryClient.invalidateQueries({ queryKey: ['tools'] })
      toast.success(tool.is_favorited ? 'Removed from favorites' : 'Saved to favorites')
    },
    onError: (err) => toast.error(err.message || 'Failed to update favorite'),
  })

  const reportMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/tools/${tool.id}/report`, {
      reason: reportReason,
      details: reportDetails,
    }),
    onSuccess: () => {
      toast.success('Thank you. Your report has been submitted to moderators.')
      setReportModalOpen(false)
      setReportDetails('')
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to submit report')
    },
  })

  if (isLoading) return <div className="flex justify-center py-24"><LoadingSpinner size="lg" /></div>
  if (isError || !tool) return <div className="text-center py-24 text-gray-500">Tool not found.</div>

  const pricingLabel =
    tool.pricing_type === 'free' ? 'Free' :
    tool.pricing_type === 'credits' ? `${tool.credits_per_run} Credits / run` :
    `$${Number(tool.price_per_run).toFixed(2)} / run`

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-6">
        <ArrowLeft size={15} /> Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-900/60 to-surface-800 border border-white/8 flex items-center justify-center shrink-0 overflow-hidden">
              {tool.thumbnail_url
                ? <img src={tool.thumbnail_url} className="w-full h-full object-cover" alt={tool.name} />
                : <Zap size={28} className="text-brand-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{tool.name}</h1>
                {tool.is_featured && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow">
                    <Star size={11} className="fill-white" /> Featured
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant={tool.pricing_type === 'free' ? 'free' : 'paid'}>{pricingLabel}</Badge>
                <span className="text-xs text-gray-500">
                  by <span className="text-gray-300">{tool.creator?.username}</span>
                </span>
                <span className="text-xs text-gray-600">•</span>
                <span className="text-xs text-gray-500">{tool.category?.name}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-2">About this tool</h2>
            <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-wrap">
              {tool.long_description || tool.description}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: BarChart2, label: 'Total Runs',  value: formatCount(tool.run_count) },
              { icon: Star,      label: 'Rating',      value: `${Number(tool.avg_rating || 0).toFixed(1)} / 5` },
              { icon: User,      label: 'Reviews',     value: tool.review_count ?? 0 },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="card p-4 text-center">
                <Icon size={18} className="text-brand-400 mx-auto mb-1" />
                <p className="text-xl font-bold text-white">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>

          {/* Reviews section */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-sm font-semibold text-gray-300">Reviews</h2>
              {tool.review_count > 0 && (
                <div className="flex items-center gap-1.5">
                  <StarRating rating={tool.avg_rating} size={13} />
                  <span className="text-xs text-gray-400">
                    {Number(tool.avg_rating || 0).toFixed(1)} · {tool.review_count} review{tool.review_count !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
            <ReviewList toolId={tool.id} toolSlug={slug} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-1.5">
              <StarRating rating={tool.avg_rating} />
              <span className="text-sm text-gray-400">
                {Number(tool.avg_rating || 0).toFixed(1)} ({tool.review_count})
              </span>
            </div>

            {runnerOpen ? (
              <DynamicToolRunner tool={tool} onClose={() => setRunnerOpen(false)} />
            ) : (
              <button
                className="btn-primary w-full py-3"
                onClick={() => {
                  if (!isAuthenticated) { toast.error('Sign in to run tools'); return }
                  setRunnerOpen(true)
                }}
              >
                <Play size={16} /> Run Tool
              </button>
            )}

            {isAuthenticated && !runnerOpen && (
              <div className="space-y-2">
                <button
                  onClick={() => favMutation.mutate()}
                  className="btn-secondary w-full"
                  disabled={favMutation.isPending}
                >
                  {favMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Heart size={16} className={tool.is_favorited ? 'fill-red-400 text-red-400' : ''} />
                  )}
                  {tool.is_favorited ? 'Saved in Favorites' : 'Add to Favorites'}
                </button>

                <button
                  onClick={() => setReportModalOpen(true)}
                  className="w-full py-1 px-3 text-xs text-gray-500 hover:text-red-400 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Flag size={12} /> Report Tool
                </button>
              </div>
            )}

            <div className="border-t border-white/8 pt-4 space-y-2.5 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Pricing</span>
                <span className="text-gray-300">{pricingLabel}</span>
              </div>
              <div className="flex justify-between">
                <span>Category</span>
                <span className="text-gray-300">{tool.category?.name}</span>
              </div>
              <div className="flex justify-between">
                <span>Type</span>
                <span className="text-gray-300 capitalize">{tool.tool_type}</span>
              </div>
              <div className="flex justify-between">
                <span>Provider</span>
                <span className="text-gray-300 capitalize">{tool.provider}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="card max-w-md w-full p-6 space-y-4 border-white/10 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Flag size={16} className="text-red-400" /> Report Tool
              </h3>
              <button onClick={() => setReportModalOpen(false)} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Reporting <strong className="text-white">{tool.name}</strong>. Help us keep ToolForge safe and trustworthy.
            </p>
            <div>
              <label className="label text-xs">Reason *</label>
              <select
                value={reportReason}
                onChange={e => setReportReason(e.target.value)}
                className="input text-xs bg-surface-800"
              >
                <option value="Inappropriate or harmful content">Inappropriate or harmful content</option>
                <option value="Broken or malfunctioning tool">Broken or malfunctioning tool</option>
                <option value="Misleading or fraudulent description">Misleading or fraudulent description</option>
                <option value="Copyright or IP infringement">Copyright or IP infringement</option>
                <option value="Spam or low quality">Spam or low quality</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Additional Details (optional)</label>
              <textarea
                value={reportDetails}
                onChange={e => setReportDetails(e.target.value)}
                placeholder="Describe why you are reporting this tool..."
                rows={3}
                className="input text-xs resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="btn-secondary py-1.5 px-3 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => reportMutation.mutate()}
                disabled={reportMutation.isPending}
                className="btn-primary py-1.5 px-4 text-xs bg-red-600 hover:bg-red-500 text-white"
              >
                {reportMutation.isPending ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
