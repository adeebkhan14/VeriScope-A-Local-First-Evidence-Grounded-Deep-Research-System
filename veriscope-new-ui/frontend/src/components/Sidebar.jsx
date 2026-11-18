import { useMemo } from 'react'
import { conversationTitle, groupConversations } from '../lib/format'
import Logo from './Logo'
import SettingsMenu from './SettingsMenu'
import { PanelLeftIcon, PlusIcon, SearchIcon, TrashIcon } from './icons'
import './Sidebar.css'

export default function Sidebar({
  open,
  conversations,
  activeId,
  loading,
  error,
  search,
  onSearchChange,
  onSelect,
  onDelete,
  onNew,
  onClose,
  onRetry,
  theme,
  onThemeChange,
}) {
  const query = search.trim().toLowerCase()

  const groups = useMemo(() => {
    const visible = query
      ? conversations.filter((conversation) => conversationTitle(conversation).toLowerCase().includes(query))
      : conversations
    return groupConversations(visible)
  }, [conversations, query])

  return (
    // `inert` keeps the collapsed sidebar out of the tab order and the accessibility tree.
    <aside className="sidebar" data-open={open} inert={!open} aria-label="Conversations">
      <div className="sidebar-inner">
        <div className="sidebar-top">
          <div className="brand">
            <Logo size={22} />
            <span>VeriScope</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close sidebar">
            <PanelLeftIcon size={18} />
          </button>
        </div>

        <button type="button" className="new-research" onClick={onNew}>
          <PlusIcon size={16} />
          <span>New Research</span>
        </button>

        <label className="sidebar-search">
          <SearchIcon size={15} />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </label>

        <nav className="history" aria-label="Conversation history">
          {error ? (
            <div className="history-note">
              <span>{error}</span>
              <button type="button" className="link-btn" onClick={onRetry}>
                Retry
              </button>
            </div>
          ) : loading && conversations.length === 0 ? (
            <div className="history-note">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="history-note">{query ? 'No matching conversations' : 'No conversations yet'}</div>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="history-group">
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((conversation) => {
                    const title = conversationTitle(conversation)
                    const active = conversation.id === activeId
                    return (
                      <li key={conversation.id} className="history-row" data-active={active}>
                        <button
                          type="button"
                          className="history-select"
                          onClick={() => onSelect(conversation.id)}
                          title={title}
                          aria-current={active ? 'true' : undefined}
                        >
                          <span>{title}</span>
                        </button>
                        <button
                          type="button"
                          className="icon-btn history-delete"
                          onClick={() => onDelete(conversation)}
                          aria-label={`Delete conversation: ${title}`}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </nav>

        <div className="sidebar-bottom">
          <SettingsMenu theme={theme} onThemeChange={onThemeChange} />
        </div>
      </div>
    </aside>
  )
}
