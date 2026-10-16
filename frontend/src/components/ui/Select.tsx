import { useId, type SelectHTMLAttributes } from 'react'
import styles from './Input.module.css'

type Option = {
  value: string
  label: string
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  options: Option[]
  hint?: string
  error?: string
}

export function Select({ label, options, hint, error, id, disabled, ...props }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = hint ? `${selectId}-hint` : undefined
  const errorId = error ? `${selectId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <label className={styles.field} htmlFor={selectId}>
      <span className={styles.label}>{label}</span>
      <select
        id={selectId}
        className={styles.input}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
