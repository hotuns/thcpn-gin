ALTER TABLE device_profile_images
    ADD COLUMN source_url text;

COMMENT ON COLUMN device_profile_images.source_url IS
    '外部设备源图片地址；人工上传图片为空。';
