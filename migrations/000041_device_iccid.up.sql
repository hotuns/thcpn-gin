ALTER TABLE devices ADD COLUMN iccid text;
ALTER TABLE devices ADD CONSTRAINT devices_iccid_format CHECK (iccid IS NULL OR iccid ~ '^[0-9]{19,20}$');
COMMENT ON COLUMN devices.iccid IS '管理员记录的物联卡 ICCID；不随采集数据源同步覆盖。';
