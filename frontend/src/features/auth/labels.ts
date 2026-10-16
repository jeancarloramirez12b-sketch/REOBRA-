export const roleLabels: Record<string, string> = {
  owner: 'Responsable principal',
  administrator: 'Administración',
  editor: 'Edición',
  technical_reviewer: 'Revisión técnica',
  viewer: 'Consulta',
}

export const organizationTypeLabels: Record<string, string> = {
  company: 'Empresa',
  public_entity: 'Entidad pública',
  educational: 'Institución educativa',
  nonprofit: 'Organización sin ánimo de lucro',
  other: 'Otra',
}

export const verificationLabels: Record<string, string> = {
  unverified: 'Sin verificación',
  pending: 'Verificación en revisión',
  verified: 'Verificada',
  rejected: 'Verificación rechazada',
}

export const membershipStatusLabels: Record<string, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
  invited: 'Invitada',
}
