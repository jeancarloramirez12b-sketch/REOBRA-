export type AccountUser = {
  id: number
  fullName: string
  email: string
  phone: string | null
  accountStatus: string
}

export type MembershipSummary = {
  organizationId: number
  organizationName: string
  role: string
  membershipStatus: string
}

export type SessionPayload = {
  user: AccountUser
  memberships: MembershipSummary[]
}

export type OrganizationMembership = {
  id: number
  role: string
  membershipStatus: string
}

export type OrganizationRecord = {
  id: number
  name: string
  organizationType: string
  taxIdentifier: string | null
  contactEmail: string
  city: string
  department: string
  country: string
  verificationStatus: string
  membership: OrganizationMembership
}

export type MemberRecord = {
  id: number
  userId: number
  fullName: string
  email: string
  role: string
  membershipStatus: string
}

export type InvitationRecord = {
  id: number
  email: string
  role: string
  expiresAt: string
  createdAt: string
}
