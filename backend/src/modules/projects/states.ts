export const projectStatuses = ['draft', 'active', 'paused', 'completed', 'cancelled', 'archived'] as const
export const needStatuses = ['draft', 'open', 'paused', 'partially_covered', 'covered', 'satisfied', 'cancelled'] as const
export const projectTypes = ['construction', 'industrial', 'infrastructure', 'other'] as const
export const priorities = ['low', 'medium', 'high', 'urgent'] as const
export const visibilities = ['private', 'public'] as const

export type ProjectStatus = (typeof projectStatuses)[number]
export type NeedStatus = (typeof needStatuses)[number]

const projectTransitions: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'completed', 'archived'],
  completed: ['archived'],
  cancelled: ['draft'],
  archived: ['draft'],
}

const needTransitions: Record<NeedStatus, NeedStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['paused', 'satisfied', 'cancelled'],
  paused: ['open', 'satisfied', 'cancelled'],
  partially_covered: ['open', 'paused', 'satisfied', 'cancelled'],
  covered: [],
  satisfied: [],
  cancelled: [],
}

const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: 'borrador',
  active: 'activo',
  paused: 'pausado',
  completed: 'finalizado',
  cancelled: 'cancelado',
  archived: 'archivado',
}

const needStatusLabels: Record<NeedStatus, string> = {
  draft: 'borrador',
  open: 'abierta',
  paused: 'pausada',
  partially_covered: 'parcialmente cubierta',
  covered: 'cubierta',
  satisfied: 'satisfecha',
  cancelled: 'cancelada',
}

export function projectStatusLabel(status: ProjectStatus): string {
  return projectStatusLabels[status]
}

export function needStatusLabel(status: NeedStatus): string {
  return needStatusLabels[status]
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return (projectStatuses as readonly string[]).includes(value)
}

export function isNeedStatus(value: string): value is NeedStatus {
  return (needStatuses as readonly string[]).includes(value)
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return projectTransitions[from].includes(to)
}

export function canTransitionNeed(from: NeedStatus, to: NeedStatus): boolean {
  return needTransitions[from].includes(to)
}

export function isProjectEditable(status: ProjectStatus): boolean {
  return status === 'draft' || status === 'active' || status === 'paused'
}

export function isNeedContentEditable(status: NeedStatus): boolean {
  return status === 'draft' || status === 'open' || status === 'paused' || status === 'partially_covered'
}

export function isOpenNeed(status: NeedStatus): boolean {
  return status === 'open' || status === 'partially_covered'
}

export function datesAreOrdered(start: string | null, end: string | null): boolean {
  if (!start || !end) {
    return true
  }
  return end >= start
}

export function needDateFitsProject(neededBy: string | null, start: string | null, end: string | null): boolean {
  if (!neededBy) {
    return true
  }
  if (start && neededBy < start) {
    return false
  }
  if (end && neededBy > end) {
    return false
  }
  return true
}
