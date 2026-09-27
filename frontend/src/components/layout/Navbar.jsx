import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { Zap, Menu, X, LayoutDashboard, LogOut, User, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'

export default function Navbar() {
  const { isAuthenticated, isCreator, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-surface-900/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg text-white shrink-0">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span>ToolForge</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/marketplace" className={({ isActive }) => clsx('btn-ghost text-sm', isActive && 'text-white bg-white/5')}>
              Marketplace
            </NavLink>
          </nav>

          <div className="flex items-center gap-3">
            {loading ? null : isAuthenticated ? (
              <div className="relative" ref={dropRef}>
                <button onClick={() => setDropdownOpen(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-brand-700 flex items-center justify-center text-xs font-bold text-white">
                    {profile?.username?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="text-sm text-gray-200 hidden sm:block">{profile?.username}</span>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 card border-white/10 shadow-xl py-1">
                    <Link to="/dashboard" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white" onClick={() => setDropdownOpen(false)}>
                      <User size={15} /> My Dashboard
                    </Link>
                    {isCreator && (
                      <Link to="/creator/dashboard" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white" onClick={() => setDropdownOpen(false)}>
                        <LayoutDashboard size={15} /> Creator Studio
                      </Link>
                    )}
                    <div className="border-t border-white/8 my-1" />
                    <button onClick={handleSignOut} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300">
                      <LogOut size={15} /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="btn-ghost hidden sm:inline-flex">Sign In</Link>
                <Link to="/register" className="btn-primary">Get Started</Link>
              </>
            )}
            <button className="md:hidden btn-ghost px-2" onClick={() => setMobileOpen(v => !v)}>
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden border-t border-white/8 bg-surface-900 px-4 py-3 space-y-1">
          <NavLink to="/marketplace" className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5" onClick={() => setMobileOpen(false)}>Marketplace</NavLink>
          {isAuthenticated ? (
            <>
              <NavLink to="/dashboard" className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5" onClick={() => setMobileOpen(false)}>Dashboard</NavLink>
              {isCreator && <NavLink to="/creator/dashboard" className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5" onClick={() => setMobileOpen(false)}>Creator Studio</NavLink>}
              <button onClick={handleSignOut} className="block w-full text-left px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-900/20">Sign Out</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5" onClick={() => setMobileOpen(false)}>Sign In</NavLink>
              <NavLink to="/register" className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5" onClick={() => setMobileOpen(false)}>Get Started</NavLink>
            </>
          )}
        </div>
      )}
    </header>
  )
}
