const projectTypes = new Set(['construction', 'industrial', 'infrastructure', 'other'])
const priorities = new Set(['low', 'medium', 'high', 'urgent'])

export type ProjectDraft = {
  title: string
  description: string
  projectType: string
  organizationId: string
  city: string
  department: string
  address: string
  startDate: string
  endDate: string
  visibility: string
  responsibleUserId: string
  status: string
}

export type NeedDraft = {
  title: string
  description: string
  categoryId: string
  unitId: string
  requiredQuantity: string
  requiredCondition: string
  priority: string
  neededBy: string
  city: string
  department: string
  locationDescription: string
  observations: string
  specificationName: string
  specificationValue: string
  visibility: string
  status: string
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>

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

export function validateProjectDraft(draft: ProjectDraft): FieldErrors<ProjectDraft> {
  const errors: FieldErrors<ProjectDraft> = {}
  const title = draft.title.trim()
  if (title.length === 0) {
    errors.title = 'El nombre es obligatorio.'
  } else if (title.length > 180) {
    errors.title = 'El nombre no puede superar 180 caracteres.'
  }
  if (draft.description.trim().length > 4000) {
    errors.description = 'La descripción no puede superar 4000 caracteres.'
  }
  if (!projectTypes.has(draft.projectType)) {
    errors.projectType = 'El tipo de proyecto no es válido.'
  }
  if (draft.organizationId.trim().length === 0) {
    errors.organizationId = 'Elige una organización.'
  }
  if (draft.city.trim().length === 0) {
    errors.city = 'El municipio es obligatorio.'
  }
  if (draft.department.trim().length === 0) {
    errors.department = 'El departamento es obligatorio.'
  }
  if (draft.address.trim().length > 240) {
    errors.address = 'La dirección no puede superar 240 caracteres.'
  }
  if (draft.startDate && !realDate(draft.startDate)) {
    errors.startDate = 'La fecha de inicio no es válida.'
  }
  if (draft.endDate && !realDate(draft.endDate)) {
    errors.endDate = 'La fecha de finalización no es válida.'
  }
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'La finalización no puede ser anterior al inicio.'
  }
  if (draft.visibility === 'public' && draft.status !== 'active') {
    errors.visibility = 'Solo un proyecto activo puede quedar en consulta pública.'
  }
  return errors
}

export function validateNeedDraft(draft: NeedDraft): FieldErrors<NeedDraft> {
  const errors: FieldErrors<NeedDraft> = {}
  if (draft.title.trim().length === 0) {
    errors.title = 'El material solicitado es obligatorio.'
  }
  if (draft.description.trim().length === 0) {
    errors.description = 'La descripción es obligatoria.'
  } else if (draft.description.trim().length > 500) {
    errors.description = 'La descripción no puede superar 500 caracteres.'
  }
  if (draft.categoryId.trim().length === 0) {
    errors.categoryId = 'Elige una categoría.'
  }
  if (draft.unitId.trim().length === 0) {
    errors.unitId = 'Elige una unidad.'
  }
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(draft.requiredQuantity.trim()) || Number(draft.requiredQuantity) <= 0) {
    errors.requiredQuantity = 'La cantidad debe ser mayor que cero, con hasta 3 decimales.'
  }
  if (!priorities.has(draft.priority)) {
    errors.priority = 'La prioridad no es válida.'
  }
  if (draft.neededBy && !realDate(draft.neededBy)) {
    errors.neededBy = 'La fecha requerida no es válida.'
  }
  const name = draft.specificationName.trim()
  const value = draft.specificationValue.trim()
  if ((name.length > 0 && value.length === 0) || (value.length > 0 && name.length === 0)) {
    errors.specificationValue = 'Cada requisito necesita nombre y valor.'
  }
  return errors
}
