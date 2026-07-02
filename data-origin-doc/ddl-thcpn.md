# thcpn 相关数据表



## devices
-- thcpn.devices definition

CREATE TABLE `devices` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `iccid` varchar(50) NOT NULL,
  `version` enum('1.0','2.0') NOT NULL,
  `status` enum('normal','abnormal') NOT NULL,
  `device_type` varchar(64) DEFAULT '0' COMMENT '设备类型：0其他 1农田 2森林 3草地、荒漠 4水体、湿地 5中草药 6 碳汇 10网关 11分布式-农田 12分布式-森林 13分布式-草地、荒漠 14分布式-水体、湿地 15分布式-中草药 16 分布式-碳汇 19 分布式-其他',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `lat` varchar(16) DEFAULT NULL,
  `lon` varchar(16) DEFAULT NULL,
  `alt` varchar(16) DEFAULT NULL,
  `battery` varchar(32) DEFAULT NULL COMMENT '电池电量',
  `signal` varchar(32) DEFAULT NULL COMMENT '信号强度',
  `active` tinyint(1) NOT NULL DEFAULT '0',
  `avatar` text NOT NULL,
  `sn` text NOT NULL,
  `debug` tinyint(1) DEFAULT '0',
  `addr` varchar(191) DEFAULT NULL,
  `current_device_version` varchar(100) NOT NULL DEFAULT '1.0',
  `ext_info` json DEFAULT NULL COMMENT '设备额外信息',
  `is_mg` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否是从test数据库迁移过来的',
  `uuid` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3177 DEFAULT CHARSET=utf8mb4;




## 数据分表索引
-- thcpn.device_data_index definition

CREATE TABLE `device_data_index` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `tb_name` varchar(16) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=154 DEFAULT CHARSET=utf8mb4;


## 数据表
-- thcpn.device_data_152 definition

CREATE TABLE `device_data_152` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `device_config_id` int(10) unsigned NOT NULL COMMENT '设备配置编号',
  `device_id` int(10) unsigned NOT NULL COMMENT '设备编号',
  `data` json NOT NULL COMMENT '数据',
  `ts` timestamp NULL DEFAULT NULL COMMENT '数据生成时间',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据更新时间',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据上传时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '数据删除时间',
  `type` enum('image','data') NOT NULL COMMENT '数据类型： image 图像 data 数据',
  `uuid` char(36) DEFAULT NULL COMMENT '数据UUID',
  PRIMARY KEY (`id`),
  KEY `device_config_id` (`device_config_id`),
  KEY `device_id` (`device_id`),
  CONSTRAINT `device_data_152_FK_device_config_id` FOREIGN KEY (`device_config_id`) REFERENCES `device_config` (`id`),
  CONSTRAINT `device_data_152_FK_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1026791 DEFAULT CHARSET=utf8mb4;


### 示例

data字段数据是一个json： {"bat1": {"value": 3.48}, "diams": {"value": 64.2025}}

如果type是image，那么data是： {"key4": {"value": "/2449/1778055441_1778055193_630.jpg"}}






## device_config
-- thcpn.device_config definition

CREATE TABLE `device_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int(10) unsigned NOT NULL,
  `data` json NOT NULL,
  `image` json DEFAULT NULL,
  `control` json NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `version` enum('1.0','2.0') COLLATE utf8mb4_unicode_ci NOT NULL,
  `uuid` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_mg` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=20080 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

设备配置表对照设备数据，才能正确的理解data中key的含义

### 示例
{
"device_config": [
	{
		"id" : 1302,
		"device_id" : 101,
		"data" : "[{\"desc\": \"电池电压\", \"port\": \"ad\", \"params\": {\"contents\": [{\"key\": \"bat\", \"info\": {\"name\": \"电压\", \"type\": \"voltage\", \"unit\": \"V\", \"index\": 0}, \"decode\": \"5.0,0.0,5.09\"}], \"wait_time\": 10}, \"sensor\": \"ad\", \"port_num\": 5, \"port_nums\": [5], \"sensorType\": \"VOLT\"}, {\"desc\": \"NHZD10光照\", \"port\": \"ad\", \"params\": {\"contents\": [{\"key\": \"solar\", \"info\": {\"name\": \"太阳光照\", \"type\": \"solar\", \"unit\": \"lx\", \"index\": 0}, \"decode\": \"2.0,0.0,100\"}], \"wait_time\": 10}, \"sensor\": \"ad\", \"port_num\": 4, \"port_nums\": [1, 2, 3, 4], \"sensorType\": \"NHZD10\"}, {\"desc\": \"csf11土壤温度水分传感器\", \"port\": \"485\", \"params\": {\"command\": \"010300000002C40B\", \"contents\": [{\"key\": \"shumi\", \"info\": {\"name\": \"土壤水分\", \"type\": \"humdity\", \"unit\": \"%\", \"index\": 0}, \"decode\": \"0,0.1,0,<2f\"}, {\"key\": \"stemp\", \"info\": {\"name\": \"土壤温度\", \"type\": \"temperature\", \"unit\": \"℃\", \"index\": 1}, \"decode\": \"1,0.1,30,<2f\"}], \"wait_time\": 1000}, \"sensor\": \"modbusrtu\", \"port_num\": 3, \"port_nums\": [0, 1, 2, 3], \"sensorType\": \"CSF11\"}, {\"desc\": \"nh122环境传感器\", \"port\": \"485\", \"params\": {\"command\": \"15040000000272DF\", \"contents\": [{\"key\": \"temp\", \"info\": {\"name\": \"空气温度\", \"type\": \"temperature\", \"unit\": \"℃\", \"index\": 0}, \"decode\": \"0,0.1,0,<2f\"}, {\"key\": \"humi\", \"info\": {\"name\": \"相对湿度\", \"type\": \"humdity\", \"unit\": \"%\", \"index\": 1}, \"decode\": \"1,0.1,0,<2f\"}], \"wait_time\": 1000}, \"sensor\": \"modbusrtu\", \"port_num\": 2, \"port_nums\": [0, 1, 2, 3], \"sensorType\": \"NH122\"}]",
		"image" : "[{\"key\": \"key1\", \"dest\": \"摄像模块1\", \"port\": \"hisi\", \"port_num\": 0}, {\"key\": \"key2\", \"dest\": \"摄像模块1\", \"port\": \"hisi\", \"port_num\": 1}]",
		"control" : "{\"misc_invl\": \"0 18\", \"img_upload_invl\": \"30 *\", \"data_upload_invl\": \"20,30,40,50 *\", \"img_capture_invl\": \"30 *\", \"data_capture_invl\": \"20,30,40,50 *\"}",
		"updated_at" : "2020-11-20 15:12:46",
		"created_at" : "2020-11-20 05:12:46",
		"deleted_at" : null,
		"version" : "2.0",
		"uuid" : null,
		"is_mg" : 0
	}
]}



