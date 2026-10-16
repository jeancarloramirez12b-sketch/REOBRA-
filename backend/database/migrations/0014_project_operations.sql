-- Operación de proyectos y necesidades. No borra materiales ni proyectos existentes.
-- Un proyecto archivado conserva sus necesidades. No hay reservas ni entregas.

ALTER TABLE projects
  ADD COLUMN public_code VARCHAR(24) NULL AFTER id,
  ADD COLUMN responsible_user_id BIGINT UNSIGNED NULL AFTER created_by_user_id,
  ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' AFTER department,
  ADD COLUMN address VARCHAR(240) NULL AFTER visibility,
  ADD UNIQUE KEY uq_projects_public_code (public_code),
  ADD CONSTRAINT fk_projects_responsible FOREIGN KEY (responsible_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT ck_projects_public_code CHECK (public_code IS NULL OR public_code REGEXP '^prj_[a-z0-9]{20}$'),
  ADD CONSTRAINT ck_projects_visibility CHECK (visibility IN ('private', 'public')),
  ADD CONSTRAINT ck_projects_address CHECK (address IS NULL OR CHAR_LENGTH(TRIM(address)) > 0);

ALTER TABLE projects DROP CHECK ck_projects_status;

ALTER TABLE projects
  ADD CONSTRAINT ck_projects_status CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled', 'archived'));

UPDATE projects
SET public_code = CONCAT('prj_', LOWER(SUBSTRING(SHA2(CONCAT('reobra-project-v1:', id), 256), 1, 20)))
WHERE public_code IS NULL;

ALTER TABLE project_material_needs
  ADD COLUMN public_code VARCHAR(24) NULL AFTER id,
  ADD COLUMN title VARCHAR(180) NULL AFTER unit_id,
  ADD COLUMN specifications_json JSON NULL AFTER description,
  ADD COLUMN observations VARCHAR(2000) NULL AFTER specifications_json,
  ADD COLUMN city VARCHAR(120) NULL AFTER observations,
  ADD COLUMN department VARCHAR(120) NULL AFTER city,
  ADD COLUMN location_description VARCHAR(500) NULL AFTER department,
  ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'medium' AFTER needed_by,
  ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' AFTER status,
  ADD UNIQUE KEY uq_project_material_needs_public_code (public_code),
  ADD CONSTRAINT ck_project_material_needs_public_code CHECK (public_code IS NULL OR public_code REGEXP '^nd_[a-z0-9]{20}$'),
  ADD CONSTRAINT ck_project_material_needs_title CHECK (title IS NULL OR CHAR_LENGTH(TRIM(title)) > 0),
  ADD CONSTRAINT ck_project_material_needs_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  ADD CONSTRAINT ck_project_material_needs_visibility CHECK (visibility IN ('private', 'public'));

ALTER TABLE project_material_needs DROP CHECK ck_project_material_needs_status;

ALTER TABLE project_material_needs
  ADD CONSTRAINT ck_project_material_needs_status CHECK (
    status IN ('draft', 'open', 'paused', 'partially_covered', 'covered', 'satisfied', 'cancelled')
  );

UPDATE project_material_needs
SET title = LEFT(description, 180)
WHERE title IS NULL;

UPDATE project_material_needs
SET public_code = CONCAT('nd_', LOWER(SUBSTRING(SHA2(CONCAT('reobra-project-need-v1:', id), 256), 1, 20)))
WHERE public_code IS NULL;

CREATE TABLE project_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  need_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  organization_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(32) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  operation_key VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_events_operation (operation_key),
  KEY ix_project_events_project (project_id, created_at, id),
  CONSTRAINT fk_project_events_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_events_need FOREIGN KEY (need_id) REFERENCES project_material_needs (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_project_events_type CHECK (event_type IN (
    'project_created',
    'project_updated',
    'project_status_changed',
    'need_created',
    'need_updated',
    'need_closed',
    'need_cancelled',
    'visibility_changed'
  )),
  CONSTRAINT ck_project_events_description CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
