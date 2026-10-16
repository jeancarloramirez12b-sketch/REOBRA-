import { useId, type InputHTMLAttributes } from 'react'
import styles from './Input.module.css'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, id, disabled, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <label className={styles.field} htmlFor={inputId}>
      <span className={styles.label}>{label}</span>
      <input
        id={inputId}
        className={styles.input}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}
