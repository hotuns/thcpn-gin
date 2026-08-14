
-- carbon_sink_v2.device_configs definition

CREATE TABLE `device_configs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `data` json DEFAULT NULL,
  `image` json DEFAULT NULL,
  `control` json DEFAULT NULL,
  `misc` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=104 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- carbon_sink_v2.device_data_202608 definition

CREATE TABLE `device_data_202608` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `device_config_id` int unsigned NOT NULL COMMENT '设备配置编号',
  `node_id` int unsigned NOT NULL COMMENT '节点编号',
  `period` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '数据周期',
  `period_at` datetime NOT NULL COMMENT '周期时间',
  `field` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '地块',
  `room` enum('light','black') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'light' COMMENT '气室类型',
  `data` json NOT NULL COMMENT '数据',
  `type` enum('data','image') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'data' COMMENT '数据类型',
  `ts` datetime NOT NULL COMMENT '数据采集时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据创建时间',
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '数据修改时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '数据删除时间',
  PRIMARY KEY (`id`),
  KEY `device_data_202608_IDX_device_id` (`device_id`),
  KEY `device_data_202608_IDX_device_config_id` (`device_config_id`),
  KEY `device_data_202608_IDX_node_id` (`node_id`),
  KEY `device_data_202608_IDX_period` (`period`),
  KEY `device_data_202608_IDX_period_at` (`period_at`),
  KEY `device_data_202608_IDX_type` (`type`),
  KEY `device_data_202608_IDX_ts` (`ts`)
) ENGINE=InnoDB AUTO_INCREMENT=1969461 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- carbon_sink_v2.device_data_next_202608 definition

CREATE TABLE `device_data_next_202608` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `device_config_id` int unsigned NOT NULL COMMENT '设备配置编号',
  `node_id` int unsigned NOT NULL COMMENT '节点编号',
  `period` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '数据周期',
  `period_at` datetime NOT NULL COMMENT '周期时间',
  `field` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '地块',
  `room` enum('light','black') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'light' COMMENT '气室类型',
  `data` json NOT NULL COMMENT '数据',
  `type` enum('data','image') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'data' COMMENT '数据类型',
  `ts` datetime NOT NULL COMMENT '数据采集时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据创建时间',
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '数据修改时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '数据删除时间',
  PRIMARY KEY (`id`),
  KEY `device_data_next_202608_IDX_device_id` (`device_id`),
  KEY `device_data_next_202608_IDX_device_config_id` (`device_config_id`),
  KEY `device_data_next_202608_IDX_node_id` (`node_id`),
  KEY `device_data_next_202608_IDX_period` (`period`),
  KEY `device_data_next_202608_IDX_period_at` (`period_at`),
  KEY `device_data_next_202608_IDX_field` (`field`),
  KEY `device_data_next_202608_IDX_room` (`room`),
  KEY `device_data_next_202608_IDX_type` (`type`),
  KEY `device_data_next_202608_IDX_ts` (`ts`)
) ENGINE=InnoDB AUTO_INCREMENT=1968501 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- carbon_sink_v2.carbon_flux_202608 definition

CREATE TABLE `carbon_flux_202608` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `node_id` int unsigned NOT NULL COMMENT '节点编号',
  `period` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '数据周期',
  `period_at` datetime NOT NULL,
  `data` json NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `carbon_flux_202608_IDX_device_id` (`device_id`),
  KEY `carbon_flux_202608_IDX_node_id` (`node_id`),
  KEY `carbon_flux_202608_IDX_period` (`period`),
  KEY `carbon_flux_202608_IDX_period_at` (`period_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4732 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- carbon_sink_v2.device_informations definition

CREATE TABLE `device_informations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL,
  `iccid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备 ICCID',
  `latitude` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备所处纬度',
  `longitude` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备所处经度',
  `altitude` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备所处海拔',
  `battery` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备电池电量',
  `signal` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备信号质量',
  `network` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备头像',
  `current_firmware_version` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备当前固件版本',
  `address` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备所处地址',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `device_informations_IDX_device_id` (`device_id`)
) ENGINE=InnoDB AUTO_INCREMENT=245081 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- carbon_sink_v2.device_logs definition

CREATE TABLE `device_logs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '日志编号',
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `oss_path` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '日志 OSS 路径',
  `log_date` date NOT NULL COMMENT '日志文件日期',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=47800 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日志';



-- carbon_sink_v2.device_time_202608 definition

CREATE TABLE `device_time_202608` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL,
  `server_time` datetime NOT NULL,
  `device_time` datetime DEFAULT NULL,
  `url` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18772 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




-- carbon_sink_v2.devices definition

CREATE TABLE `devices` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '设备编号',
  `name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '设备名称',
  `device_type` enum('carbon-sink','carbon-sink-v1','carbon-sink-v2','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'carbon-sink-v2' COMMENT '设备类型',
  `sn` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '设备SN',
  `nodes_count` int unsigned NOT NULL DEFAULT '16',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备表';




-- carbon_sink_v2.periods_202608 definition

CREATE TABLE `periods_202608` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL COMMENT '设备编号',
  `node_id` int unsigned NOT NULL COMMENT '节点编号',
  `period_at` datetime NOT NULL COMMENT '周期时间',
  `period` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '数据周期',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据创建时间',
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '数据修改时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '数据删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `periods_202608_UNI_period` (`period`),
  KEY `periods_202608_IDX_device_id` (`device_id`),
  KEY `periods_202608_IDX_node_id` (`node_id`),
  KEY `periods_202608_IDX_period_at` (`period_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4555 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




-- carbon_sink_v2.config_key_index definition

CREATE TABLE `config_key_index` (
  `id` int unsigned NOT NULL,
  `data` json DEFAULT NULL,
  `image` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
