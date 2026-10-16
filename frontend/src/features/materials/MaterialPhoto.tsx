import { useEffect, useState } from 'react'
import { apiBlob } from '../auth/api.ts'
import styles from './materials.module.css'

type MaterialPhotoProps = {
  materialId: number
  imageId: number
  alt: string
  compact?: boolean
}

export function MaterialPhoto({ materialId, imageId, alt, compact = false }: MaterialPhotoProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setFailed(false)
    setUrl(null)
    void apiBlob(`/api/materials/${materialId}/images/${imageId}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) {
          setUrl(objectUrl)
        } else {
          URL.revokeObjectURL(objectUrl)
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true)
        }
      })
    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [materialId, imageId])

  const fallbackClass = compact ? styles.thumbFallback : styles.photoFallback
  const imageClass = compact ? styles.thumb : styles.photo
  if (!url || failed) {
    return <span className={fallbackClass}>{failed ? 'Sin vista previa' : 'Cargando imagen'}</span>
  }
  return <img className={imageClass} src={url} alt={alt} />
}
