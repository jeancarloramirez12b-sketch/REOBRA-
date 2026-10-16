const writerRoles = new Set(['owner', 'administrator', 'editor'])
const conditions = new Set(['not_declared', 'good', 'fair', 'deteriorated', 'mixed'])
const origins = new Set(['construction', 'industrial', 'demolition', 'other'])
const statuses = new Set(['draft', 'published', 'paused', 'withdrawn'])

export type MaterialDraft = {
  title: string
  description: string
  categoryId: string
  organizationId: string
  quantity: string
  unitId: string
  materialCondition: string
  originType: string
  city: string
  department: string
  locationDescription: string
  availabilityStatus: string
  availableFrom: string
}

export type FieldErrors = Partial<Record<keyof MaterialDraft, string>>

export function materialCode(id: number): string {
  return `MAT-${String(id).padStart(6, '0')}`
}

export function canWriteMaterials(role: string): boolean {
  return writerRoles.has(role)
}

export function formatQuantity(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return value
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  const shown = trimmed.length > 0 ? `${whole}.${trimmed}` : whole
  return negative ? `-${shown}` : (shown ?? value)
}

export function inventoryEmptyKind(input: {
  hasMembership: boolean
  total: number
  filtering: boolean
}): 'no-organization' | 'no-materials' | 'no-results' | 'list' {
  if (!input.hasMembership) {
    return 'no-organization'
  }
  if (input.total === 0 && input.filtering) {
    return 'no-results'
  }
  if (input.total === 0) {
    return 'no-materials'
  }
  return 'list'
}

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function validateMaterialDraft(draft: MaterialDraft): FieldErrors {
  const errors: FieldErrors = {}
  const title = draft.title.trim()
  if (title.length === 0) {
    errors.title = 'El nombre es obligatorio.'
  } else if (title.length > 180) {
    errors.title = 'El nombre no puede superar 180 caracteres.'
  }
  if (draft.description.length > 4000) {
    errors.description = 'La descripción no puede superar 4000 caracteres.'
  }
  if (!/^[1-9]\d*$/.test(draft.categoryId)) {
    errors.categoryId = 'Selecciona una categoría.'
  }
  if (!/^[1-9]\d*$/.test(draft.organizationId)) {
    errors.organizationId = 'Selecciona una organización.'
  }
  const quantity = draft.quantity.trim()
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) {
    errors.quantity = 'La cantidad debe ser mayor que cero.'
  }
  if (!/^[1-9]\d*$/.test(draft.unitId)) {
    errors.unitId = 'Selecciona una unidad.'
  }
  if (!conditions.has(draft.materialCondition)) {
    errors.materialCondition = 'La condición declarada no es válida.'
  }
  if (!origins.has(draft.originType)) {
    errors.originType = 'La procedencia no es válida.'
  }
  const city = draft.city.trim()
  if (city.length === 0 || city.length > 120) {
    errors.city = 'Indica el municipio o la ciudad.'
  }
  const department = draft.department.trim()
  if (department.length === 0 || department.length > 120) {
    errors.department = 'Indica el departamento.'
  }
  if (draft.locationDescription.length > 500) {
    errors.locationDescription = 'La ubicación general no puede superar 500 caracteres.'
  }
  if (!statuses.has(draft.availabilityStatus)) {
    errors.availabilityStatus = 'El estado del registro no es válido.'
  }
  if (draft.availableFrom.trim().length > 0 && !realDate(draft.availableFrom.trim())) {
    errors.availableFrom = 'La fecha de disponibilidad no es válida.'
  }
  return errors
}
