import { Search, X } from 'lucide-react'
export default function SearchBar({ value, onChange, placeholder = 'Search tools...' }) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="input pl-10 pr-10" />
      {value && <button onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X size={15} /></button>}
    </div>
  )
}
