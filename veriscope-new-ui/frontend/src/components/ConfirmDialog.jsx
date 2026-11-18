import { useEffect, useRef } from 'react'
import './ConfirmDialog.css'

/** Modal confirmation built on the native <dialog> (focus trap and Esc come for free). */
export default function ConfirmDialog({ open, title, description, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClick={(event) => {
        // The dialog has no padding, so a click on the dialog element itself is a click on the backdrop.
        if (event.target === dialogRef.current) onCancel()
      }}
    >
      <div className="dialog-body">
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-description">{description}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
