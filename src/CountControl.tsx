import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import './count-control.css'

interface Props {
  record: { title: string; countTarget?: number | null; countValue?: number }
  onChange: (delta: number) => void | Promise<void>
}

export default function CountControl({ record, onChange }: Props) {
  const [error, setError] = useState('')
  const target = record.countTarget
  if (!target) return null
  const value = record.countValue ?? 0
  const canDecrease = value > 0
  const canIncrease = value < target

  async function step(delta: -1 | 1) {
    if (delta < 0 ? !canDecrease : !canIncrease) return
    setError('')
    try {
      await onChange(delta)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save the count.')
    }
  }

  return <div className="count-control">
    <div className="count-buttons" role="group" aria-label={'Count for ' + record.title} data-complete={value === target}>
      <button type="button" aria-label={'Decrease count for ' + record.title} title="Decrease count"
        aria-disabled={!canDecrease} onClick={() => void step(-1)}><Minus size={14} aria-hidden="true" /></button>
      <span className="count-value" role="status" aria-atomic="true" aria-label={value + ' of ' + target}>{value}/{target}</span>
      <button type="button" aria-label={'Increase count for ' + record.title} title="Increase count"
        aria-disabled={!canIncrease} onClick={() => void step(1)}><Plus size={14} aria-hidden="true" /></button>
    </div>
    {error && <span className="count-error" role="alert">{error}</span>}
  </div>
}
