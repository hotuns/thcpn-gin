UPDATE device_taxonomy_terms
SET icon = CASE COALESCE(NULLIF(icon, ''), code)
    WHEN 'tree-pine' THEN 'mdi:pine-tree'
    WHEN 'forest' THEN 'mdi:pine-tree'
    WHEN 'sprout' THEN 'mdi:sprout'
    WHEN 'grassland' THEN 'mdi:sprout'
    WHEN 'wheat' THEN 'mdi:barley'
    WHEN 'cropland' THEN 'mdi:barley'
    WHEN 'waves' THEN 'mdi:waves'
    WHEN 'wetland' THEN 'mdi:waves'
    WHEN 'sun' THEN 'mdi:white-balance-sunny'
    WHEN 'desert' THEN 'mdi:white-balance-sunny'
    WHEN 'building-2' THEN 'mdi:city-variant-outline'
    WHEN 'urban' THEN 'mdi:city-variant-outline'
    WHEN 'droplets' THEN 'mdi:water'
    WHEN 'water' THEN 'mdi:water'
    WHEN 'mountain' THEN 'mdi:terrain'
    WHEN 'leaf' THEN 'mdi:leaf'
    WHEN 'other' THEN 'mdi:leaf'
    ELSE icon
END
WHERE kind = 'ecosystem';
