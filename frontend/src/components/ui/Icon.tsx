import type { ReactNode } from 'react'
import styles from './Icon.module.css'

export type IconName =
  | 'home'
  | 'inventory'
  | 'passport'
  | 'projects'
  | 'compatibility'
  | 'deliveries'
  | 'impact'
  | 'assistant'
  | 'settings'
  | 'menu'
  | 'close'
  | 'panel'
  | 'info'
  | 'alert'
  | 'chevron'
  | 'user'
  | 'organization'

const paths: Record<IconName, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />,
  inventory: (
    <>
      <path d="M4 8.5 12 4l8 4.5-8 4.5z" />
      <path d="M4 8.5V16l8 4.5" />
      <path d="M20 8.5V16L12 20.5" />
      <path d="M12 13v7.5" />
    </>
  ),
  passport: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  projects: (
    <>
      <path d="M4 20V9l6-3.5L14 8l6-2.5V20" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  compatibility: (
    <>
      <circle cx="8" cy="12" r="3.25" />
      <circle cx="16" cy="12" r="3.25" />
    </>
  ),
  deliveries: (
    <>
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18.5" r="1.4" />
      <circle cx="17.5" cy="18.5" r="1.4" />
    </>
  ),
  impact: (
    <>
      <path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14z" />
      <path d="M8.5 15.5c2-2.2 4.8-5 8-7.5" />
    </>
  ),
  assistant: (
    <>
      <path d="M5 16.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H9l-4 3.5z" />
      <path d="M8.5 9.5h7M8.5 12.5h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3V20.5M3.5 12h2.2M18.3 12H20.5M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3 6.1 17.9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 20.5 19H3.5z" />
      <path d="M12 10v4" />
      <path d="M12 16.5h.01" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c1.4-2.6 3.6-3.8 6.5-3.8s5.1 1.2 6.5 3.8" />
    </>
  ),
  organization: (
    <>
      <path d="M4 20V8.5L12 4l8 4.5V20" />
      <path d="M9 20v-4h6v4" />
      <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" />
    </>
  ),
}

type IconProps = {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
