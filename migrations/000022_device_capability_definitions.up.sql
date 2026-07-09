CREATE TABLE device_capability_definitions (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
    name text NOT NULL CHECK (btrim(name) <> ''),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    sort_order integer NOT NULL DEFAULT 1000,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO device_capability_definitions (code, name, sort_order)
VALUES
    ('telemetry', '遥测', 10),
    ('image_capture', '图片采集', 20),
    ('video_stream', '视频流', 30),
    ('ptz_control', '云台控制', 40),
    ('remote_command', '远程命令', 50),
    ('configurable', '可配置', 60),
    ('calibratable', '可校准', 70),
    ('firmware_update', '固件升级', 80),
    ('edge_storage', '边缘存储', 90);

ALTER TABLE device_capabilities
    DROP CONSTRAINT IF EXISTS device_capabilities_capability_code_check;

ALTER TABLE device_capabilities
    ADD CONSTRAINT device_capabilities_capability_code_fkey
        FOREIGN KEY (capability_code) REFERENCES device_capability_definitions (code)
        ON UPDATE CASCADE;
