import { useState, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import apiClient from '../services/apiClient'
import ToolCard from '../components/marketplace/ToolCard'
import CategoryNav from '../components/marketplace/CategoryNav'
import SearchBar from '../components/marketplace/SearchBar'
import LoadingSpinner from '../components/common/LoadingSpinner'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
]

export default function Marketplace() {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [sort, setSort] = useState('newest')
  const deferredSearch = useDeferredValue(search)

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['tools', deferredSearch, categoryId, sort],
    queryFn: () => {
      const params = new URLSearchParams({ sort })
      if (deferredSearch) params.set('q', deferredSearch)
      if (categoryId) params.set('category', categoryId)
      return apiClient.get(`/api/tools?${params}`).then(r => r.data)
    },
    staleTime: 1000 * 60 * 2,       // 2 min — avoid re-fetch on every filter touch
    placeholderData: (prev) => prev, // keep previous results visible during transition
    retry: false,
  })

  const tools = data?.tools ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8">
        <h1 className="section-title mb-1">AI Tool Marketplace</h1>
        <p className="text-muted text-sm">Discover and run AI-powered tools built by the community.</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} /></div>
        <div className="flex items-center gap-2 shrink-0">
          <SlidersHorizontal size={15} className="text-gray-500" />
          <select value={sort} onChange={e => setSort(e.target.value)} className="input py-2 w-auto bg-white/5">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-7"><CategoryNav selected={categoryId} onSelect={setCategoryId} /></div>
      {isLoading && <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>}
      {isError && (
        <div className="text-center py-20">
          <p className="text-gray-400 text-lg font-medium">Could not load tools</p>
          <p className="text-gray-600 text-sm mt-1">Check your connection and try again.</p>
        </div>
      )}
      {!isLoading && !isError && tools.length === 0 && (
        <div className="text-center py-20">
          {deferredSearch || categoryId ? (
            <>
              <p className="text-gray-400 text-lg font-medium">No tools found</p>
              <p className="text-gray-600 text-sm mt-1">Try a different search or category.</p>
            </>
          ) : (
            <>
              <p className="text-gray-400 text-lg font-medium">No published tools yet</p>
              <p className="text-gray-600 text-sm mt-1">Be the first creator to publish a tool on ToolForge.</p>
            </>
          )}
        </div>
      )}
      {!isLoading && tools.length > 0 && (
        <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <p className="text-xs text-gray-600 mb-4">
            {data?.total ?? tools.length} tool{(data?.total ?? tools.length) !== 1 ? 's' : ''}
            {isFetching && <span className="ml-2 text-gray-700">updating…</span>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {tools.map(tool => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        </div>
      )}
    </div>
  )
}
