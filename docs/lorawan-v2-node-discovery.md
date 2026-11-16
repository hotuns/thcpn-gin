# LoRaWAN V2 节点自动接入与旧节点迁移

接收服务根据上报中的 SN 和序号记录节点身份。无冲突的新节点由接收服务登记和绑定；同一位置有不同 SN 时，平台「节点管理 → 待确认节点」列出现有和上报 SN，由系统管理员确认更换。采样仍按原网关与序号保存，确认更换不会向硬件写配置。

平台 Worker 启动时以及每分钟同步已启用的 LoRaWAN V2 网关，后台「刷新节点」可提前执行单个网关的同步。同步只读接收服务的节点绑定和必要的传感器配置，不导入未知网关，也不确认待处理的替换。没有传感器配置时先建立电压、RSSI、SNR、SD 卡使用率的状态指标；后续同步会补齐可用的采集指标。名称、坐标、快照、节点资产与原有数据流 ID 保留。

## 明确登记仍在运行的旧节点

迁移 59 新增 `lorawan_legacy_nodes` 表，默认留空。先用现场清单或能确认仍在使用的上报核对每个位置，再录入经审核的「平台网关资产编号＋节点序号」清单。不要把网关容量、带配置的位置、曾经有数据或已解绑的节点当作仍在运行的依据。

以下是平台 PostgreSQL 的录入示例，请使用审核过的清单替换示例行。只有已启用的 LoRaWAN V2 网关、未与物理节点绑定的位置才会录入；重复运行不会重复登记。核对返回的位置和清单一致后再提交。

```sql
BEGIN;
WITH reviewed(asset_no, node_index) AS (
    VALUES ('LR-EXAMPLE', 55)
)
INSERT INTO lorawan_legacy_nodes (gateway_device_id, node_index)
SELECT d.id, reviewed.node_index
FROM reviewed
JOIN devices d ON d.asset_no=reviewed.asset_no
JOIN device_source_refs r ON r.device_id=d.id AND r.status='active'
    AND r.adapter_code='lorawan_v2'
JOIN data_sources ds ON ds.id=r.data_source_id AND ds.status='active'
    AND ds.source_family='lorawan_v2'
WHERE d.device_type='gateway' AND d.status='active' AND d.lifecycle_status<>'retired'
    AND NOT EXISTS (
      SELECT 1 FROM lorawan_physical_nodes p
      WHERE p.gateway_device_id=d.id AND p.node_index=reviewed.node_index
    )
ON CONFLICT DO NOTHING
RETURNING gateway_device_id, node_index;
-- 核对结果后执行 COMMIT；有误则执行 ROLLBACK。
```

旧节点在列表标注「按序号接入」。可以读取其运行状态和采样历史；需要真实 SN 的更换、解绑与配置下发仍按原规则。绑定真实 SN 后会清除旧节点标记，位置、配置和历史仍保留。迁移 59 的 down 只删除旧节点标记表；如已登记旧节点，回退前应导出该表的清单以便恢复。
