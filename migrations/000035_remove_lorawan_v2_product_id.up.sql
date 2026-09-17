DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM device_source_refs ref
    JOIN devices other ON other.serial_no = ref.external_key AND other.id <> ref.device_id
    JOIN data_sources src ON src.id = ref.data_source_id
    WHERE ref.adapter_code='lorawan_v2' AND src.source_family='lorawan_v2'
  ) THEN
    RAISE EXCEPTION 'cannot adopt LoRaWAN V2 SN: serial_no already belongs to another device';
  END IF;
END $$;

UPDATE devices AS d
SET product_id = NULL,
    serial_no = ref.external_key,
    updated_at = now()
FROM device_source_refs AS ref
JOIN data_sources AS src ON src.id = ref.data_source_id
WHERE ref.device_id = d.id
  AND ref.adapter_code = 'lorawan_v2'
  AND src.source_family = 'lorawan_v2';

COMMENT ON COLUMN devices.serial_no IS 'Canonical device serial; LoRaWAN V2 gateways use the upstream gateway SN.';
