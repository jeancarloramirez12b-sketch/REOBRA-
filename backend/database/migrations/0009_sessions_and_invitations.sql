-- Sesiones opacas, intentos de acceso e invitaciones de organización.
-- Las migraciones 0001 a 0008 no se modifican.

ALTER TABLE users
  ADD COLUMN terms_accepted_at DATETIME(3) NULL AFTER account_status;

CREATE TABLE sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del identificador de la cookie. Nunca el valor en claro.',
  csrf_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del token CSRF. Nunca el valor en claro.',
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_sessions_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_kind VARCHAR(16) NOT NULL,
  email_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del correo normalizado. No guarda el correo.',
  ip_address VARCHAR(45) NOT NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_login_attempts_email_time (email_hash, attempted_at),
  KEY ix_login_attempts_ip_time (ip_address, attempted_at),
  CONSTRAINT ck_login_attempts_kind CHECK (attempt_kind IN ('login', 'register'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organization_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL,
  role VARCHAR(32) NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del token de un solo uso. Nunca el valor en claro.',
  invited_by_user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  pending_email_key VARCHAR(320) GENERATED ALWAYS AS (
    CASE
      WHEN accepted_at IS NULL AND revoked_at IS NULL THEN CONCAT(organization_id, '#', email)
      ELSE NULL
    END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_organization_invitations_token (token_hash),
  UNIQUE KEY uq_organization_invitations_pending (pending_email_key),
  KEY ix_organization_invitations_org (organization_id),
  CONSTRAINT fk_organization_invitations_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_organization_invitations_inviter FOREIGN KEY (invited_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_organization_invitations_email CHECK (email REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CONSTRAINT ck_organization_invitations_role CHECK (role IN ('administrator', 'editor', 'technical_reviewer', 'viewer')),
  CONSTRAINT ck_organization_invitations_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
