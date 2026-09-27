import { Star } from 'lucide-react'
export default function StarRating({ rating = 0, max = 5, size = 14, interactive = false, onChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} size={size}
          className={i < Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}
          style={interactive ? { cursor: 'pointer' } : {}}
          onClick={() => interactive && onChange?.(i + 1)}
        />
      ))}
    </div>
  )
}
