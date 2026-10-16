export const memberRoles = ['owner', 'administrator', 'editor', 'technical_reviewer', 'viewer'] as const
export const inviteRoles = ['administrator', 'editor', 'technical_reviewer', 'viewer'] as const

export type MemberRole = (typeof memberRoles)[number]
export type InviteRole = (typeof inviteRoles)[number]

const delegatedRoles = new Set<MemberRole>(['editor', 'technical_reviewer', 'viewer'])

export function isMemberRole(value: string): value is MemberRole {
  return (memberRoles as readonly string[]).includes(value)
}

export function canManageOrganization(role: MemberRole): boolean {
  return role === 'owner' || role === 'administrator'
}

export function canInvite(actor: MemberRole, role: InviteRole): boolean {
  if (actor === 'owner') {
    return true
  }
  if (actor === 'administrator') {
    return role !== 'administrator'
  }
  return false
}

export function canChangeMember(actor: MemberRole, current: MemberRole, next: MemberRole): boolean {
  if (actor === 'owner') {
    return true
  }
  if (actor !== 'administrator') {
    return false
  }
  return delegatedRoles.has(current) && delegatedRoles.has(next)
}
