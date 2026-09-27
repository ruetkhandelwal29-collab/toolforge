import { Link } from 'react-router-dom'
import { ArrowRight, Zap, Star, Shield, Globe, TrendingUp, Code, ImageIcon, Mic, Video } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../services/apiClient'
import ToolCard from '../components/marketplace/ToolCard'

const TOOL_TYPES = [
  { icon: Code, label: 'Text Generation', color: 'text-blue-400' },
  { icon: ImageIcon, label: 'Image Generation', color: 'text-purple-400' },
  { icon: Mic, label: 'Audio', color: 'text-yellow-400' },
  { icon: Video, label: 'Video', color: 'text-red-400' },
]
const FEATURES = [
  { icon: Zap, title: 'Instant Execution', desc: 'Run AI tools in seconds. No setup, no code.' },
  { icon: Globe, title: 'Vast Library', desc: 'Discover AI tools built by a global creator community.' },
  { icon: Shield, title: 'Secure by Design', desc: 'API keys never touch the frontend. All execution server-side.' },
  { icon: TrendingUp, title: 'Creator Earnings', desc: 'Publish your own AI tools and earn from every run.' },
]

export default function Landing() {
  const { data } = useQuery({
    queryKey: ['tools', 'featured'],
    queryFn: () => apiClient.get('/api/tools?featured=true&limit=6').then(r => r.data),
    staleTime: 1000 * 60 * 5,
  })
  const featuredTools = data?.tools ?? []

  return (
    <div>
      <section className="relative overflow-hidden bg-hero-glow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-900/60 border border-brand-800 text-brand-300 text-xs font-medium mb-6">
            <Star size={12} className="fill-brand-400 text-brand-400" /> The AI Tool Marketplace
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.07] mb-6">
            Discover & run
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-purple-400">AI tools instantly</span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg text-gray-400 mb-10">
            ToolForge is the marketplace where creators publish AI-powered tools and users run them in one click. No code. No setup. Just results.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/marketplace" className="btn-primary px-7 py-3 text-base">Explore Tools <ArrowRight size={18} /></Link>
            <Link to="/register" className="btn-secondary px-7 py-3 text-base">Become a Creator</Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-12">
            {TOOL_TYPES.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/8 text-sm text-gray-400">
                <Icon size={15} className={color} />{label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card p-6">
              <div className="w-10 h-10 rounded-xl bg-brand-900/60 border border-brand-800 flex items-center justify-center mb-4">
                <Icon size={20} className="text-brand-400" />
              </div>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {featuredTools.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="section-title">Featured Tools</h2>
            <Link to="/marketplace" className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-1">View all <ArrowRight size={15} /></Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featuredTools.map(tool => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        </section>
      )}

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="card bg-gradient-to-br from-brand-950 to-surface-800 border-brand-900 p-10 text-center">
          <h2 className="text-3xl font-bold text-white mb-3">Ready to build your own AI tool?</h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">Create, publish, and monetize AI tools on ToolForge.</p>
          <Link to="/register" className="btn-primary px-8 py-3 text-base">Start Creating <ArrowRight size={18} /></Link>
        </div>
      </section>
    </div>
  )
}
