import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, BarChart2, Edit, Eye, EyeOff, Star, Coins,
  TrendingUp, CheckCircle2, Search, ArrowUpRight,
  Sparkles, Layers
} from 'lucide-react'
import { Link } from 'react-router-dom'
import apiClient from '../services/apiClient'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import StarRating from '../components/common/StarRating'
import { AnalyticsAreaChart } from '../components/creator/AnalyticsChart'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

const PERIODS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: 'all', label: 'All Time' },
]

export default function CreatorDashboard() {
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('30d')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('runs')

  // 1. Overview analytics query
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['creator-overview', period],
    queryFn: () => apiClient.get(`/api/creators/analytics/overview?period=${period}`).then(r => r.data),
  })

  // 2. Usage analytics query
  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ['creator-usage', period],
    queryFn: () => apiClient.get(`/api/creators/analytics/usage?period=${period}`).then(r => r.data),
  })

  // 3. Earnings analytics query
  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ['creator-earnings', period],
    queryFn: () => apiClient.get(`/api/creators/analytics/earnings?period=${period}`).then(r => r.data),
  })

  // 4. Tools list query
  const { data: toolsData, isLoading: toolsLoading } = useQuery({
    queryKey: ['creator-tools-table', period, sortBy, statusFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({
        period,
        sort: sortBy,
        order: 'desc',
        status: statusFilter,
      })
      if (search) params.set('q', search)
      return apiClient.get(`/api/creators/analytics/tools?${params}`).then(r => r.data)
    },
  })

  // Publish / Unpublish mutation
  const publishMutation = useMutation({
    mutationFn: ({ id, publish }) =>
      apiClient.patch(`/api/tools/${id}/publish`, { publish }).then(r => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['creator-overview'] })
      queryClient.invalidateQueries({ queryKey: ['creator-tools-table'] })
      queryClient.invalidateQueries({ queryKey: ['my-tools'] })
      toast.success(data.tool?.is_published ? 'Tool published!' : 'Tool moved to drafts.')
    },
    onError: (err) => toast.error(err.message),
  })

  const lifetime = overview?.lifetime ?? {
    total_tools: 0,
    published_tools: 0,
    draft_tools: 0,
    total_executions: 0,
    total_reviews: 0,
    average_rating: 0,
    total_credits_earned: 0,
  }

  const periodMetrics = overview?.period_metrics ?? {
    executions_in_period: 0,
    successful_runs_in_period: 0,
    failed_runs_in_period: 0,
    credits_earned_in_period: 0,
  }

  const tools = toolsData?.tools ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* ── Studio Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-900/60 border border-brand-800 text-brand-300 text-xs font-medium">
              <Sparkles size={12} className="text-brand-400" /> Professional Studio
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Creator Studio</h1>
          <p className="text-sm text-gray-400 mt-1">
            Monitor real usage, analyze tool performance, and manage your published AI tools.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date range picker */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-1 flex items-center gap-1">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  period === p.value
                    ? 'bg-brand-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Link to="/creator/tools/new" className="btn-primary">
            <Plus size={16} /> New Tool
          </Link>
        </div>
      </div>

      {/* ── Overview KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Tools Created */}
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Tools</span>
            <div className="w-8 h-8 rounded-lg bg-blue-900/40 text-blue-400 flex items-center justify-center">
              <Layers size={16} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">{lifetime.total_tools}</p>
          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <span className="text-emerald-400 font-medium">{lifetime.published_tools} published</span>
            <span>•</span>
            <span>{lifetime.draft_tools} drafts</span>
          </div>
        </div>

        {/* Executions */}
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Executions</span>
            <div className="w-8 h-8 rounded-lg bg-purple-900/40 text-purple-400 flex items-center justify-center">
              <BarChart2 size={16} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">
            {period === 'all'
              ? lifetime.total_executions.toLocaleString()
              : periodMetrics.executions_in_period.toLocaleString()}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <span className="text-brand-300">{lifetime.total_executions.toLocaleString()} lifetime runs</span>
          </div>
        </div>

        {/* Credits Earned */}
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Credits Earned</span>
            <div className="w-8 h-8 rounded-lg bg-amber-900/40 text-amber-400 flex items-center justify-center">
              <Coins size={16} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white">
            {period === 'all'
              ? Number(lifetime.total_credits_earned).toFixed(2)
              : Number(periodMetrics.credits_earned_in_period).toFixed(2)}{' '}
            <span className="text-base font-normal text-amber-400">cr</span>
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <span className="text-amber-300 font-medium">
              {Number(lifetime.total_credits_earned).toFixed(2)} cr lifetime
            </span>
          </div>
        </div>

        {/* Average Rating */}
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Community Rating</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-900/40 text-emerald-400 flex items-center justify-center">
              <Star size={16} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-white">{Number(lifetime.average_rating || 0).toFixed(1)}</p>
            <span className="text-xs text-gray-500">/ 5.0</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <StarRating rating={lifetime.average_rating} size={12} />
            <span>({lifetime.total_reviews} reviews)</span>
          </div>
        </div>
      </div>

      {/* ── Visual Analytics Section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Execution Trends Chart */}
        <div className="lg:col-span-2 card p-6 space-y-4">
          <div className="flex items-center justify-between pb-2">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <TrendingUp size={18} className="text-brand-400" />
                Execution Trends
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Daily tool runs recorded across your tools
              </p>
            </div>
            {usage?.success_rate !== undefined && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-900/50">
                <CheckCircle2 size={12} />
                {usage.success_rate}% Success Rate
              </span>
            )}
          </div>

          {usageLoading ? (
            <div className="flex items-center justify-center h-52">
              <LoadingSpinner />
            </div>
          ) : (
            <AnalyticsAreaChart
              data={usage?.time_series ?? []}
              valueKey="runs"
              labelKey="label"
              height={220}
            />
          )}
        </div>

        {/* Financial & Monetization Breakdown */}
        <div className="card p-6 space-y-4">
          <div className="pb-2">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Coins size={18} className="text-amber-400" />
              Monetization Summary
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Credits earned vs platform fee for {period === 'all' ? 'all time' : period}
            </p>
          </div>

          {earningsLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              <div className="bg-white/3 border border-white/6 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Gross Credits Used</span>
                  <span className="font-semibold text-white">
                    {Number(earnings?.summary?.gross_credits || 0).toFixed(2)} cr
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Platform Commission (20%)</span>
                  <span className="font-semibold text-gray-400">
                    -{Number(earnings?.summary?.platform_fees || 0).toFixed(2)} cr
                  </span>
                </div>
                <div className="border-t border-white/8 pt-2 flex justify-between items-center text-sm">
                  <span className="font-medium text-emerald-300">Creator Net Earnings</span>
                  <span className="font-bold text-emerald-400">
                    {Number(earnings?.summary?.creator_earnings || 0).toFixed(2)} cr
                  </span>
                </div>
              </div>

              {Number(earnings?.summary?.refunded_credits || 0) > 0 && (
                <div className="flex justify-between items-center text-xs px-2 text-rose-400">
                  <span>Refunded from failed runs:</span>
                  <span>{Number(earnings.summary.refunded_credits).toFixed(2)} cr</span>
                </div>
              )}

              {/* Tool breakdown progress */}
              <div className="space-y-2.5 pt-2">
                <p className="text-xs font-medium text-gray-300">Top Tools by Usage</p>
                {usage?.tool_breakdown?.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No usage recorded in this period.</p>
                ) : (
                  usage?.tool_breakdown?.slice(0, 3).map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300 truncate max-w-[150px]">{item.name}</span>
                        <span className="text-gray-500">{item.runs} runs ({item.percentage}%)</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(item.percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tool Performance Table ── */}
      <div className="card overflow-hidden">
        {/* Filter bar */}
        <div className="p-5 border-b border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Tool Performance & Management</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Inspect individual tool metrics, run history, and publication status.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tools…"
                className="input pl-9 py-1.5 text-xs w-48"
              />
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="input py-1.5 text-xs w-auto bg-white/5"
            >
              <option value="all">All Status</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </select>

            {/* Sort by */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="input py-1.5 text-xs w-auto bg-white/5"
            >
              <option value="runs">Most Runs</option>
              <option value="earnings">Most Credits</option>
              <option value="rating">Highest Rated</option>
              <option value="recent">Recently Updated</option>
            </select>
          </div>
        </div>

        {/* Table content */}
        {toolsLoading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : tools.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-gray-400 font-medium">No tools found</p>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              {search || statusFilter !== 'all'
                ? 'Try adjusting your search query or status filter.'
                : 'Create your first AI tool to start tracking executions and earnings.'}
            </p>
            {(!search && statusFilter === 'all') && (
              <Link to="/creator/tools/new" className="btn-primary inline-flex text-xs">
                <Plus size={14} /> Create Tool
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/8 bg-white/2 text-gray-400 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-5">Tool</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Pricing</th>
                  <th className="py-3 px-4 text-right">Runs ({period})</th>
                  <th className="py-3 px-4 text-right">Rating</th>
                  <th className="py-3 px-4 text-right">Credits Earned</th>
                  <th className="py-3 px-4">Last Run</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tools.map(tool => (
                  <tr key={tool.id} className="hover:bg-white/2 transition-colors">
                    {/* Tool Name & Category */}
                    <td className="py-4 px-5">
                      <div className="flex flex-col">
                        <Link
                          to={`/tools/${tool.slug}`}
                          className="font-medium text-white hover:text-brand-300 transition-colors flex items-center gap-1 group truncate max-w-xs"
                        >
                          {tool.name}
                          <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-400" />
                        </Link>
                        <span className="text-[11px] text-gray-500 mt-0.5 truncate max-w-xs">
                          {tool.category?.name || 'General'} • {tool.tool_type}
                        </span>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={tool.is_published ? 'success' : 'default'}>
                          {tool.is_published ? 'Published' : 'Draft'}
                        </Badge>
                        {tool.is_published && !tool.is_approved && (
                          <Badge variant="warning">Review</Badge>
                        )}
                      </div>
                    </td>

                    {/* Pricing */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="text-gray-300 font-medium">
                        {tool.pricing_type === 'free'
                          ? 'Free'
                          : `${tool.credits_per_run} cr / run`}
                      </span>
                    </td>

                    {/* Runs */}
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <span className="font-semibold text-white">
                        {tool.period_runs.toLocaleString()}
                      </span>
                      <span className="text-gray-500 block text-[10px]">
                        {tool.total_runs.toLocaleString()} all-time
                      </span>
                    </td>

                    {/* Rating */}
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 text-gray-300 font-medium">
                        <Star size={11} className="text-amber-400 fill-amber-400" />
                        {Number(tool.avg_rating || 0).toFixed(1)}
                        <span className="text-gray-500 text-[10px]">({tool.review_count})</span>
                      </div>
                    </td>

                    {/* Credits Earned */}
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <span className="font-semibold text-amber-300">
                        {Number(tool.period_credits_earned).toFixed(2)} cr
                      </span>
                      <span className="text-gray-500 block text-[10px]">
                        {Number(tool.total_credits_earned).toFixed(2)} cr all-time
                      </span>
                    </td>

                    {/* Last Run */}
                    <td className="py-4 px-4 whitespace-nowrap text-gray-400 text-[11px]">
                      {tool.last_run_at
                        ? new Date(tool.last_run_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => publishMutation.mutate({ id: tool.id, publish: !tool.is_published })}
                          disabled={publishMutation.isPending}
                          className="btn-ghost py-1 px-2 text-[11px]"
                          title={tool.is_published ? 'Unpublish to draft' : 'Publish to marketplace'}
                        >
                          {tool.is_published ? <EyeOff size={13} className="text-amber-400" /> : <Eye size={13} className="text-emerald-400" />}
                          <span className="hidden md:inline ml-1">{tool.is_published ? 'Unpublish' : 'Publish'}</span>
                        </button>
                        <Link
                          to={`/creator/tools/${tool.id}/edit`}
                          className="btn-secondary py-1 px-2.5 text-[11px]"
                        >
                          <Edit size={12} />
                          <span className="hidden md:inline ml-1">Edit</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
