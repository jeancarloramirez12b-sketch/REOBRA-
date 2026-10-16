-- Pasaporte, historial de versiones, trazabilidad y evaluaciones técnicas.
-- Una evaluación registrada aquí no es una certificación profesional ni legal.

CREATE TABLE material_passports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  public_code CHAR(24) NOT NULL COMMENT 'Identificador opaco y estable. No contiene datos privados.',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  origin_description VARCHAR(2000) NOT NULL,
  specifications_json JSON NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_passports_material (material_id),
  UNIQUE KEY uq_material_passports_public_code (public_code),
  CONSTRAINT fk_material_passports_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_passports_public_code CHECK (public_code REGEXP '^rob_[a-z0-9]{20}$'),
  CONSTRAINT ck_material_passports_version CHECK (version >= 1),
  CONSTRAINT ck_material_passports_origin CHECK (CHAR_LENGTH(TRIM(origin_description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE material_passport_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  passport_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  origin_description VARCHAR(2000) NOT NULL,
  specifications_json JSON NULL,
  issued_at DATETIME(3) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_passport_revisions_version (passport_id, version),
  CONSTRAINT fk_material_passport_revisions_passport FOREIGN KEY (passport_id) REFERENCES material_passports (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_passport_revisions_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_passport_revisions_version CHECK (version >= 1),
  CONSTRAINT ck_material_passport_revisions_origin CHECK (CHAR_LENGTH(TRIM(origin_description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE material_trace_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  event_timestamp DATETIME(3) NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_material_trace_events_material_time (material_id, event_timestamp),
  CONSTRAINT fk_material_trace_events_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_trace_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_trace_events_type CHECK (event_type IN (
    'registered',
    'details_updated',
    'assessment_recorded',
    'passport_issued',
    'passport_revised',
    'request_created',
    'request_updated',
    'delivery_recorded',
    'availability_changed',
    'note'
  )),
  CONSTRAINT ck_material_trace_events_description CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE technical_assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  assessor_user_id BIGINT UNSIGNED NOT NULL,
  assessment_type VARCHAR(32) NOT NULL,
  result VARCHAR(40) NOT NULL,
  observations VARCHAR(2000) NOT NULL,
  evidence_reference VARCHAR(512) NULL,
  assessed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_technical_assessments_material (material_id, assessed_at),
  CONSTRAINT fk_technical_assessments_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_technical_assessments_assessor FOREIGN KEY (assessor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_technical_assessments_type CHECK (assessment_type IN ('visual', 'documentary', 'laboratory', 'professional_opinion', 'other')),
  CONSTRAINT ck_technical_assessments_result CHECK (result IN ('insufficient_information', 'not_suitable', 'conditionally_suitable', 'suitable_for_stated_use')),
  CONSTRAINT ck_technical_assessments_observations CHECK (CHAR_LENGTH(TRIM(observations)) > 0),
  CONSTRAINT ck_technical_assessments_evidence CHECK (
    evidence_reference IS NULL
    OR (CHAR_LENGTH(evidence_reference) BETWEEN 1 AND 512 AND evidence_reference NOT LIKE 'data:%')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Evaluación técnica registrada. No equivale a una certificación profesional o legal.';
