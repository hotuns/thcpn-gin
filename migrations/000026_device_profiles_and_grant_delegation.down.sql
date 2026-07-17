DROP TABLE IF EXISTS device_profile_images;
DROP TABLE IF EXISTS device_profiles;

ALTER TABLE invitations
    DROP COLUMN IF EXISTS parent_grant_id;

DROP INDEX IF EXISTS access_grants_parent_idx;

ALTER TABLE access_grants
    DROP COLUMN IF EXISTS parent_grant_id;
