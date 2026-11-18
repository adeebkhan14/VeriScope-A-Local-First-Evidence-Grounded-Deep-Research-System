import { useCallback, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'

const THEMES = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
]

/** Sidebar settings entry. Theme lives here (Design.md §13). */
export default function SettingsMenu({ theme, onThemeChange }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, wrapperRef)

  return (
    <div className="settings" ref={wrapperRef}>
      <button
        type="button"
        className="sidebar-row"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SettingsIcon size={16} />
        <span>Settings</span>
      </button>

      {open && (
        <div className="popover settings-popover" role="dialog" aria-label="Settings">
          <fieldset className="settings-group">
            <legend>Theme</legend>
            <div className="theme-options">
              {THEMES.map(({ value, label, Icon }) => (
                <label key={value} className="theme-option">
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => onThemeChange(value)}
                  />
                  <span>
                    <Icon size={14} />
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  )
}
