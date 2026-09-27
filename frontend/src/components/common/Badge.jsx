import { clsx } from 'clsx'
const variants = {
  default: 'bg-white/8 text-gray-300',
  brand:   'bg-brand-900/60 text-brand-300 border border-brand-800',
  success: 'bg-emerald-900/40 text-emerald-300',
  warning: 'bg-amber-900/40 text-amber-300',
  danger:  'bg-red-900/40 text-red-300',
  free:    'bg-emerald-900/40 text-emerald-300',
  paid:    'bg-brand-900/60 text-brand-300 border border-brand-800',
  credits: 'bg-amber-900/40 text-amber-300',
}
export default function Badge({ children, variant = 'default', className }) {
  return <span className={clsx('badge', variants[variant], className)}>{children}</span>
}
