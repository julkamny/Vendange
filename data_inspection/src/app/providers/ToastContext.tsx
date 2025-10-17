import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastTone = 'info' | 'success' | 'error'

type ToastOptions = {
  tone?: ToastTone
  duration?: number
}

type ToastItem = {
  id: number
  message: string
  tone: ToastTone
}

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timeouts = useRef(new Map<number, number>())
  const idRef = useRef(0)

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
    const timeoutId = timeouts.current.get(id)
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      timeouts.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = ++idRef.current
      const tone = options?.tone ?? 'info'
      const duration = options?.duration ?? 3200
      setToasts(prev => [...prev, { id, message, tone }])
      const timeoutId = window.setTimeout(() => removeToast(id), duration)
      timeouts.current.set(id, timeoutId)
    },
    [removeToast],
  )

  useEffect(() => {
    return () => {
      timeouts.current.forEach(timeoutId => window.clearTimeout(timeoutId))
      timeouts.current.clear()
    }
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="true">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast-message visible toast-${toast.tone}`} role="status">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
