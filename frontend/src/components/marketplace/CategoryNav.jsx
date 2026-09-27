import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../../services/apiClient'
import LoadingSpinner from '../common/LoadingSpinner'

export default function CategoryNav({ selected, onSelect }) {
  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiClient.get('/api/categories').then(r => r.data.categories),
  })
  if (isLoading) return <div className="flex items-center gap-2"><LoadingSpinner size="sm" /></div>
  const categories = [{ id: null, name: 'All' }, ...(data ?? [])]
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {categories.map(cat => (
        <button key={cat.id ?? 'all'} onClick={() => onSelect(cat.id ?? null)}
          className={clsx('whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0',
            selected === (cat.id ?? null) ? 'bg-brand-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
          )}>
          {cat.name}
        </button>
      ))}
    </div>
  )
}
