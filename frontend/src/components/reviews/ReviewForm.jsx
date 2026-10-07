import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Loader2, Trash2, Pencil } from 'lucide-react'
import apiClient from '../../services/apiClient'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

// ── Interactive star picker ───────────────────────────────────────
function StarPicker({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  const display = hovered || value
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className="focus:outline-none"
        >
          <Star
            size={24}
            className={
              n <= display
                ? 'text-amber-400 fill-amber-400 transition-colors'
                : 'text-gray-600 transition-colors hover:text-amber-300'
            }
          />
        </button>
      ))}
      {value > 0 && (
        <span className="ml-2 text-sm text-amber-300 font-medium">
          {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][value]}
        </span>
      )}
    </div>
  )
}

// ── Review form (create + edit) ───────────────────────────────────
export default function ReviewForm({ toolId, toolSlug, existingReview, onCancel }) {
  const { isAuthenticated, profile } = useAuth()
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(existingReview?.rating ?? 0)
  const [body, setBody]     = useState(existingReview?.body ?? '')

  const isEdit = !!existingReview

  const mutation = useMutation({
    mutationFn: () => {
      if (rating < 1 || rating > 5) throw new Error('Please select a rating')
      if (isEdit) {
        return apiClient
          .patch(`/api/reviews/${toolId}/${existingReview.id}`, { rating, body: body || undefined })
          .then(r => r.data)
      }
      return apiClient
        .post(`/api/reviews/${toolId}`, { rating, body: body || undefined })
        .then(r => r.data)
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Review updated!' : 'Review submitted!')
      // Invalidate both the reviews list and the tool detail (avg_rating refreshes)
      queryClient.invalidateQueries({ queryKey: ['reviews', toolId] })
      queryClient.invalidateQueries({ queryKey: ['tool', toolSlug] })
      if (onCancel) onCancel()
    },
    onError: (err) => toast.error(err.message || 'Failed to submit review'),
  })

  if (!isAuthenticated) {
    return (
      <div className="card p-4 text-center text-sm text-gray-500">
        <a href="/login" className="text-brand-400 hover:underline">Sign in</a> to leave a review.
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          {isEdit ? 'Edit your review' : 'Write a review'}
        </h3>
        {isEdit && onCancel && (
          <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        )}
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-2">Your rating <span className="text-red-400">*</span></p>
        <StarPicker value={rating} onChange={setRating} />
      </div>

      <div>
        <label className="label">
          Review <span className="text-gray-600 font-normal">(optional)</span>
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Share your experience with this tool…"
          className="input resize-none"
        />
        <p className="text-xs text-gray-600 mt-1 text-right">{body.length}/2000</p>
      </div>

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || rating === 0}
        className="btn-primary w-full"
      >
        {mutation.isPending
          ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
          : isEdit ? 'Update Review' : 'Submit Review'
        }
      </button>
    </div>
  )
}
