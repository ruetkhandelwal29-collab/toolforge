import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import apiClient from '../services/apiClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Prevent double-fetch when both getSession + INITIAL_SESSION fire on mount
  const fetchingRef = useRef(false)

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION synchronously on mount in
    // Supabase v2 — it is the single source of truth for session state.
    // We do NOT call getSession() separately because the JWT interceptor in
    // apiClient also calls getSession(); firing fetchProfile() before
    // onAuthStateChange has hydrated the session causes a 401 (no token).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          // Guard against double-fetch (INITIAL_SESSION + SIGNED_IN both fire on login)
          if (fetchingRef.current) return
          fetchingRef.current = true
          await fetchProfile()
          fetchingRef.current = false
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile() {
    try {
      const res = await apiClient.get('/api/auth/profile')
      setProfile(res.data.profile)
    } catch (err) {
      console.error('Failed to load profile:', err)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signUpWithEmail(email, password, username, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, full_name: fullName } }
    })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const value = {
    user,
    profile,
    loading,
    isAuthenticated: !!user,
    isCreator: profile?.role === 'creator' || profile?.role === 'admin',
    isAdmin: profile?.role === 'admin',
    signInWithEmail,
    signUpWithEmail,
    signOut,
    refreshProfile: fetchProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
