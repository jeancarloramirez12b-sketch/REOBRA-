import { useLocation } from 'react-router-dom'
import { sceneForPath, scenes } from './scenes.ts'
import styles from './scene.module.css'

export function SceneBanner() {
  const { pathname } = useLocation()
  const scene = scenes[sceneForPath(pathname)]

  return (
    <div className={styles.banner}>
      <img src={scene.src} alt={scene.alt} />
    </div>
  )
}
