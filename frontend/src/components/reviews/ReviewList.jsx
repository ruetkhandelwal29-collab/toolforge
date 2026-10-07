import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Loader2 } from 'lucide-react'
import apiClient from '../../services/apiClient'
import { useAuth } from '../../contexts/AuthContext'
import StarRating from '../common/StarRating'
import ReviewForm from './ReviewForm'
import LoadingSpinner from '../common/LoadingSpinner'
import toast from 'react-hot-toast'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── Single review card ────────────────────────────────────────────
function ReviewCard({ review, toolId, toolSlug, currentUserId, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/api/reviews/${toolId}/${review.id}`).then(r => r.data),
    onSuccess: () => {
      toast.success('Review deleted')
      queryClient.invalidateQueries({ queryKey: ['reviews', toolId] })
      queryClient.invalidateQueries({ queryKey: ['tool', toolSlug] })
      onDeleted?.()
    },
    onError: (err) => toast.error(err.message || 'Failed to delete review'),
  })

  const isOwner = review.reviewer?.id === currentUserId

  if (editing) {
    return (
      <ReviewForm
        toolId={toolId}
        toolSlug={toolSlug}
        existingReview={{ id: review.id, rating: review.rating, body: review.body }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-800 flex items-center justify-center text-xs font-bold text-brand-300 shrink-0">
            {review.reviewer?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">{review.reviewer?.username}</p>
            <p className="text-xs text-gray-600">{timeAgo(review.created_at)}{review.updated_at !== review.created_at && ' · edited'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StarRating rating={review.rating} size={13} />
          {isOwner && (
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => setEditing(true)}
                className="p-1 text-gray-600 hover:text-gray-300 rounded"
                title="Edit review"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => { if (window.confirm('Delete your review?')) deleteMutation.mutate() }}
                disabled={deleteMutation.isPending}
                className="p-1 text-gray-600 hover:text-red-400 rounded"
                title="Delete review"
              >
                {deleteMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          )}
        </div>
      </div>
      {review.body && (
        <p className="text-sm text-gray-400 leading-relaxed pl-10">{review.body}</p>
      )}
    </div>
  )
}

// ── Review list ───────────────────────────────────────────────────
export default function ReviewList({ toolId, toolSlug }) {
  const { isAuthenticated, user } = useAuth()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reviews', toolId],
    queryFn: () => apiClient.get(`/api/reviews/${toolId}`).then(r => r.data),
    enabled: !!toolId,
  })

  const { data: myReviewData, refetch: refetchMine } = useQuery({
    queryKey: ['reviews', toolId, 'mine'],
    queryFn: () => apiClient.get(`/api/reviews/${toolId}/mine`).then(r => r.data),
    enabled: !!toolId && isAuthenticated,
  })

  const reviews    = data?.reviews ?? []
  const myReview   = myReviewData?.review ?? null
  const hasReview  = !!myReview

  const handleDeleted = () => {
    refetchMine()
  }

  return (
    <div className="space-y-5">
      {/* Write / edit form — shown to authenticated users */}
      {isAuthenticated && !hasReview && (
        <ReviewForm toolId={toolId} toolSlug={toolSlug} />
      )}

      {/* Review list */}
      {isLoading && (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      )}
      {isError && (
        <p className="text-sm text-gray-500">Failed to load reviews.</p>
      )}
      {!isLoading && !isError && reviews.length === 0 && (
        <p className="text-sm text-gray-600">
          No reviews yet.{isAuthenticated ? ' Be the first to review this tool.' : ' Sign in to leave a review.'}
        </p>
      )}
      {reviews.map(r => (
        <ReviewCard
          key={r.id}
          review={r}
          toolId={toolId}
          toolSlug={toolSlug}
          currentUserId={user?.id}
          onDeleted={handleDeleted}
        />
      ))}
    </div>
  )
}
