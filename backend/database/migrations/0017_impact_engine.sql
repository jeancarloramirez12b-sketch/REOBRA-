-- Motor de impacto. No precarga factores numéricos ni resultados ambientales.
-- Las recepciones confirmadas siguen siendo la fuente de las transferencias completadas.
-- El gramo es una unidad de referencia del SI, no un factor de impacto.

INSERT INTO measurement_units (code, name, dimension)
SELECT 'g', 'Gramo', 'mass'
WHERE NOT EXISTS (SELECT 1 FROM measurement_units WHERE code = 'g');

ALTER TABLE deliveries
  ADD INDEX ix_deliveries_received (received_at, request_id);

CREATE TABLE impact_methodologies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  version_label VARCHAR(40) NOT NULL,
  statement_text VARCHAR(4000) NOT NULL,
  limitations_text VARCHAR(2000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_methodologies_code (public_code),
  UNIQUE KEY uq_impact_methodologies_version (organization_id, name, version_label),
  KEY ix_impact_methodologies_org (organization_id, status),
  CONSTRAINT fk_impact_methodologies_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_methodologies_author FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_methodologies_code CHECK (public_code REGEXP '^mth_[a-z0-9]{20}$'),
  CONSTRAINT ck_impact_methodologies_status CHECK (status IN ('draft', 'approved', 'retired')),
  CONSTRAINT ck_impact_methodologies_text CHECK (CHAR_LENGTH(TRIM(statement_text)) > 0 AND CHAR_LENGTH(TRIM(limitations_text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Metodología de una organización. Queda fija cuando un informe emitido la usa.';

CREATE TABLE impact_factors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  methodology_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  impact_kind VARCHAR(40) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  input_unit_code VARCHAR(16) NOT NULL,
  output_unit VARCHAR(40) NOT NULL,
  factor_value DECIMAL(18, 6) NOT NULL,
  source_name VARCHAR(200) NOT NULL,
  source_url VARCHAR(500) NULL,
  issuer_name VARCHAR(200) NOT NULL,
  factor_year SMALLINT UNSIGNED NOT NULL,
  region_name VARCHAR(120) NOT NULL,
  version_label VARCHAR(40) NOT NULL,
  conditions_text VARCHAR(2000) NOT NULL,
  uncertainty_text VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_factors_code (public_code),
  KEY ix_impact_factors_org (organization_id, status),
  CONSTRAINT fk_impact_factors_methodology FOREIGN KEY (methodology_id) REFERENCES impact_methodologies (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_factors_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_factors_category FOREIGN KEY (category_id) REFERENCES material_categories (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_factors_author FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_factors_code CHECK (public_code REGEXP '^fac_[a-z0-9]{20}$'),
  CONSTRAINT ck_impact_factors_status CHECK (status IN ('draft', 'reviewed', 'approved', 'retired')),
  CONSTRAINT ck_impact_factors_year CHECK (factor_year BETWEEN 1900 AND 2200),
  CONSTRAINT ck_impact_factors_text CHECK (
    CHAR_LENGTH(TRIM(source_name)) > 0
    AND CHAR_LENGTH(TRIM(issuer_name)) > 0
    AND CHAR_LENGTH(TRIM(conditions_text)) > 0
    AND CHAR_LENGTH(TRIM(output_unit)) > 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Factor aportado por una organización. No es un factor oficial precargado.';

CREATE TABLE impact_mass_parameters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  parameter_kind VARCHAR(32) NOT NULL,
  magnitude DECIMAL(18, 6) NOT NULL,
  source_note VARCHAR(500) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_impact_mass_parameters_material (material_id, id),
  CONSTRAINT fk_impact_mass_parameters_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_mass_parameters_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_mass_parameters_author FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_mass_parameters_kind CHECK (parameter_kind IN ('mass_per_unit', 'density', 'mass_per_area')),
  CONSTRAINT ck_impact_mass_parameters_value CHECK (magnitude > 0),
  CONSTRAINT ck_impact_mass_parameters_source CHECK (CHAR_LENGTH(TRIM(source_note)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Parámetro declarado para convertir a masa. No asciende solo de nivel de evidencia.';

CREATE TABLE impact_calculations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  factor_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scope_key VARCHAR(160) AS (
    CONCAT(organization_id, ':', IFNULL(project_id, 0), ':', factor_id, ':', period_start, ':', period_end)
  ) STORED,
  status VARCHAR(32) NOT NULL,
  result_value DECIMAL(18, 6) NULL,
  result_unit VARCHAR(40) NULL,
  reason_text VARCHAR(500) NULL,
  evidence_level VARCHAR(32) NOT NULL DEFAULT 'declared',
  operation_key VARCHAR(80) NOT NULL,
  calculated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_calculations_code (public_code),
  UNIQUE KEY uq_impact_calculations_scope (scope_key),
  UNIQUE KEY uq_impact_calculations_operation (operation_key),
  KEY ix_impact_calculations_org (organization_id, period_start, period_end),
  CONSTRAINT fk_impact_calculations_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_calculations_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_calculations_factor FOREIGN KEY (factor_id) REFERENCES impact_factors (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_calculations_author FOREIGN KEY (calculated_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_calculations_code CHECK (public_code REGEXP '^cal_[a-z0-9]{20}$'),
  CONSTRAINT ck_impact_calculations_status CHECK (status IN ('calculated', 'not_calculable')),
  CONSTRAINT ck_impact_calculations_evidence CHECK (evidence_level IN ('declared', 'documented', 'reviewed', 'technically_verified')),
  CONSTRAINT ck_impact_calculations_period CHECK (period_end >= period_start),
  CONSTRAINT ck_impact_calculations_result CHECK (
    (status = 'not_calculable' AND result_value IS NULL)
    OR (status = 'calculated' AND result_value IS NOT NULL AND result_unit IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estimación ambiental. No certifica el material ni la operación.';

CREATE TABLE impact_calculation_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  calculation_id BIGINT UNSIGNED NOT NULL,
  delivery_id BIGINT UNSIGNED NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_calculation_sources_delivery (calculation_id, delivery_id),
  CONSTRAINT fk_impact_calculation_sources_calculation FOREIGN KEY (calculation_id) REFERENCES impact_calculations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_calculation_sources_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_calculation_sources_quantity CHECK (received_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Recepción usada en una estimación. La identidad del hecho es el despacho.';

CREATE TABLE impact_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  methodology_id BIGINT UNSIGNED NULL,
  issued_by_user_id BIGINT UNSIGNED NOT NULL,
  operation_key VARCHAR(80) NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_reports_code (public_code),
  UNIQUE KEY uq_impact_reports_operation (operation_key),
  KEY ix_impact_reports_org (organization_id, issued_at),
  CONSTRAINT fk_impact_reports_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_reports_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_reports_methodology FOREIGN KEY (methodology_id) REFERENCES impact_methodologies (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_reports_author FOREIGN KEY (issued_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_reports_code CHECK (public_code REGEXP '^rpt_[a-z0-9]{20}$'),
  CONSTRAINT ck_impact_reports_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Informe emitido. Sus partidas conservan las cifras de ese momento.';

CREATE TABLE impact_report_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id BIGINT UNSIGNED NOT NULL,
  indicator_code VARCHAR(64) NOT NULL,
  label VARCHAR(200) NOT NULL,
  section_name VARCHAR(40) NOT NULL,
  value_text VARCHAR(500) NOT NULL,
  numeric_value DECIMAL(18, 6) NULL,
  unit_code VARCHAR(40) NULL,
  evidence_level VARCHAR(32) NOT NULL,
  limitations_text VARCHAR(2000) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_impact_report_items_report (report_id),
  CONSTRAINT fk_impact_report_items_report FOREIGN KEY (report_id) REFERENCES impact_reports (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_report_items_section CHECK (section_name IN ('operational', 'estimate', 'unavailable')),
  CONSTRAINT ck_impact_report_items_evidence CHECK (evidence_level IN ('declared', 'documented', 'reviewed', 'technically_verified')),
  CONSTRAINT ck_impact_report_items_text CHECK (CHAR_LENGTH(TRIM(value_text)) > 0 AND CHAR_LENGTH(TRIM(limitations_text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE impact_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  action_name VARCHAR(40) NOT NULL,
  report_id BIGINT UNSIGNED NULL,
  calculation_id BIGINT UNSIGNED NULL,
  delivery_id BIGINT UNSIGNED NULL,
  description VARCHAR(2000) NOT NULL,
  operation_key VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_impact_audit_events_operation (operation_key),
  KEY ix_impact_audit_events_report (report_id, id),
  CONSTRAINT fk_impact_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_audit_events_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_audit_events_report FOREIGN KEY (report_id) REFERENCES impact_reports (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_audit_events_calculation FOREIGN KEY (calculation_id) REFERENCES impact_calculations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_impact_audit_events_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_impact_audit_events_action CHECK (action_name IN ('report_issued', 'report_downloaded', 'calculation_recorded', 'receipt_corrected')),
  CONSTRAINT ck_impact_audit_events_subject CHECK (
    report_id IS NOT NULL OR calculation_id IS NOT NULL OR delivery_id IS NOT NULL
  ),
  CONSTRAINT ck_impact_audit_events_description CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
