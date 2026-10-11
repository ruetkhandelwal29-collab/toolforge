import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert,
  Users,
  Wrench,
  AlertTriangle,
  Play,
  Check,
  X,
  Search,
  UserCheck,
  UserX,
  Shield,
  Eye,
  MessageSquare,
  Clock,
  Filter,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  FileText,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import apiClient from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import toast from 'react-hot-toast'

export default function AdminDashboard() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('moderation') // 'moderation' | 'reports' | 'users' | 'tools'

  // Tool Moderation state
  const [toolSearch, setToolSearch] = useState('')
  const [toolStatusFilter, setToolStatusFilter] = useState('all')

  // Report resolution modal state
  const [selectedReport, setSelectedReport] = useState(null)
  const [reportAction, setReportAction] = useState('resolved')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [reportFilter, setReportFilter] = useState('pending')

  // User management state
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [userStatusFilter, setUserStatusFilter] = useState('all')

  // ── Queries ────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiClient.get('/api/admin/stats').then(r => r.data),
    staleTime: 1000 * 30,
  })

  const { data: pendingToolsData, isLoading: pendingLoading } = useQuery({
    queryKey: ['admin-pending-tools'],
    queryFn: () => apiClient.get('/api/admin/tools?status=pending').then(r => r.data),
  })

  const { data: allToolsData, isLoading: allToolsLoading } = useQuery({
    queryKey: ['admin-all-tools', toolSearch, toolStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (toolSearch) params.set('q', toolSearch)
      if (toolStatusFilter !== 'all') params.set('status', toolStatusFilter)
      return apiClient.get(`/api/admin/tools?${params}`).then(r => r.data)
    },
  })

  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['admin-reports', reportFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (reportFilter !== 'all') params.set('status', reportFilter)
      return apiClient.get(`/api/admin/reports?${params}`).then(r => r.data)
    },
  })

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users', userSearch, userRoleFilter, userStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (userSearch) params.set('q', userSearch)
      if (userRoleFilter !== 'all') params.set('role', userRoleFilter)
      if (userStatusFilter !== 'all') params.set('status', userStatusFilter)
      return apiClient.get(`/api/admin/users?${params}`).then(r => r.data)
    },
  })

  const { data: auditLogsData, isLoading: auditLogsLoading } = useQuery({
    queryKey: ['admin-audit-logs'],
    queryFn: () => apiClient.get('/api/admin/audit-logs').then(r => r.data),
    enabled: activeTab === 'audit',
  })

  // ── Mutations ──────────────────────────────────────────────────────
  const approveToolMutation = useMutation({
    mutationFn: (toolId) => apiClient.patch(`/api/admin/tools/${toolId}/approve`),
    onSuccess: () => {
      toast.success('Tool approved and published!')
      queryClient.invalidateQueries(['admin-pending-tools'])
      queryClient.invalidateQueries(['admin-all-tools'])
      queryClient.invalidateQueries(['admin-stats'])
      queryClient.invalidateQueries(['admin-audit-logs'])
    },
    onError: (err) => toast.error(err.message || 'Failed to approve tool'),
  })

  const rejectToolMutation = useMutation({
    mutationFn: (toolId) => apiClient.patch(`/api/admin/tools/${toolId}/reject`),
    onSuccess: () => {
      toast.success('Tool rejected')
      queryClient.invalidateQueries(['admin-pending-tools'])
      queryClient.invalidateQueries(['admin-all-tools'])
      queryClient.invalidateQueries(['admin-stats'])
      queryClient.invalidateQueries(['admin-audit-logs'])
    },
    onError: (err) => toast.error(err.message || 'Failed to reject tool'),
  })

  const suspendToolMutation = useMutation({
    mutationFn: (toolId) => apiClient.patch(`/api/admin/tools/${toolId}/suspend`),
    onSuccess: () => {
      toast.success('Tool suspended')
      queryClient.invalidateQueries(['admin-pending-tools'])
      queryClient.invalidateQueries(['admin-all-tools'])
      queryClient.invalidateQueries(['admin-stats'])
      queryClient.invalidateQueries(['admin-audit-logs'])
    },
    onError: (err) => toast.error(err.message || 'Failed to suspend tool'),
  })

  const resolveReportMutation = useMutation({
    mutationFn: ({ reportId, status, resolution_notes }) =>
      apiClient.patch(`/api/admin/reports/${reportId}`, { status, resolution_notes }),
    onSuccess: () => {
      toast.success('Report updated successfully')
      setSelectedReport(null)
      setResolutionNotes('')
      queryClient.invalidateQueries(['admin-reports'])
      queryClient.invalidateQueries(['admin-stats'])
      queryClient.invalidateQueries(['admin-audit-logs'])
    },
    onError: (err) => toast.error(err.message || 'Failed to update report'),
  })

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }) => apiClient.patch(`/api/admin/users/${userId}`, data),
    onSuccess: () => {
      toast.success('User updated successfully')
      queryClient.invalidateQueries(['admin-users'])
      queryClient.invalidateQueries(['admin-stats'])
      queryClient.invalidateQueries(['admin-audit-logs'])
    },
    onError: (err) => toast.error(err.message || 'Failed to update user'),
  })

  const pendingTools = pendingToolsData?.tools ?? []
  const allTools = allToolsData?.tools ?? []
  const reports = reportsData?.reports ?? []
  const users = usersData?.users ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-900/40 border border-purple-800 text-purple-300 text-xs font-semibold mb-2">
            <ShieldAlert size={13} /> Platform Administration
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Admin Studio</h1>
          <p className="text-sm text-gray-400 mt-1">Review tools, resolve user reports, and manage system accounts.</p>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="card p-4">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-medium">Total Users</span>
            <Users size={16} className="text-brand-400" />
          </div>
          <p className="text-2xl font-bold text-white">{statsLoading ? '…' : stats?.total_users ?? 0}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{stats?.total_creators ?? 0} creators</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-medium">Tools Total</span>
            <Wrench size={16} className="text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white">{statsLoading ? '…' : stats?.total_tools ?? 0}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{stats?.published_tools ?? 0} published</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-medium">Pending Review</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-300">{statsLoading ? '…' : stats?.pending_tools ?? 0}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">awaiting approval</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-medium">Open Reports</span>
            <AlertTriangle size={16} className={(stats?.open_reports ?? 0) > 0 ? 'text-red-400' : 'text-gray-500'} />
          </div>
          <p className={`text-2xl font-bold ${(stats?.open_reports ?? 0) > 0 ? 'text-red-400' : 'text-white'}`}>
            {statsLoading ? '…' : stats?.open_reports ?? 0}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">pending action</p>
        </div>

        <div className="card p-4 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-medium">Completed Runs</span>
            <Play size={16} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white">{statsLoading ? '…' : (stats?.total_runs ?? 0).toLocaleString()}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">successful executions</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 mb-6 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'moderation'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Clock size={16} />
          Moderation Queue
          {(stats?.pending_tools ?? 0) > 0 && (
            <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs rounded-full">
              {stats.pending_tools}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'reports'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <AlertTriangle size={16} />
          User Reports
          {(stats?.open_reports ?? 0) > 0 && (
            <span className="px-1.5 py-0.2 bg-red-500/20 text-red-300 border border-red-500/40 text-xs rounded-full">
              {stats.open_reports}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'users'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Users size={16} />
          User Management
        </button>

        <button
          onClick={() => setActiveTab('tools')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'tools'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Wrench size={16} />
          All Tools
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'audit'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText size={16} />
          Audit Trail
        </button>
      </div>

      {/* ── TAB 1: MODERATION QUEUE ──────────────────────────────────── */}
      {activeTab === 'moderation' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Pending Review ({pendingTools.length})</h2>
            <p className="text-xs text-gray-400">Creators must wait for admin approval before tools appear on the marketplace.</p>
          </div>

          {pendingLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : pendingTools.length === 0 ? (
            <div className="card p-12 text-center">
              <CheckCircle size={36} className="text-emerald-400 mx-auto mb-2" />
              <p className="text-gray-200 font-medium">Moderation queue is empty</p>
              <p className="text-xs text-gray-500 mt-1">All submitted tools have been reviewed.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingTools.map(tool => (
                <div key={tool.id} className="card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white text-base truncate">{tool.name}</h3>
                      <Badge variant="warning">Pending Approval</Badge>
                      <span className="badge bg-white/5 text-gray-300 text-xs">{tool.category?.name || tool.tool_type}</span>
                      <span className="badge bg-brand-900/40 text-brand-300 text-xs">{tool.pricing_type}</span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-2 mb-2">{tool.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>Creator: <strong className="text-gray-300">@{tool.creator?.username}</strong></span>
                      <span>Submitted: {new Date(tool.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/tools/${tool.slug}`}
                      target="_blank"
                      className="btn-ghost py-2 px-3 text-xs flex items-center gap-1.5"
                    >
                      <Eye size={14} /> Preview
                    </Link>
                    <button
                      onClick={() => rejectToolMutation.mutate(tool.id)}
                      disabled={rejectToolMutation.isPending || approveToolMutation.isPending}
                      className="btn-secondary py-2 px-3 text-xs text-red-400 hover:bg-red-900/20 border-red-900/30 flex items-center gap-1.5"
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      onClick={() => approveToolMutation.mutate(tool.id)}
                      disabled={rejectToolMutation.isPending || approveToolMutation.isPending}
                      className="btn-primary py-2 px-4 text-xs flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500"
                    >
                      <Check size={14} /> Approve & Publish
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: USER REPORTS ───────────────────────────────────────── */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-white">Community Reports ({reports.length})</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Status:</span>
              <select
                value={reportFilter}
                onChange={e => setReportFilter(e.target.value)}
                className="input py-1.5 px-3 text-xs w-auto bg-surface-800"
              >
                <option value="pending">Pending ({stats?.open_reports ?? 0})</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
                <option value="all">All Reports</option>
              </select>
            </div>
          </div>

          {reportsLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : reports.length === 0 ? (
            <div className="card p-12 text-center">
              <CheckCircle size={36} className="text-emerald-400 mx-auto mb-2" />
              <p className="text-gray-200 font-medium">No reports match this filter</p>
              <p className="text-xs text-gray-500 mt-1">Platform guidelines are being respected.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(rep => (
                <div key={rep.id} className="card p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2">
                      <span className={`badge text-xs ${
                        rep.status === 'pending'
                          ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                          : rep.status === 'resolved'
                          ? 'bg-emerald-900/40 text-emerald-300'
                          : 'bg-white/5 text-gray-400'
                      }`}>
                        {rep.status.toUpperCase()}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        Reason: <span className="text-red-300 font-normal">{rep.reason}</span>
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{new Date(rep.created_at).toLocaleString()}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-gray-500 mb-1">Target Tool</p>
                      <p className="text-white font-medium flex items-center gap-1.5">
                        {rep.tool?.name || rep.target_id}
                        {rep.tool?.slug && (
                          <Link to={`/tools/${rep.tool.slug}`} target="_blank" className="text-brand-400 hover:text-brand-300">
                            <ExternalLink size={12} />
                          </Link>
                        )}
                      </p>
                      <p className="text-gray-500 mt-0.5">
                        Status: {rep.tool?.is_approved ? 'Approved' : 'Unapproved'} / {rep.tool?.is_published ? 'Published' : 'Hidden'}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-500 mb-1">Reported By</p>
                      <p className="text-gray-300 font-medium">@{rep.reporter?.username || 'Unknown'}</p>
                    </div>
                  </div>

                  {rep.details && (
                    <div className="bg-black/20 p-3 rounded-lg border border-white/5 text-xs text-gray-300">
                      <strong className="text-gray-400 block mb-0.5">Details:</strong>
                      {rep.details}
                    </div>
                  )}

                  {rep.resolution_notes && (
                    <div className="bg-brand-950/40 p-3 rounded-lg border border-brand-900/50 text-xs text-brand-200">
                      <strong className="text-brand-300 block mb-0.5">
                        Resolution by @{rep.resolver?.username || 'admin'} ({new Date(rep.resolved_at).toLocaleDateString()}):
                      </strong>
                      {rep.resolution_notes}
                    </div>
                  )}

                  {rep.status === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                      {rep.tool?.id && (
                        <button
                          onClick={() => suspendToolMutation.mutate(rep.tool.id)}
                          disabled={suspendToolMutation.isPending}
                          className="btn-secondary py-1.5 px-3 text-xs text-red-400 hover:bg-red-900/20 border-red-900/30"
                        >
                          Suspend Reported Tool
                        </button>
                      )}
                      <button
                        onClick={() => { setSelectedReport(rep); setReportAction('resolved') }}
                        className="btn-primary py-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500"
                      >
                        Resolve Report
                      </button>
                      <button
                        onClick={() => { setSelectedReport(rep); setReportAction('dismissed') }}
                        className="btn-secondary py-1.5 px-3 text-xs"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: USER MANAGEMENT ───────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search username or name..."
                className="input pl-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={userRoleFilter}
                onChange={e => setUserRoleFilter(e.target.value)}
                className="input py-2 text-xs w-auto bg-surface-800"
              >
                <option value="all">All Roles</option>
                <option value="user">Users</option>
                <option value="creator">Creators</option>
                <option value="admin">Admins</option>
              </select>

              <select
                value={userStatusFilter}
                onChange={e => setUserStatusFilter(e.target.value)}
                className="input py-2 text-xs w-auto bg-surface-800"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : users.length === 0 ? (
            <div className="card p-12 text-center text-gray-500">No users found matching your filters.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Credits</th>
                    <th className="px-4 py-3">Tools</th>
                    <th className="px-4 py-3">Runs</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-300">
                  {users.map(u => {
                    const isSelf = u.id === currentUser?.id
                    return (
                      <tr key={u.id} className="hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 font-medium text-white flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-700 flex items-center justify-center text-xs text-white uppercase font-bold shrink-0">
                            {u.username?.[0] || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-white font-medium">{u.username}</p>
                            <p className="text-[11px] text-gray-500 truncate">{u.full_name || '—'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={isSelf || updateUserMutation.isPending}
                            onChange={(e) => updateUserMutation.mutate({ userId: u.id, data: { role: e.target.value } })}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none disabled:opacity-50"
                          >
                            <option value="user">user</option>
                            <option value="creator">creator</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-amber-300">{u.credit_balance}</td>
                        <td className="px-4 py-3">{u.tool_count}</td>
                        <td className="px-4 py-3">{u.run_count}</td>
                        <td className="px-4 py-3">
                          <span className={`badge text-[11px] ${
                            u.is_active !== false
                              ? 'bg-emerald-900/40 text-emerald-300'
                              : 'bg-rose-900/40 text-rose-300 border border-rose-800'
                          }`}>
                            {u.is_active !== false ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-[11px] text-gray-500 italic">Current User</span>
                          ) : (
                            <button
                              onClick={() => updateUserMutation.mutate({
                                userId: u.id,
                                data: { is_active: u.is_active === false }
                              })}
                              disabled={updateUserMutation.isPending}
                              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                u.is_active !== false
                                  ? 'bg-red-900/30 text-red-300 hover:bg-red-900/50'
                                  : 'bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50'
                              }`}
                            >
                              {u.is_active !== false ? 'Suspend' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: ALL TOOLS ─────────────────────────────────────────── */}
      {activeTab === 'tools' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
                placeholder="Search tools by name or description..."
                className="input pl-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={toolStatusFilter}
                onChange={e => setToolStatusFilter(e.target.value)}
                className="input py-2 text-xs w-auto bg-surface-800"
              >
                <option value="all">All Statuses</option>
                <option value="approved">Approved & Published</option>
                <option value="pending">Pending Approval</option>
                <option value="draft">Drafts</option>
                <option value="rejected">Suspended / Rejected</option>
              </select>
            </div>
          </div>

          {allToolsLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : allTools.length === 0 ? (
            <div className="card p-12 text-center text-gray-500">No tools found matching your search.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3">Tool</th>
                    <th className="px-4 py-3">Creator</th>
                    <th className="px-4 py-3">Pricing</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reports</th>
                    <th className="px-4 py-3">Runs</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-300">
                  {allTools.map(t => {
                    const statusLabel =
                      t.is_approved && t.is_published ? 'Approved'
                      : t.is_published && !t.is_approved ? 'Pending Review'
                      : !t.is_published && !t.is_approved ? 'Draft'
                      : 'Suspended'
                    const statusBadgeVariant =
                      t.is_approved && t.is_published ? 'bg-emerald-900/40 text-emerald-300'
                      : t.is_published && !t.is_approved ? 'bg-amber-900/40 text-amber-300'
                      : 'bg-white/5 text-gray-400'

                    return (
                      <tr key={t.id} className="hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-white">{t.name}</p>
                          <p className="text-[11px] text-gray-500 truncate max-w-xs">{t.description}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-300">@{t.creator?.username || 'Unknown'}</td>
                        <td className="px-4 py-3 capitalize">{t.pricing_type} ({t.credits_per_run} cr)</td>
                        <td className="px-4 py-3">
                          <span className={`badge text-[11px] ${statusBadgeVariant}`}>{statusLabel}</span>
                        </td>
                        <td className="px-4 py-3">
                          {Number(t.pending_reports_count) > 0 ? (
                            <span className="badge bg-red-900/40 text-red-300">{t.pending_reports_count} open</span>
                          ) : (
                            <span className="text-gray-500">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono">{t.run_count}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link to={`/tools/${t.slug}`} target="_blank" className="btn-ghost py-1 px-2 text-xs">
                              <Eye size={13} />
                            </Link>
                            {!t.is_approved ? (
                              <button
                                onClick={() => approveToolMutation.mutate(t.id)}
                                disabled={approveToolMutation.isPending}
                                className="px-2 py-1 bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 rounded text-xs"
                              >
                                Approve
                              </button>
                            ) : (
                              <button
                                onClick={() => suspendToolMutation.mutate(t.id)}
                                disabled={suspendToolMutation.isPending}
                                className="px-2 py-1 bg-red-900/30 text-red-300 hover:bg-red-900/50 rounded text-xs"
                              >
                                Suspend
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 5: AUDIT TRAIL ───────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Platform Audit Trail</h2>
            <p className="text-xs text-gray-400">Chronological ledger of all moderation actions and administrator changes.</p>
          </div>

          {auditLogsLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : !auditLogsData?.logs || auditLogsData.logs.length === 0 ? (
            <div className="card p-12 text-center text-gray-500">No moderation audit entries recorded yet.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Administrator</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-300 font-mono text-[11px]">
                  {auditLogsData.logs.map(log => (
                    <tr key={log.id} className="hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-white font-sans font-medium">
                        @{log.admin?.username || 'system'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge text-[10px] font-mono ${
                          log.action?.startsWith('tool.approve') || log.action?.includes('activate')
                            ? 'bg-emerald-900/40 text-emerald-300'
                            : log.action?.includes('suspend') || log.action?.includes('reject')
                            ? 'bg-rose-900/40 text-rose-300 border border-rose-800'
                            : 'bg-brand-900/40 text-brand-300'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <span className="text-gray-300 font-sans">{log.target_type}</span>: {log.target_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-sans max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── RESOLUTION MODAL ─────────────────────────────────────────── */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="card max-w-md w-full p-6 space-y-4 border-white/10 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white capitalize">{reportAction} Report</h3>
              <button onClick={() => setSelectedReport(null)} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-400">
              Target: <strong className="text-gray-200">{selectedReport.tool?.name || selectedReport.target_id}</strong>
              <br />
              Reason: <span className="text-red-300">{selectedReport.reason}</span>
            </p>

            <div>
              <label className="label text-xs">Resolution Notes (internal record)</label>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="Explain the outcome, action taken, or rationale..."
                rows={4}
                className="input text-xs resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="btn-secondary py-1.5 px-3 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveReportMutation.mutate({
                  reportId: selectedReport.id,
                  status: reportAction,
                  resolution_notes: resolutionNotes,
                })}
                disabled={resolveReportMutation.isPending}
                className={`btn-primary py-1.5 px-4 text-xs ${
                  reportAction === 'resolved' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {resolveReportMutation.isPending ? 'Saving…' : `Confirm ${reportAction}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
