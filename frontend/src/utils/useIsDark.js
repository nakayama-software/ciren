import { useState, useEffect } from 'react'

/**
 * Reacts to the `dark` class on <html> — updated whenever App.jsx toggles theme.
 */
export function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}
