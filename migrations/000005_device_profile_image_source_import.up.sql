ALTER TABLE device_profile_images
    ALTER COLUMN uploaded_by DROP NOT NULL;

COMMENT ON COLUMN device_profile_images.uploaded_by IS
    '人工上传者；从外部设备源同步的图片为空。';
