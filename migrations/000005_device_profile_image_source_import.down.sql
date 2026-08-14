DELETE FROM device_profile_images WHERE uploaded_by IS NULL;

ALTER TABLE device_profile_images
    ALTER COLUMN uploaded_by SET NOT NULL;
