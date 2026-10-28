ALTER TABLE device_profiles ADD COLUMN latitude double precision;
ALTER TABLE device_profiles ADD COLUMN longitude double precision;
COMMENT ON TABLE device_profiles IS '平台安装资料与人工登记的静态 WGS84 安装位置；不保存设备实时上报位置。';
ALTER TABLE device_profiles ADD CONSTRAINT device_profiles_location_check CHECK (
 (latitude IS NULL AND longitude IS NULL) OR
 (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
