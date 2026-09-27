import { Link } from 'react-router-dom'
import { Star, Play, Zap } from 'lucide-react'
import Badge from '../common/Badge'
import { clsx } from 'clsx'

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
  const { slug, name, description, creator, category, pricing_type, price_per_run, credits_per_run, avg_rating, review_count, run_count, thumbnail_url } = tool
  const pricingLabel = pricing_type === 'free' ? 'Free'
    : pricing_type === 'credits' ? `${credits_per_run} Credits`
    : `$${Number(price_per_run).toFixed(2)}`
  return (
    <Link to={`/tools/${slug}`} className="group block">
      <div className="card-hover p-4 h-full flex flex-col gap-3">
        <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-brand-900/60 to-surface-800 flex items-center justify-center overflow-hidden">
          {thumbnail_url ? <img src={thumbnail_url} alt={name} className="w-full h-full object-cover" /> : <Zap size={32} className="text-brand-600" />}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className={clsx('badge text-xs', CATEGORY_COLORS[category?.name] ?? 'bg-white/8 text-gray-400')}>{category?.name ?? 'Other'}</span>
          <Badge variant={pricing_type === 'free' ? 'free' : pricing_type === 'credits' ? 'credits' : 'paid'}>{pricingLabel}</Badge>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white text-sm leading-snug group-hover:text-brand-300 transition-colors line-clamp-2">{name}</h3>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{description}</p>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="truncate">by {creator?.username ?? 'Unknown'}</span>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="flex items-center gap-1"><Star size={11} className="text-amber-400 fill-amber-400" />{Number(avg_rating || 0).toFixed(1)} ({review_count ?? 0})</span>
            <span className="flex items-center gap-1"><Play size={11} />{formatCount(run_count ?? 0)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
