-- Identidad pública, visibilidad y evidencias del pasaporte.
-- No borra materiales. Los pasaportes que faltan se crean una sola vez.
-- Un documento recibido no queda verificado ni certificado.

ALTER TABLE material_passports
  ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' AFTER origin_description,
  ADD CONSTRAINT ck_material_passports_visibility CHECK (visibility IN ('private', 'public'));

ALTER TABLE material_trace_events
  ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER actor_user_id,
  ADD COLUMN operation_key VARCHAR(80) NULL AFTER metadata_json,
  ADD KEY ix_material_trace_events_organization (organization_id),
  ADD UNIQUE KEY uq_material_trace_events_operation (operation_key),
  ADD CONSTRAINT fk_material_trace_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE material_trace_events DROP CHECK ck_material_trace_events_type;

ALTER TABLE material_trace_events
  ADD CONSTRAINT ck_material_trace_events_type CHECK (event_type IN (
    'registered',
    'details_updated',
    'assessment_recorded',
    'passport_issued',
    'passport_revised',
    'request_created',
    'request_updated',
    'delivery_recorded',
    'availability_changed',
    'note',
    'evidence_added',
    'evidence_removed',
    'visibility_changed'
  ));

CREATE TABLE material_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  evidence_kind VARCHAR(32) NOT NULL,
  review_status VARCHAR(32) NOT NULL DEFAULT 'received',
  disclosure VARCHAR(16) NOT NULL DEFAULT 'internal',
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(120) NOT NULL,
  content_type VARCHAR(80) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_material_documents_material (material_id, created_at),
  CONSTRAINT fk_material_documents_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_documents_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_documents_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_documents_kind CHECK (evidence_kind IN (
    'photograph',
    'technical_sheet',
    'inspection_report',
    'origin_document',
    'quality_document',
    'other'
  )),
  CONSTRAINT ck_material_documents_review CHECK (review_status IN ('received', 'reviewed', 'not_accepted')),
  CONSTRAINT ck_material_documents_disclosure CHECK (disclosure IN ('internal', 'public')),
  CONSTRAINT ck_material_documents_storage CHECK (
    CHAR_LENGTH(storage_key) BETWEEN 1 AND 512
    AND storage_key NOT LIKE 'data:%'
    AND storage_key NOT LIKE '%..%'
  ),
  CONSTRAINT ck_material_documents_name CHECK (CHAR_LENGTH(TRIM(original_name)) > 0),
  CONSTRAINT ck_material_documents_sha CHECK (sha256 REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT ck_material_documents_size CHECK (byte_size > 0 AND byte_size <= 8388608)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Evidencia presentada. El estado recibido no equivale a una verificación ni a una certificación.';

INSERT INTO material_passports (material_id, public_code, origin_description, visibility)
SELECT
  m.id,
  CONCAT('rob_', LOWER(SUBSTRING(SHA2(CONCAT('reobra-material-passport-v1:', m.id), 256), 1, 20))),
  LEFT(CONCAT(
    'Dato declarado por la organización. Procedencia: ',
    m.origin_type,
    '. Lugar general: ',
    m.city,
    ', ',
    m.department,
    '.'
  ), 2000),
  'private'
FROM materials AS m
LEFT JOIN material_passports AS passport ON passport.material_id = m.id
WHERE passport.id IS NULL;

INSERT INTO material_trace_events (
  material_id,
  actor_user_id,
  organization_id,
  event_type,
  description,
  event_timestamp,
  metadata_json,
  operation_key
)
SELECT
  m.id,
  m.created_by_user_id,
  m.organization_id,
  'registered',
  'Se registró el material en el inventario.',
  m.created_at,
  JSON_OBJECT('source', 'backfill'),
  CONCAT('backfill-registered-', m.id)
FROM materials AS m
WHERE NOT EXISTS (
  SELECT 1
  FROM material_trace_events AS event
  WHERE event.material_id = m.id AND event.event_type = 'registered'
);

INSERT INTO material_trace_events (
  material_id,
  actor_user_id,
  organization_id,
  event_type,
  description,
  event_timestamp,
  metadata_json,
  operation_key
)
SELECT
  m.id,
  m.created_by_user_id,
  m.organization_id,
  'passport_issued',
  'Se asignó la identidad pública del pasaporte digital.',
  p.issued_at,
  JSON_OBJECT('source', 'backfill', 'publicCode', p.public_code),
  CONCAT('backfill-passport-', m.id)
FROM materials AS m
INNER JOIN material_passports AS p ON p.material_id = m.id
WHERE NOT EXISTS (
  SELECT 1
  FROM material_trace_events AS event
  WHERE event.material_id = m.id AND event.event_type = 'passport_issued'
);
