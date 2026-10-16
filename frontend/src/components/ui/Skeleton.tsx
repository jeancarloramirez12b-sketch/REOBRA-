import styles from './Skeleton.module.css'

type SkeletonProps = {
  width?: string
}

export function Skeleton({ width = '100%' }: SkeletonProps) {
  return <span className={styles.bar} style={{ width }} />
}
