import { Fragment } from 'react'
import './StatusLine.css'

const SERVICES = [
  { key: 'ollama', label: 'Local AI' },
  { key: 'embedding', label: 'Retrieval' },
  { key: 'searxng', label: 'Web search' },
]

function describeService(service, label) {
  if (service?.status === 'online') return { label, ok: true }
  if (service?.status === 'model_missing') return { label: `${label} model missing`, ok: false, detail: service.error }
  return { label: `${label} unavailable`, ok: false, detail: service?.error }
}

/** Small text-only status line built from real health data. */
export default function StatusLine({ health }) {
  if (!health) {
    return <p className="status-line">Checking systems…</p>
  }
  if (!health.ok) {
    return (
      <p className="status-line" data-tone="danger" title={health.error}>
        Backend offline
      </p>
    )
  }

  const services = health.data?.services
  if (!services) {
    return <p className="status-line">Backend online</p>
  }

  const parts = SERVICES.map(({ key, label }) => describeService(services[key], label))
  const allOk = parts.every((part) => part.ok)

  return (
    <p className="status-line" aria-live="polite">
      <span data-tone={allOk ? undefined : 'warn'}>{allOk ? 'Systems operational' : 'Systems degraded'}</span>
      {parts.map((part) => (
        <Fragment key={part.label}>
          <span aria-hidden="true"> · </span>
          <span data-tone={part.ok ? undefined : 'warn'} title={part.detail}>
            {part.label}
          </span>
        </Fragment>
      ))}
    </p>
  )
}
