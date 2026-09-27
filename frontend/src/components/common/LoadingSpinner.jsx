import { clsx } from 'clsx'
const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }
export default function LoadingSpinner({ size = 'md', className }) {
  return (
    <div className={clsx('animate-spin rounded-full border-2 border-white/10 border-t-brand-500', sizes[size], className)}
      role="status" aria-label="Loading" />
  )
}
