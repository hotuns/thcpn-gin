DROP TRIGGER devices_assign_asset_no ON devices;
DROP FUNCTION assign_device_asset_no();
ALTER TABLE lorawan_physical_nodes DROP COLUMN asset_no, DROP COLUMN hardware_sn;
ALTER TABLE devices DROP COLUMN asset_no, DROP COLUMN hardware_sn;
DROP FUNCTION next_asset_no(text);
