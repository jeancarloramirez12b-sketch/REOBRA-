-- Identidad de personas y organizaciones. Las contraseñas solo se guardan como hash.

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT 'Solo hash. Nunca la contraseña en texto plano.',
  phone VARCHAR(32) NULL,
  account_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT ck_users_full_name CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT ck_users_email_shape CHECK (email REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CONSTRAINT ck_users_password_hash CHECK (CHAR_LENGTH(password_hash) >= 20),
  CONSTRAINT ck_users_phone CHECK (phone IS NULL OR CHAR_LENGTH(TRIM(phone)) BETWEEN 7 AND 32),
  CONSTRAINT ck_users_account_status CHECK (account_status IN ('active', 'suspended', 'deactivated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organizations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(180) NOT NULL,
  organization_type VARCHAR(32) NOT NULL,
  tax_identifier VARCHAR(32) NULL,
  contact_email VARCHAR(254) NOT NULL,
  city VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'CO',
  verification_status VARCHAR(32) NOT NULL DEFAULT 'unverified',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_organizations_tax_identifier (tax_identifier),
  CONSTRAINT ck_organizations_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT ck_organizations_type CHECK (organization_type IN ('company', 'public_entity', 'educational', 'nonprofit', 'other')),
  CONSTRAINT ck_organizations_tax_identifier CHECK (tax_identifier IS NULL OR CHAR_LENGTH(TRIM(tax_identifier)) BETWEEN 1 AND 32),
  CONSTRAINT ck_organizations_email CHECK (contact_email REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CONSTRAINT ck_organizations_country CHECK (country REGEXP '^[A-Z]{2}$'),
  CONSTRAINT ck_organizations_verification_status CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organization_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(32) NOT NULL,
  membership_status VARCHAR(32) NOT NULL DEFAULT 'invited',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_organization_members_pair (organization_id, user_id),
  KEY ix_organization_members_user (user_id),
  CONSTRAINT fk_organization_members_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_organization_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_organization_members_role CHECK (role IN ('owner', 'administrator', 'editor', 'technical_reviewer', 'viewer')),
  CONSTRAINT ck_organization_members_status CHECK (membership_status IN ('invited', 'active', 'suspended'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
