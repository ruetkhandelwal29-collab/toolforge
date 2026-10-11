import { Link } from 'react-router-dom'
import { Star, Play, Zap, Heart, Loader2 } from 'lucide-react'
import Badge from '../common/Badge'
import { clsx } from 'clsx'
import { useAuth } from '../../contexts/AuthContext'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../../services/apiClient'
import toast from 'react-hot-toast'

const CATEGORY_COLORS = {
  'Image Generation': 'bg-purple-900/40 text-purple-300',
  'Text Generation': 'bg-blue-900/40 text-blue-300',
  'Writing': 'bg-indigo-900/40 text-indigo-300',
  'Coding': 'bg-green-900/40 text-green-300',
  'Education': 'bg-cyan-900/40 text-cyan-300',
  'Productivity': 'bg-teal-900/40 text-teal-300',
  'Marketing': 'bg-orange-900/40 text-orange-300',
  'Design': 'bg-pink-900/40 text-pink-300',
  'Audio': 'bg-yellow-900/40 text-yellow-300',
  'Video': 'bg-red-900/40 text-red-300',
}

function formatCount(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

export default function ToolCard({ tool }) {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()

  const {
    id,
    slug,
    name,
    description,
    creator,
    category,
    pricing_type,
    price_per_run,
    credits_per_run,
    avg_rating,
    review_count,
    run_count,
    thumbnail_url,
    is_featured,
    is_favorited,
  } = tool

  const pricingLabel =
    pricing_type === 'free'
      ? 'Free'
      : pricing_type === 'credits'
      ? `${credits_per_run} Credits`
      : `$${Number(price_per_run).toFixed(2)}`

  const favMutation = useMutation({
    mutationFn: () => {
      if (is_favorited) {
        return apiClient.delete(`/api/favorites/${id}`).then(r => r.data)
      } else {
        return apiClient.post(`/api/favorites/${id}`).then(r => r.data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
      queryClient.invalidateQueries({ queryKey: ['tool', slug] })
      toast.success(is_favorited ? 'Removed from favorites' : 'Saved to favorites')
    },
    onError: (err) => toast.error(err.message || 'Failed to update favorite'),
  })

  function handleFavoriteClick(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!isAuthenticated) {
      toast.error('Sign in to favorite tools')
      return
    }
    favMutation.mutate()
  }

  return (
    <Link to={`/tools/${slug}`} className="group block h-full">
      <div className="card-hover p-4 h-full flex flex-col gap-3 relative">
        {/* Thumbnail with overlay badges & favorite button */}
        <div className="relative w-full aspect-video rounded-lg bg-gradient-to-br from-brand-900/60 to-surface-800 flex items-center justify-center overflow-hidden">
          {thumbnail_url ? (
            <img src={thumbnail_url} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          ) : (
            <Zap size={32} className="text-brand-600" />
          )}

          {/* Featured badge */}
          {is_featured && (
            <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow flex items-center gap-1">
              <Star size={10} className="fill-white" /> Featured
            </span>
          )}

          {/* Favorite button */}
          <button
            type="button"
            onClick={handleFavoriteClick}
            disabled={favMutation.isPending}
            className={clsx(
              "absolute top-2 right-2 z-10 p-1.5 rounded-full backdrop-blur-md transition-all duration-150",
              is_favorited
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-surface-900/60 text-gray-400 hover:text-white hover:bg-surface-900/90"
            )}
            title={is_favorited ? "Remove from favorites" : "Add to favorites"}
            aria-label={is_favorited ? "Remove from favorites" : "Add to favorites"}
          >
            {favMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Heart size={13} className={is_favorited ? "fill-red-400 text-red-400" : ""} />
            )}
          </button>
        </div>

        {/* Category & Pricing */}
        <div className="flex items-start justify-between gap-2">
          <span className={clsx('badge text-xs', CATEGORY_COLORS[category?.name] ?? 'bg-white/8 text-gray-400')}>
            {category?.name ?? 'Other'}
          </span>
          <Badge variant={pricing_type === 'free' ? 'free' : pricing_type === 'credits' ? 'credits' : 'paid'}>
            {pricingLabel}
          </Badge>
        </div>

        {/* Name and Description */}
        <div className="flex-1">
          <h3 className="font-semibold text-white text-sm leading-snug group-hover:text-brand-300 transition-colors line-clamp-2">
            {name}
          </h3>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {description}
          </p>
        </div>

        {/* Creator and Stats */}
        <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-white/5">
          <span className="truncate max-w-[110px]">by {creator?.username ?? 'Unknown'}</span>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="flex items-center gap-1">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              {Number(avg_rating || 0).toFixed(1)} ({review_count ?? 0})
            </span>
            <span className="flex items-center gap-1">
              <Play size={11} />
              {formatCount(run_count ?? 0)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
