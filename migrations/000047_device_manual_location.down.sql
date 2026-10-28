ALTER TABLE device_profiles DROP CONSTRAINT device_profiles_location_check;
ALTER TABLE device_profiles DROP COLUMN latitude, DROP COLUMN longitude;
COMMENT ON TABLE device_profiles IS '平台维护的设备业务资料，目前保存描述和文字地址，不保存实时经纬度。';
