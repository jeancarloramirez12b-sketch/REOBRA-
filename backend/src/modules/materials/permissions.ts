import type { MemberRole } from '../organizations/permissions.js'

const writerRoles = new Set<MemberRole>(['owner', 'administrator', 'editor'])

export function canWriteMaterials(role: MemberRole): boolean {
  return writerRoles.has(role)
}
