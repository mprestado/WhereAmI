import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export default function Dialog({ title, description, onClose, children, className = '' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement
    if (dialog && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]), textarea')?.focus({ preventScroll: true })
    }
    return () => {
      dialog?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={'dialog ' + className}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={event => { event.preventDefault(); onClose() }}
    >
      <div className="dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="icon-btn dialog-close" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  )
}
