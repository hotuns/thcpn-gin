UPDATE device_taxonomy_terms
SET icon = CASE icon
    WHEN 'mdi:pine-tree' THEN 'tree-pine'
    WHEN 'mdi:sprout' THEN 'sprout'
    WHEN 'mdi:barley' THEN 'wheat'
    WHEN 'mdi:waves' THEN 'waves'
    WHEN 'mdi:white-balance-sunny' THEN 'sun'
    WHEN 'mdi:city-variant-outline' THEN 'building-2'
    WHEN 'mdi:water' THEN 'droplets'
    WHEN 'mdi:terrain' THEN 'mountain'
    WHEN 'mdi:leaf' THEN 'leaf'
    ELSE icon
END
WHERE kind = 'ecosystem';
