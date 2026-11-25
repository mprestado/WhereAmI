import { useId, useRef, useState } from 'react'
import { Hash } from 'lucide-react'
import { MAX_COUNT_TARGET } from './counting'
import './count-target-field.css'

export function parseCountTarget(value: string | undefined): number | null {
  if (value === undefined) return null
  const target = Number(value)
  if (!Number.isInteger(target) || target < 1 || target > MAX_COUNT_TARGET) {
    throw new Error('Enter a whole count target between 1 and ' + MAX_COUNT_TARGET + '.')
  }
  return target
}

export function CountTargetField({ itemLabel, value, onChange, id, disabled, autoFocus }: {
  itemLabel: string
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return <div className="count-target-field">
    <label htmlFor={fieldId}>Count target<span className="visually-hidden"> for {itemLabel}</span></label>
    <input id={fieldId} type="number" name="countTarget" inputMode="numeric" placeholder="10"
      min={1} max={MAX_COUNT_TARGET} step={1} required value={value} disabled={disabled} autoFocus={autoFocus}
      onChange={event => onChange(event.target.value)} />
  </div>
}

export function DraftCountTarget({ itemLabel, value, onChange, disabled, autoFocus }: {
  itemLabel: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [focusTarget, setFocusTarget] = useState(false)
  if (value === undefined) return <button className="count-target-trigger" type="button" ref={trigger}
    aria-label={'Set count target for ' + itemLabel} disabled={disabled}
    onClick={() => { setFocusTarget(true); onChange('') }}>
    <Hash size={14} aria-hidden="true" /> Set count target
  </button>
  return <div className="count-target-draft">
    <CountTargetField itemLabel={itemLabel} value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus || focusTarget} />
    <button className="count-target-trigger" type="button" disabled={disabled} onClick={() => {
      setFocusTarget(false)
      onChange(undefined)
      requestAnimationFrame(() => trigger.current?.focus())
    }}>Use checkbox</button>
  </div>
}
