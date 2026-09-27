import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'
export default function Footer() {
  return (
    <footer className="border-t border-white/8 bg-surface-900 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <Link to="/" className="flex items-center gap-2 font-bold text-white mb-3">
              <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center"><Zap size={15} className="text-white" /></div>
              ToolForge
            </Link>
            <p className="text-sm text-gray-500">The marketplace for AI-powered tools.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-300 mb-3">Platform</p>
            <ul className="space-y-2">
              <li><Link to="/marketplace" className="text-sm text-gray-500 hover:text-gray-300">Marketplace</Link></li>
              <li><Link to="/creator/dashboard" className="text-sm text-gray-500 hover:text-gray-300">Creator Studio</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-300 mb-3">Account</p>
            <ul className="space-y-2">
              <li><Link to="/login" className="text-sm text-gray-500 hover:text-gray-300">Sign In</Link></li>
              <li><Link to="/register" className="text-sm text-gray-500 hover:text-gray-300">Sign Up</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-300 mb-3">Legal</p>
            <ul className="space-y-2">
              <li><span className="text-sm text-gray-500">Privacy Policy</span></li>
              <li><span className="text-sm text-gray-500">Terms of Service</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/8 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-600">&copy; {new Date().getFullYear()} ToolForge. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
