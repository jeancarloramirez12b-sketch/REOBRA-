DROP TABLE IF EXISTS organization_invitations;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS sessions;
ALTER TABLE users DROP COLUMN terms_accepted_at;
