import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadStream } from 'node:fs'
import { AppError } from '../../errors/AppError.js'

export const maxMaterialImages = 6
export const maxImageBytes = 5 * 1024 * 1024

const storageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storage')
const keyPattern = /^materials\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png|webp)$/

export type ImageKind = 'jpg' | 'png' | 'webp'

const contentTypes: Record<ImageKind, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export function detectImage(buffer: Buffer): ImageKind | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg'
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

export function contentTypeForKey(storageKey: string): string {
  const kind = storageKey.slice(storageKey.lastIndexOf('.') + 1)
  if (kind === 'jpg' || kind === 'png' || kind === 'webp') {
    return contentTypes[kind]
  }
  throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
}

export function resolveStoredFile(storageKey: string): string {
  if (!keyPattern.test(storageKey) || storageKey.includes('..') || storageKey.includes('\\')) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  const absolute = path.resolve(storageRoot, storageKey)
  const relative = path.relative(storageRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  return absolute
}

export async function writeMaterialFile(materialId: number, buffer: Buffer): Promise<string> {
  if (buffer.length === 0 || buffer.length > maxImageBytes) {
    throw new AppError(400, 'INVALID_INPUT', 'La imagen debe pesar entre 1 byte y 5 MB.')
  }
  const kind = detectImage(buffer)
  if (!kind) {
    throw new AppError(400, 'INVALID_INPUT', 'La imagen debe ser JPEG, PNG o WebP.')
  }
  if (!Number.isSafeInteger(materialId) || materialId < 1) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }

  const storageKey = `materials/${materialId}/${randomUUID()}.${kind}`
  const absolute = resolveStoredFile(storageKey)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, buffer, { flag: 'wx' })
  return storageKey
}

export async function removeMaterialFile(storageKey: string): Promise<void> {
  let absolute: string
  try {
    absolute = resolveStoredFile(storageKey)
  } catch {
    return
  }
  await rm(absolute, { force: true })
}

export async function openMaterialFile(storageKey: string): Promise<{ stream: ReadStream; contentType: string }> {
  const absolute = resolveStoredFile(storageKey)
  try {
    const info = await stat(absolute)
    if (!info.isFile()) {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  return { stream: createReadStream(absolute), contentType: contentTypeForKey(storageKey) }
}
