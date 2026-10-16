export const visibilityLabels: Record<string, string> = {
  private: 'Privado',
  public: 'Consulta pública',
}

export const evidenceLabels: Record<string, string> = {
  photograph: 'Fotografía',
  technical_sheet: 'Ficha técnica',
  inspection_report: 'Informe de inspección',
  origin_document: 'Documento de procedencia',
  quality_document: 'Documento de calidad',
  other: 'Otro documento',
}

export const reviewLabels: Record<string, string> = {
  received: 'Recibido, sin verificación',
  reviewed: 'Revisado, sin equivaler a certificación',
  not_accepted: 'No aceptado como evidencia',
}

export const eventLabels: Record<string, string> = {
  registered: 'Registro',
  details_updated: 'Actualización',
  assessment_recorded: 'Evaluación registrada',
  passport_issued: 'Emisión del pasaporte',
  passport_revised: 'Corrección del pasaporte',
  request_created: 'Solicitud',
  request_updated: 'Solicitud actualizada',
  delivery_recorded: 'Entrega',
  availability_changed: 'Cambio de estado',
  note: 'Nota',
  evidence_added: 'Evidencia agregada',
  evidence_removed: 'Evidencia retirada',
  visibility_changed: 'Cambio de visibilidad',
}

export const assessmentLabels: Record<string, string> = {
  visual: 'Observación visual',
  documentary: 'Revisión documental',
  laboratory: 'Resultado de laboratorio',
  professional_opinion: 'Opinión profesional',
  other: 'Otra evaluación',
}
