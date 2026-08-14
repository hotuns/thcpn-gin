UPDATE device_profile_images
SET caption = NULL,
    updated_at = now()
WHERE source_url IS NOT NULL
  AND caption = '从 THCPN 源设备同步';
