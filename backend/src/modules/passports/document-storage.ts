import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadStream } from 'node:fs'
import { AppError } from '../../errors/AppError.js'
import { detectImage } from '../materials/storage.js'

export const maxDocuments = 8
export const maxDocumentBytes = 8 * 1024 * 1024

const storageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storage')
const keyPattern = /^documents\/[1-9]\d*\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/

export type DocumentKind = 'pdf' | 'jpg' | 'png' | 'webp'

const contentTypes: Record<DocumentKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export function detectDocument(buffer: Buffer): DocumentKind | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'pdf'
  }
  return detectImage(buffer)
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function safeOriginalName(value: string): string {
  const base = value.split(/[/\\]/).pop() ?? 'documento'
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 120)
  return cleaned.length > 0 ? cleaned : 'documento'
}

export function resolveDocumentFile(storageKey: string): string {
  if (!keyPattern.test(storageKey) || storageKey.includes('..') || storageKey.includes('\\')) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  const absolute = path.resolve(storageRoot, storageKey)
  const relative = path.relative(storageRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  return absolute
}

export async function writeDocumentFile(materialId: number, buffer: Buffer): Promise<{ storageKey: string; kind: DocumentKind }> {
  if (buffer.length === 0 || buffer.length > maxDocumentBytes) {
    throw new AppError(400, 'INVALID_INPUT', 'El documento debe pesar entre 1 byte y 8 MB.')
  }
  const kind = detectDocument(buffer)
  if (!kind) {
    throw new AppError(400, 'INVALID_INPUT', 'El documento debe ser PDF, JPEG, PNG o WebP.')
  }
  if (!Number.isSafeInteger(materialId) || materialId < 1) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  const storageKey = `documents/${materialId}/${randomUUID()}.${kind}`
  const absolute = resolveDocumentFile(storageKey)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, buffer, { flag: 'wx' })
  return { storageKey, kind }
}

export async function removeDocumentFile(storageKey: string): Promise<void> {
  try {
    await rm(resolveDocumentFile(storageKey), { force: true })
  } catch {
    // Una clave inválida no apunta a un archivo del almacén.
  }
}

export async function openDocumentFile(storageKey: string): Promise<{ stream: ReadStream; contentType: string }> {
  const absolute = resolveDocumentFile(storageKey)
  try {
    const info = await stat(absolute)
    if (!info.isFile()) {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  const extension = storageKey.slice(storageKey.lastIndexOf('.') + 1)
  if (extension !== 'pdf' && extension !== 'jpg' && extension !== 'png' && extension !== 'webp') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  return { stream: createReadStream(absolute), contentType: contentTypes[extension] }
}
