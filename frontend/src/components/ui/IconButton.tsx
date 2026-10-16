import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
}

export function IconButton({ label, className, children, ...props }: IconButtonProps) {
  return (
    <button type="button" className={[styles.button, className].filter(Boolean).join(' ')} aria-label={label} {...props}>
      {children}
    </button>
  )
}
