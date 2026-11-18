import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { remarkCitations } from '../lib/citations'
import { getSafeExternalUrl } from '../lib/format'
import CopyButton from './CopyButton'
import './Markdown.css'

// ignoreMissing: model output can name any language; an unknown one must render as plain code, not throw.
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false, ignoreMissing: true }]]

function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value
  return (node.children ?? []).map(nodeText).join('')
}

function CodeBlock({ node, children }) {
  const code = node?.children?.[0]
  const classes = Array.isArray(code?.properties?.className) ? code.properties.className : []
  const language = classes.find((name) => typeof name === 'string' && name.startsWith('language-'))?.slice(9)

  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{language || 'text'}</span>
        <CopyButton text={nodeText(code).replace(/\n$/, '')} />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/**
 * Renders model Markdown.
 *  - Raw HTML is never rendered (no rehype-raw), so model-generated HTML cannot execute.
 *  - Remote images are not loaded (local-first: a model must not trigger network requests); alt text is shown instead.
 *  - "[Source N]" markers for known evidence numbers become citation chips; the number is never altered.
 *
 * `sources` is a Map of evidence number -> item; `onCite(number)` opens that evidence card.
 */
export default function Markdown({ content, sources, onCite }) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, [remarkCitations, { ids: [...sources.keys()] }]],
    [sources]
  )

  const components = useMemo(
    () => ({
      a({ node, href, children, ...props }) {
        void node
        const citation = /^#source-(\d+)$/.exec(href ?? '')
        if (citation) {
          const number = Number(citation[1])
          const source = sources.get(number)
          return (
            <button
              type="button"
              className="cite"
              onClick={() => onCite(number)}
              aria-label={`Evidence ${number}${source ? `: ${source.title}` : ''}`}
              title={source ? `${source.title}${source.domain ? ` · ${source.domain}` : ''}` : `Evidence ${number}`}
            >
              {number}
            </button>
          )
        }

        const safeUrl = getSafeExternalUrl(href)
        return safeUrl ? (
          <a {...props} href={safeUrl} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <>{children}</>
        )
      },
      pre: CodeBlock,
      table({ node, children }) {
        void node
        return (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
            <table>{children}</table>
          </div>
        )
      },
      img({ node, alt }) {
        void node
        return alt ? <span className="md-image-alt">[image: {alt}]</span> : null
      },
    }),
    [sources, onCite]
  )

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
