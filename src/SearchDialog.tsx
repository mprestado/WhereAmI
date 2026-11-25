import { useState } from 'react'
import { CheckCircle2, CircleDot, ClipboardList, Search } from 'lucide-react'
import Dialog from './Dialog'
import type { Workspace } from './model'
import { searchWorkspace, type SearchResult } from './taskViews'

const resultIcons = { task: ClipboardList, goal: CircleDot, objective: CheckCircle2 }

export default function SearchDialog({ data, onClose, onSelect }: { data: Workspace; onClose: () => void; onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState('')
  const results = searchWorkspace(data, query)
  return <Dialog title="Search workspace" onClose={onClose} className="search-dialog">
    <label className="search-input"><Search size={18} /><span className="visually-hidden">Search goals, objectives, and tasks</span><input autoFocus placeholder="Search goals, objectives, and tasks" type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && results[0]) {
        event.preventDefault()
        onSelect(results[0])
      }
    }} /></label>
    {results.length > 0 ? <ul className="search-results">{results.map(result => {
      const Icon = resultIcons[result.kind]
      return <li key={result.kind + result.id}><button onClick={() => onSelect(result)}><span className="section-icon"><Icon size={16} /></span><span><strong>{result.title}</strong><small>{result.label}{result.context && ' · ' + result.context}</small></span></button></li>
    })}</ul> : <p className="search-empty">{query.trim() ? 'No matches found.' : 'Search by name or notes.'}</p>}
  </Dialog>
}

