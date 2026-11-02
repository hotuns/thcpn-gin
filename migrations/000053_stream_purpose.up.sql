ALTER TABLE data_streams ADD COLUMN purpose text NOT NULL DEFAULT 'measurement'
    CHECK (purpose IN ('measurement', 'status', 'location'));

-- Classify existing V2 channels without replacing identities or changing availability.
UPDATE data_streams ds SET purpose = classified.purpose
FROM (
    SELECT DISTINCT ON (data_stream_id) data_stream_id,
        CASE WHEN adapter_config_json->>'metric' IN ('longitude','latitude','altitude') THEN 'location'
             WHEN adapter_config_json->>'node_index' IS NULL
                  OR adapter_config_json->>'metric' IN ('battery','rssi','snr','sd_card_rate') THEN 'status'
             ELSE 'measurement' END AS purpose
    FROM data_stream_bindings WHERE adapter_code='lorawan_v2'
    ORDER BY data_stream_id, (status='active') DESC, updated_at DESC, id
) classified WHERE ds.id=classified.data_stream_id AND ds.type='telemetry';
