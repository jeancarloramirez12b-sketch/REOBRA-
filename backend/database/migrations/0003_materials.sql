-- Catálogo de materiales. La disponibilidad comercial y la validación técnica son independientes.

CREATE TABLE material_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  parent_category_id BIGINT UNSIGNED NULL,
  parent_key BIGINT UNSIGNED AS (IFNULL(parent_category_id, 0)) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_categories_sibling_name (parent_key, name),
  CONSTRAINT fk_material_categories_parent FOREIGN KEY (parent_category_id) REFERENCES material_categories (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_categories_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE materials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  unit_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  material_condition VARCHAR(32) NOT NULL DEFAULT 'not_declared',
  quantity DECIMAL(14, 3) NOT NULL,
  origin_type VARCHAR(32) NOT NULL,
  city VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL,
  location_description VARCHAR(500) NULL,
  availability_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  technical_validation_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  available_from DATE NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_materials_org_availability (organization_id, availability_status),
  KEY ix_materials_location (department, city),
  KEY ix_materials_technical_status (technical_validation_status),
  KEY ix_materials_category (category_id),
  CONSTRAINT fk_materials_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_materials_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_materials_category FOREIGN KEY (category_id) REFERENCES material_categories (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_materials_unit FOREIGN KEY (unit_id) REFERENCES measurement_units (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_materials_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_materials_quantity_positive CHECK (quantity > 0),
  CONSTRAINT ck_materials_condition CHECK (material_condition IN ('not_declared', 'good', 'fair', 'deteriorated', 'mixed')),
  CONSTRAINT ck_materials_origin_type CHECK (origin_type IN ('construction', 'industrial', 'demolition', 'other')),
  CONSTRAINT ck_materials_availability_status CHECK (availability_status IN ('draft', 'published', 'paused', 'withdrawn')),
  CONSTRAINT ck_materials_technical_validation_status CHECK (technical_validation_status IN ('pending', 'in_review', 'insufficient_information', 'not_suitable', 'conditionally_suitable', 'suitable_for_stated_use'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE material_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(512) NOT NULL COMMENT 'Ruta o clave de almacenamiento. No es el archivo binario.',
  image_order INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_images_order (material_id, image_order),
  CONSTRAINT fk_material_images_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_material_images_storage_key CHECK (
    CHAR_LENGTH(storage_key) BETWEEN 1 AND 512
    AND storage_key NOT LIKE 'data:%'
  ),
  CONSTRAINT ck_material_images_order CHECK (image_order >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
