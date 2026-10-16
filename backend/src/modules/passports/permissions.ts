import type { MemberRole } from '../organizations/permissions.js'
import { canWriteMaterials } from '../materials/permissions.js'

export function canPublishPassport(role: MemberRole): boolean {
  return canWriteMaterials(role)
}

export function canReviewEvidence(role: MemberRole): boolean {
  return role === 'owner' || role === 'administrator' || role === 'technical_reviewer'
}
