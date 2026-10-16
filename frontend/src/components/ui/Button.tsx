import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Button.module.css'

type Variant = 'primary' | 'quiet'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  reason?: string
}

export function Button({ variant = 'primary', reason, className, children, disabled, ...props }: ButtonProps) {
  const reasonId = useId()
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ')

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={classes}
        disabled={disabled}
        aria-describedby={reason ? reasonId : undefined}
        {...props}
      >
        {children}
      </button>
      {reason ? (
        <p id={reasonId} className={styles.reason}>
          {reason}
        </p>
      ) : null}
    </span>
  )
}

type ButtonLinkProps = {
  to: string
  children: ReactNode
  variant?: Variant
}

export function ButtonLink({ to, children, variant = 'quiet' }: ButtonLinkProps) {
  return (
    <Link to={to} className={`${styles.button} ${styles[variant]}`}>
      {children}
    </Link>
  )
}
