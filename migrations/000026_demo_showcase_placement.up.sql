ALTER TABLE demo_showcase_devices
    ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
    ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
