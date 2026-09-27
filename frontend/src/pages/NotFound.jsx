import { Link } from 'react-router-dom'
import { Home, Search } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <p className="text-8xl font-black text-white/5 mb-4 select-none">404</p>
      <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
      <p className="text-gray-500 mb-8">The page you're looking for doesn't exist or has been moved.</p>
      <div className="flex gap-3">
        <Link to="/" className="btn-primary"><Home size={16} />Go Home</Link>
        <Link to="/marketplace" className="btn-secondary"><Search size={16} />Browse Tools</Link>
      </div>
    </div>
  )
}
