ALTER TABLE devices ADD COLUMN asset_no text, ADD COLUMN hardware_sn text;
ALTER TABLE lorawan_physical_nodes ADD COLUMN asset_no text, ADD COLUMN hardware_sn text;

CREATE FUNCTION next_asset_no(role text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT CASE role
    WHEN 'gateway' THEN 'LR'
    WHEN 'gateway_node' THEN 'LR'
    WHEN 'carbon_sink' THEN 'CS'
    WHEN 'camera' THEN 'VD'
    ELSE 'ZC'
  END || '-' || lpad(nextval('device_serial_no_seq')::text, 8, '0');
$$;

-- Keep existing platform numbers and leave the original serial as a claim alias.
UPDATE devices SET asset_no = CASE WHEN serial_no ~ '^EC-[0-9]{8}$'
  AND NOT EXISTS (SELECT 1 FROM device_source_refs r WHERE r.device_id=devices.id AND r.adapter_code='lorawan_v2')
  THEN serial_no ELSE next_asset_no(device_type) END;
CREATE UNIQUE INDEX devices_asset_no_unique ON devices (asset_no);

UPDATE lorawan_physical_nodes SET asset_no = next_asset_no('gateway_node');
ALTER TABLE lorawan_physical_nodes ALTER COLUMN asset_no SET DEFAULT next_asset_no('gateway_node'),
  ALTER COLUMN asset_no SET NOT NULL, ADD UNIQUE (asset_no);

-- Source imports set the device role after inserting the row, in the same transaction.
CREATE FUNCTION assign_device_asset_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE devices SET asset_no = next_asset_no(device_type)
    WHERE id = NEW.id AND asset_no IS NULL;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER devices_assign_asset_no AFTER INSERT ON devices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assign_device_asset_no();
