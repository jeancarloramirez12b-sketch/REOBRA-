-- Proyectos y las necesidades de material que cada uno puede declarar.

CREATE TABLE projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  project_type VARCHAR(32) NOT NULL,
  city VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  start_date DATE NULL,
  end_date DATE NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_projects_org_status (organization_id, status),
  CONSTRAINT fk_projects_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_projects_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_projects_type CHECK (project_type IN ('construction', 'industrial', 'infrastructure', 'other')),
  CONSTRAINT ck_projects_status CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  CONSTRAINT ck_projects_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_material_needs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  unit_id BIGINT UNSIGNED NOT NULL,
  description VARCHAR(500) NOT NULL,
  required_quantity DECIMAL(14, 3) NOT NULL,
  required_condition VARCHAR(32) NULL,
  needed_by DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_project_material_needs_project (project_id, status),
  CONSTRAINT fk_project_material_needs_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_material_needs_category FOREIGN KEY (category_id) REFERENCES material_categories (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_material_needs_unit FOREIGN KEY (unit_id) REFERENCES measurement_units (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_project_material_needs_quantity CHECK (required_quantity > 0),
  CONSTRAINT ck_project_material_needs_condition CHECK (
    required_condition IS NULL
    OR required_condition IN ('not_declared', 'good', 'fair', 'deteriorated', 'mixed')
  ),
  CONSTRAINT ck_project_material_needs_status CHECK (status IN ('open', 'partially_covered', 'covered', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
