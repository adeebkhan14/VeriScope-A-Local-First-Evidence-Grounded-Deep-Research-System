import { useId } from 'react'
import { evidenceDomId, summarizeDomains } from '../lib/evidence'
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon } from './icons'
import './Evidence.css'

function EvidenceCard({ messageId, item, cited, open, flash, onToggle }) {
  const bodyId = useId()

  return (
    <li id={evidenceDomId(messageId, item.key)} className="ecard" data-open={open} data-flash={flash}>
      <button type="button" className="ecard-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="ecard-number" aria-label={item.number === null ? undefined : `Evidence ${item.number}`}>
          {item.number ?? '·'}
        </span>
        <span className="ecard-main">
          <span className="ecard-title">{item.title}</span>
          {item.domain && <span className="ecard-domain">{item.domain}</span>}
        </span>
        {item.score !== null && (
          <span className="ecard-score" title="Relevance score from hybrid retrieval">
            {item.score.toFixed(2)}
          </span>
        )}
        <ChevronDownIcon className="chevron" size={15} />
      </button>

      <div className="collapse" data-open={open} id={bodyId}>
        <div className="collapse-inner" inert={!open}>
          <div className="ecard-body">
            <blockquote className="ecard-passage">
              {item.text || 'No extracted passage was stored for this source.'}
            </blockquote>
            <div className="ecard-foot">
              <span className="ecard-meta">
                {cited && <span>Cited in answer</span>}
                {item.score !== null && <span>Relevance {item.score.toFixed(2)}</span>}
              </span>
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="ecard-link">
                  Open source
                  <ExternalLinkIcon size={13} />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function EvidenceSection({
  messageId,
  items,
  citedIds,
  insufficient,
  open,
  onToggle,
  openCards,
  onToggleCard,
  flashKey,
}) {
  const panelId = useId()

  return (
    <section className="evidence" aria-label="Evidence">
      <button type="button" className="evidence-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <ChevronRightIcon className="chevron" size={14} />
        <span className="evidence-label">Evidence</span>
        <span className="evidence-count">{items.length}</span>
        {insufficient && <span className="evidence-flag">insufficient</span>}
        <span className="evidence-domains">{summarizeDomains(items)}</span>
      </button>

      <div className="collapse" data-open={open} id={panelId}>
        <div className="collapse-inner" inert={!open}>
          <ol className="evidence-list">
            {items.map((item) => (
              <EvidenceCard
                key={item.key}
                messageId={messageId}
                item={item}
                cited={item.number !== null && citedIds.has(item.number)}
                open={openCards.has(item.key)}
                flash={flashKey === item.key}
                onToggle={() => onToggleCard(item.key)}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
