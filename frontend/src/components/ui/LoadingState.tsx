import { useLocation } from 'react-router-dom'
import { sceneForPath, scenes } from '../visual/scenes.ts'
import sceneStyles from '../visual/scene.module.css'
import { Skeleton } from './Skeleton.tsx'
import styles from './LoadingState.module.css'

type LoadingStateProps = {
  label: string
}

export function LoadingState({ label }: LoadingStateProps) {
  const { pathname } = useLocation()
  const scene = scenes[sceneForPath(pathname)]

  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={`${sceneStyles.thumb} ${styles.photo}`}>
        <img src={scene.src} alt="" />
      </div>
      <p>{label}</p>
      <Skeleton width="72%" />
      <Skeleton width="48%" />
    </div>
  )
}
