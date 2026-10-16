export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function samePlace(left: string | null, right: string | null): boolean | null {
  if (!left || !right || foldText(left).length === 0 || foldText(right).length === 0) {
    return null
  }
  return foldText(left) === foldText(right)
}

const conditionAliases: Record<string, string> = {
  good: 'good',
  buena: 'good',
  fair: 'fair',
  aceptable: 'fair',
  deteriorated: 'deteriorated',
  deteriorada: 'deteriorated',
  mixed: 'mixed',
  mixta: 'mixed',
  notdeclared: 'not_declared',
  'not declared': 'not_declared',
  nodeclarada: 'not_declared',
  'no declarada': 'not_declared',
}

export function canonicalCondition(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const folded = foldText(value).replace(/ /g, '')
  return conditionAliases[folded] ?? conditionAliases[foldText(value)] ?? null
}

export function isConditionAttribute(name: string): boolean {
  const folded = foldText(name)
  return folded === 'condicion' || folded === 'condition' || folded === 'estado fisico' || folded === 'estado'
}

const conditionRank: Record<string, number> = {
  deteriorated: 1,
  fair: 2,
  good: 3,
}

export function conditionRankOf(value: string | null): number | null {
  if (!value || value === 'not_declared' || value === 'mixed') {
    return null
  }
  return conditionRank[value] ?? null
}
