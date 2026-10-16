DROP TABLE matching_runs;

ALTER TABLE material_matches
  ADD INDEX ix_material_matches_need_fk (project_need_id),
  DROP INDEX ix_material_matches_need;

ALTER TABLE material_matches
  DROP FOREIGN KEY fk_material_matches_calculated_by,
  DROP CHECK ck_material_matches_classification,
  DROP CHECK ck_material_matches_observed_score,
  DROP CHECK ck_material_matches_evaluable_ratio,
  DROP CHECK ck_material_matches_coverage,
  DROP CHECK ck_material_matches_quantities,
  DROP CHECK ck_material_matches_stale,
  DROP CHECK ck_material_matches_narrative,
  DROP COLUMN calculated_by_user_id,
  DROP COLUMN stale,
  DROP COLUMN input_fingerprint,
  DROP COLUMN deficit_quantity,
  DROP COLUMN usable_quantity,
  DROP COLUMN available_quantity,
  DROP COLUMN required_quantity,
  DROP COLUMN coverage_percent,
  DROP COLUMN narrative,
  DROP COLUMN factors_json,
  DROP COLUMN evaluable_ratio,
  DROP COLUMN observed_score,
  DROP COLUMN classification,
  DROP COLUMN algorithm_version;

ALTER TABLE material_matches DROP FOREIGN KEY fk_material_matches_need;

ALTER TABLE material_matches DROP INDEX ix_material_matches_need_fk;

ALTER TABLE material_matches
  ADD CONSTRAINT fk_material_matches_need FOREIGN KEY (project_need_id) REFERENCES project_material_needs (id) ON UPDATE RESTRICT ON DELETE RESTRICT;
