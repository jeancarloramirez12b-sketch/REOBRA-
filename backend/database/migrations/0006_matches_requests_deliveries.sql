-- Coincidencias, solicitudes y entregas.
-- Una coincidencia no aprueba el uso técnico del material.
-- Las solicitudes y las entregas usan la unidad del material, sin una unidad propia.

CREATE TABLE material_matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  project_need_id BIGINT UNSIGNED NOT NULL,
  compatibility_score DECIMAL(5, 2) NULL,
  compatibility_status VARCHAR(32) NOT NULL DEFAULT 'not_evaluated',
  evaluation_method VARCHAR(32) NOT NULL,
  explanation VARCHAR(1000) NULL,
  evaluated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_matches_pair (material_id, project_need_id),
  CONSTRAINT fk_material_matches_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_matches_need FOREIGN KEY (project_need_id) REFERENCES project_material_needs (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_matches_status CHECK (compatibility_status IN ('not_evaluated', 'pending', 'incompatible', 'partially_compatible', 'compatible')),
  CONSTRAINT ck_material_matches_method CHECK (evaluation_method IN ('manual', 'rule_based', 'model_assisted')),
  CONSTRAINT ck_material_matches_score CHECK (compatibility_score IS NULL OR (compatibility_score >= 0 AND compatibility_score <= 100)),
  CONSTRAINT ck_material_matches_pending_score CHECK (
    compatibility_status NOT IN ('not_evaluated', 'pending')
    OR compatibility_score IS NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Coincidencia preliminar. No constituye aprobación técnica ni autorización de uso.';

CREATE TABLE material_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  requesting_organization_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  requested_quantity DECIMAL(14, 3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_material_requests_material_status (material_id, status),
  CONSTRAINT fk_material_requests_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_requests_organization FOREIGN KEY (requesting_organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_material_requests_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_requests_quantity CHECK (requested_quantity > 0),
  CONSTRAINT ck_material_requests_status CHECK (status IN ('draft', 'submitted', 'accepted', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  scheduled_date DATE NULL,
  delivered_at DATETIME(3) NULL,
  delivered_quantity DECIMAL(14, 3) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  delivery_notes VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_deliveries_request (request_id, status),
  CONSTRAINT fk_deliveries_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_deliveries_status CHECK (status IN ('scheduled', 'in_transit', 'delivered', 'cancelled')),
  CONSTRAINT ck_deliveries_quantity_state CHECK (
    (
      status = 'delivered'
      AND delivered_quantity > 0
      AND delivered_at IS NOT NULL
    )
    OR (
      status <> 'delivered'
      AND (delivered_quantity IS NULL OR delivered_quantity > 0)
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
