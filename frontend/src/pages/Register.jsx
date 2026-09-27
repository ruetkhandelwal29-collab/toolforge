import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../contexts/AuthContext'
import { Zap, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'

const schema = z.object({
  username: z.string().min(3, 'Min 3 chars').max(32).regex(/^[a-z0-9_]+$/, 'Lowercase, numbers, underscores only'),
  full_name: z.string().min(1, 'Required').max(100),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Min 8 characters'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

export default function Register() {
  const { signUpWithEmail } = useAuth()
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(data) {
    try {
      await signUpWithEmail(data.email, data.password, data.username, data.full_name)
      toast.success('Account created! Check your email to confirm.')
      navigate('/login')
    } catch (err) { toast.error(err.message || 'Registration failed') }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-brand-900/60 border border-brand-800 items-center justify-center mb-4"><Zap size={22} className="text-brand-400" /></div>
          <h1 className="text-2xl font-bold text-white">Create an account</h1>
          <p className="text-sm text-gray-500 mt-1">Join ToolForge and start building</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Username</label>
              <input {...register('username')} placeholder="john_doe" className="input" />
              {errors.username && <p className="text-xs text-red-400 mt-1">{errors.username.message}</p>}
            </div>
            <div>
              <label className="label">Full Name</label>
              <input {...register('full_name')} placeholder="John Doe" className="input" />
              {errors.full_name && <p className="text-xs text-red-400 mt-1">{errors.full_name.message}</p>}
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input {...register('email')} type="email" placeholder="you@example.com" className="input" />
            {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input {...register('password')} type={showPw ? 'text' : 'password'} placeholder="Min 8 characters" className="input pr-10" />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-400 mt-1">{errors.password.message}</p>}
          </div>
          <div>
            <label className="label">Confirm Password</label>
            <input {...register('confirm')} type="password" placeholder="Repeat password" className="input" />
            {errors.confirm && <p className="text-xs text-red-400 mt-1">{errors.confirm.message}</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create Account'}</button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-5">Already have an account?{' '}<Link to="/login" className="text-brand-400 hover:text-brand-300">Sign in</Link></p>
      </div>
    </div>
  )
}
