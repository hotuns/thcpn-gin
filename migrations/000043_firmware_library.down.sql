-- Reused artifacts cannot satisfy the old per-release unique object key contract.
-- Refuse rollback rather than rewriting historical artifact URLs or deleting releases.
ALTER TABLE firmware_releases ADD CONSTRAINT firmware_releases_object_key_key UNIQUE(object_key);
ALTER TABLE firmware_releases DROP COLUMN firmware_id;
DROP TABLE firmware_artifacts;
