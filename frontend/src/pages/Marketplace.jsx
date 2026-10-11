import { useState, useDeferredValue, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal, Star, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import apiClient from '../services/apiClient'
import ToolCard from '../components/marketplace/ToolCard'
import CategoryNav from '../components/marketplace/CategoryNav'
import SearchBar from '../components/marketplace/SearchBar'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { clsx } from 'clsx'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
]

const PAGE_SIZE = 12

export default function Marketplace() {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [sort, setSort] = useState('newest')
  const [featuredOnly, setFeaturedOnly] = useState(false)
  const [page, setPage] = useState(1)

  const deferredSearch = useDeferredValue(search)

  // Reset page to 1 whenever filters change
  useEffect(() => {
    setPage(1)
  }, [deferredSearch, categoryId, sort, featuredOnly])

  const offset = (page - 1) * PAGE_SIZE

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['tools', deferredSearch, categoryId, sort, featuredOnly, page],
    queryFn: () => {
      const params = new URLSearchParams({
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (deferredSearch) params.set('q', deferredSearch)
      if (categoryId) params.set('category', String(categoryId))
      if (featuredOnly) params.set('featured', 'true')
      return apiClient.get(`/api/tools?${params}`).then(r => r.data)
    },
    staleTime: 1000 * 60 * 2,
    placeholderData: (prev) => prev,
    retry: false,
  })

  const tools = data?.tools ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasActiveFilters = Boolean(deferredSearch || categoryId || featuredOnly || sort !== 'newest')

  function handleResetFilters() {
    setSearch('')
    setCategoryId(null)
    setSort('newest')
    setFeaturedOnly(false)
    setPage(1)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Title */}
      <div className="mb-8">
        <h1 className="section-title mb-1">AI Tool Marketplace</h1>
        <p className="text-muted text-sm">Discover and run AI-powered tools built by the community.</p>
      </div>

      {/* Search, Sort & Featured Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search by name or description…" />
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Featured Toggle */}
          <button
            type="button"
            onClick={() => setFeaturedOnly(v => !v)}
            className={clsx(
              "inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors border",
              featuredOnly
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-white/5 text-gray-400 border-white/10 hover:text-gray-200 hover:bg-white/10"
            )}
            title="Filter by featured tools"
          >
            <Star size={14} className={featuredOnly ? "fill-amber-400 text-amber-400" : "text-gray-400"} />
            <span>Featured</span>
          </button>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-gray-500" />
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="input py-2.5 w-auto bg-white/5"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters button if any filter is applied */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="btn-ghost text-xs py-2 px-2.5 text-gray-400 hover:text-white flex items-center gap-1"
              title="Reset all filters"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Navigation */}
      <div className="mb-7">
        <CategoryNav selected={categoryId} onSelect={setCategoryId} />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="text-center py-20">
          <p className="text-gray-400 text-lg font-medium">Could not load tools</p>
          <p className="text-gray-600 text-sm mt-1">Check your connection and try again.</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && tools.length === 0 && (
        <div className="text-center py-20 card p-8 max-w-md mx-auto">
          {hasActiveFilters ? (
            <>
              <p className="text-gray-300 text-lg font-medium mb-1">No tools match your criteria</p>
              <p className="text-gray-500 text-sm mb-5">Try clearing filters or searching for something else.</p>
              <button onClick={handleResetFilters} className="btn-secondary text-sm">
                <RotateCcw size={14} /> Clear all filters
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-300 text-lg font-medium mb-1">No published tools yet</p>
              <p className="text-gray-500 text-sm">Be the first creator to publish a tool on ToolForge.</p>
            </>
          )}
        </div>
      )}

      {/* Tool Grid + Results Count + Pagination */}
      {!isLoading && tools.length > 0 && (
        <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-500">
              Showing {offset + 1}–{Math.min(offset + tools.length, total)} of {total} tool{total !== 1 ? 's' : ''}
              {isFetching && <span className="ml-2 text-brand-400">updating…</span>}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {tools.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-10 pt-6 border-t border-white/5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span className="text-xs text-gray-400 px-2">
                Page <strong className="text-white">{page}</strong> of <strong className="text-white">{totalPages}</strong>
              </span>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
