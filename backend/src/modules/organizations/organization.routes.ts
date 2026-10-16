import { Router } from 'express'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth } from '../../middleware/requireSession.js'
import {
  acceptInvitation,
  createInvitation,
  createOrganization,
  getOrganization,
  listInvitations,
  listMembers,
  listOrganizations,
  removeMember,
  revokeInvitation,
  updateMember,
  updateOrganization,
} from './organization.service.js'
import { isMemberRole } from './permissions.js'
import {
  acceptInvitationSchema,
  invitationSchema,
  memberPatchSchema,
  organizationPatchSchema,
  organizationSchema,
  parseInput,
} from '../auth/validation.js'

function resourceId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  }
  const id = Number(raw)
  if (!Number.isSafeInteger(id)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  }
  return id
}

export function createOrganizationsRouter(): Router {
  const router = Router()

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(organizationSchema, req.body)
      const organization = await createOrganization(auth.id, input)
      res.status(201).json({ success: true, data: { organization } })
    }),
  )

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const auth = getAuth(res)
      const organizations = await listOrganizations(auth.id)
      res.status(200).json({ success: true, data: { organizations } })
    }),
  )

  router.get(
    '/:organizationId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const organization = await getOrganization(auth.id, resourceId(req.params.organizationId))
      res.status(200).json({ success: true, data: { organization } })
    }),
  )

  router.patch(
    '/:organizationId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(organizationPatchSchema, req.body)
      const organization = await updateOrganization(auth.id, resourceId(req.params.organizationId), input)
      res.status(200).json({ success: true, data: { organization } })
    }),
  )

  router.get(
    '/:organizationId/members',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const members = await listMembers(auth.id, resourceId(req.params.organizationId))
      res.status(200).json({ success: true, data: { members } })
    }),
  )

  router.patch(
    '/:organizationId/members/:memberId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(memberPatchSchema, req.body)
      if (input.role && !isMemberRole(input.role)) {
        throw new AppError(400, 'INVALID_INPUT', 'El rol no es válido.')
      }
      const member = await updateMember(auth.id, resourceId(req.params.organizationId), resourceId(req.params.memberId), input)
      res.status(200).json({ success: true, data: { member } })
    }),
  )

  router.delete(
    '/:organizationId/members/:memberId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      await removeMember(auth.id, resourceId(req.params.organizationId), resourceId(req.params.memberId))
      res.status(200).json({ success: true, data: { removed: true } })
    }),
  )

  router.get(
    '/:organizationId/invitations',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const invitations = await listInvitations(auth.id, resourceId(req.params.organizationId))
      res.status(200).json({ success: true, data: { invitations } })
    }),
  )

  router.post(
    '/:organizationId/invitations',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(invitationSchema, req.body)
      const result = await createInvitation(auth.id, auth.email, resourceId(req.params.organizationId), input)
      res.status(201).json({
        success: true,
        data: {
          invitation: result.invitation,
          token: result.token,
          delivery: 'inviter_response',
        },
      })
    }),
  )

  router.post(
    '/:organizationId/invitations/:invitationId/revoke',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      await revokeInvitation(auth.id, resourceId(req.params.organizationId), resourceId(req.params.invitationId))
      res.status(200).json({ success: true, data: { revoked: true } })
    }),
  )

  return router
}

export function createInvitationsRouter(): Router {
  const router = Router()

  router.post(
    '/accept',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(acceptInvitationSchema, req.body)
      const organization = await acceptInvitation(auth.id, auth.email, input.token)
      res.status(200).json({ success: true, data: { organization } })
    }),
  )

  return router
}
