-- Impacto medible y sus evidencias.
-- No hay indicadores precargados. Cada registro debe declarar método y estado de verificación.

CREATE TABLE impact_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  delivery_id BIGINT UNSIGNED NULL,
  impact_type VARCHAR(40) NOT NULL,
  measured_value DECIMAL(18, 6) NOT NULL,
  measurement_unit_id BIGINT UNSIGNED NOT NULL,
  calculation_method VARCHAR(64) NOT NULL,
  calculation_notes VARCHAR(500) NULL,
  verification_status VARCHAR(32) NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  scope_key VARCHAR(220) AS (
    CONCAT(impact_type, '#', calculation_method, '#', IFNULL(CAST(delivery_id AS CHAR), 'material'))
  ) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_records_scope (material_id, scope_key),
  KEY ix_impact_records_material (material_id),
  CONSTRAINT fk_impact_records_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_records_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_records_unit FOREIGN KEY (measurement_unit_id) REFERENCES measurement_units (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_records_type CHECK (impact_type IN ('mass_recovered', 'volume_recovered', 'emissions_avoided', 'other')),
  CONSTRAINT ck_impact_records_value CHECK (measured_value >= 0),
  CONSTRAINT ck_impact_records_method CHECK (CHAR_LENGTH(TRIM(calculation_method)) > 0),
  CONSTRAINT ck_impact_records_verification CHECK (verification_status IN ('estimated', 'verified', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE impact_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  impact_record_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(32) NOT NULL,
  storage_reference VARCHAR(512) NOT NULL COMMENT 'Referencia de almacenamiento. No es el archivo binario.',
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_impact_evidence_record FOREIGN KEY (impact_record_id) REFERENCES impact_records (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_evidence_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_evidence_type CHECK (evidence_type IN ('document', 'photograph', 'dataset', 'other')),
  CONSTRAINT ck_impact_evidence_storage CHECK (
    CHAR_LENGTH(storage_reference) BETWEEN 1 AND 512
    AND storage_reference NOT LIKE 'data:%'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
