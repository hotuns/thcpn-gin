UPDATE device_profile_images
SET caption = '从 THCPN 源设备同步',
    updated_at = now()
WHERE source_url IS NOT NULL
  AND caption IS NULL;
