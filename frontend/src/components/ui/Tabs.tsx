import { useRef, useState, type ReactNode } from 'react'
import styles from './Tabs.module.css'

export type TabItem = {
  id: string
  label: string
  content: ReactNode
}

type TabsProps = {
  label: string
  tabs: TabItem[]
}

export function Tabs({ label, tabs }: TabsProps) {
  const [active, setActive] = useState(tabs[0]?.id ?? '')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]

  function move(offset: number) {
    const index = tabs.findIndex((tab) => tab.id === current?.id)
    const next = tabs[(index + offset + tabs.length) % tabs.length]
    if (next) {
      setActive(next.id)
      tabRefs.current[next.id]?.focus()
    }
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}>
        {tabs.map((tab) => {
          const selected = tab.id === current?.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                tabRefs.current[tab.id] = node
              }}
              className={selected ? `${styles.tab} ${styles.selected}` : styles.tab}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {current ? (
        <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} className={styles.panel} tabIndex={0}>
          {current.content}
        </div>
      ) : null}
    </div>
  )
}
