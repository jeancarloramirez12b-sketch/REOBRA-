import type { BackendConnectionState } from '../../services/healthService.ts'
import styles from './ConnectionStatus.module.css'

const labels = {
  checking: 'Comprobando conexión',
  connected: 'Backend conectado',
  unavailable: 'Backend no disponible',
} as const

type ConnectionStatusProps = {
  health: BackendConnectionState
  compact?: boolean
  onRetry?: () => void
}

function formatCheckedAt(value: string | null): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export function ConnectionStatus({ health, compact = false, onRetry }: ConnectionStatusProps) {
  const checkedAt = formatCheckedAt(health.checkedAt)
  const className = compact ? `${styles.status} ${styles.compact}` : styles.status

  return (
    <div className={className} data-status={health.status} role="status" aria-live="polite">
      <span className={styles.dot} />
      <div className={styles.copy}>
        <p className={styles.label}>{labels[health.status]}</p>
        {compact ? null : <p className={styles.message}>{health.message}</p>}
        {compact || !health.endpoint ? null : <p className={styles.endpoint}>{health.endpoint}</p>}
        {compact || !checkedAt ? null : <p className={styles.time}>Última comprobación: {checkedAt}</p>}
      </div>
      {!compact && onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry} disabled={health.status === 'checking'}>
          Comprobar de nuevo
        </button>
      ) : null}
    </div>
  )
}
