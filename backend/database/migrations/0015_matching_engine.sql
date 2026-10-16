-- Motor de coincidencias de la Fase 8.
-- Amplía material_matches sin borrar coincidencias ni materiales.
-- Una puntuación guardada no reserva inventario ni certifica el material.

ALTER TABLE material_matches
  ADD COLUMN algorithm_version VARCHAR(32) NULL AFTER evaluation_method,
  ADD COLUMN classification VARCHAR(32) NULL AFTER algorithm_version,
  ADD COLUMN observed_score DECIMAL(5, 2) NULL AFTER classification,
  ADD COLUMN evaluable_ratio DECIMAL(5, 2) NULL AFTER observed_score,
  ADD COLUMN factors_json JSON NULL AFTER evaluable_ratio,
  ADD COLUMN narrative VARCHAR(2000) NULL AFTER factors_json,
  ADD COLUMN coverage_percent DECIMAL(6, 2) NULL AFTER narrative,
  ADD COLUMN required_quantity DECIMAL(14, 3) NULL AFTER coverage_percent,
  ADD COLUMN available_quantity DECIMAL(14, 3) NULL AFTER required_quantity,
  ADD COLUMN usable_quantity DECIMAL(14, 3) NULL AFTER available_quantity,
  ADD COLUMN deficit_quantity DECIMAL(14, 3) NULL AFTER usable_quantity,
  ADD COLUMN input_fingerprint CHAR(64) NULL AFTER deficit_quantity,
  ADD COLUMN stale TINYINT NOT NULL DEFAULT 0 AFTER input_fingerprint,
  ADD COLUMN calculated_by_user_id BIGINT UNSIGNED NULL AFTER stale,
  ADD KEY ix_material_matches_need (project_need_id, stale),
  ADD CONSTRAINT fk_material_matches_calculated_by FOREIGN KEY (calculated_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT ck_material_matches_classification CHECK (
    classification IS NULL OR classification IN ('high', 'medium', 'low', 'insufficient', 'incompatible')
  ),
  ADD CONSTRAINT ck_material_matches_observed_score CHECK (
    observed_score IS NULL OR (observed_score >= 0 AND observed_score <= 100)
  ),
  ADD CONSTRAINT ck_material_matches_evaluable_ratio CHECK (
    evaluable_ratio IS NULL OR (evaluable_ratio >= 0 AND evaluable_ratio <= 100)
  ),
  ADD CONSTRAINT ck_material_matches_coverage CHECK (
    coverage_percent IS NULL OR (coverage_percent >= 0 AND coverage_percent <= 100)
  ),
  ADD CONSTRAINT ck_material_matches_quantities CHECK (
    (required_quantity IS NULL OR required_quantity > 0)
    AND (available_quantity IS NULL OR available_quantity >= 0)
    AND (usable_quantity IS NULL OR usable_quantity >= 0)
    AND (deficit_quantity IS NULL OR deficit_quantity >= 0)
  ),
  ADD CONSTRAINT ck_material_matches_stale CHECK (stale IN (0, 1)),
  ADD CONSTRAINT ck_material_matches_narrative CHECK (narrative IS NULL OR CHAR_LENGTH(TRIM(narrative)) > 0);

CREATE TABLE matching_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_need_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  algorithm_version VARCHAR(32) NOT NULL,
  candidate_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_matching_runs_need (project_need_id, created_at),
  CONSTRAINT fk_matching_runs_need FOREIGN KEY (project_need_id) REFERENCES project_material_needs (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_matching_runs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_matching_runs_version CHECK (CHAR_LENGTH(TRIM(algorithm_version)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ejecución del motor. No es una reserva ni una entrega.';
