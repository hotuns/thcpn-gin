package export

import (
	"bytes"
	"encoding/csv"
	"sort"
	"strconv"
	"time"
)

// Rows align only exact source timestamps within the same node; missing values stay blank.
func gatewayWideRows(series []telemetrySeries) [][]xlsxCell {
	gateway := len(series) > 0 && series[0].NodeKey != ""
	normalized := append([]telemetrySeries(nil), series...)
	for i := range normalized {
		s := &normalized[i]
		if s.NodeKey == "" {
			s.NodeKey = s.DeviceID.String()
		}
		if s.MetricName == "" {
			s.MetricName = s.Name
		}
		if s.MetricName == "" {
			s.MetricName = s.Code
		}
	}
	series = normalized

	columns := []string{}
	columnIndex := map[string]int{}
	metricKey := func(s telemetrySeries) string { return s.Code + "\x00" + s.MetricName + "\x00" + s.Unit }
	for _, s := range series {
		key := metricKey(s)
		if _, ok := columnIndex[key]; !ok {
			columnIndex[key] = len(columns)
			label := s.MetricName + " [" + s.Code + "]"
			if s.Unit != "" {
				label += " (" + s.Unit + ")"
			}
			columns = append(columns, label)
		}
	}
	qualityIndex := map[string]int{}
	for _, s := range series {
		for _, point := range s.Points {
			if point.Quality != "" {
				key := metricKey(s)
				if _, ok := qualityIndex[key]; !ok {
					qualityIndex[key] = len(columns)
					columns = append(columns, s.MetricName+" ["+s.Code+"] 质量")
				}
				break
			}
		}
	}
	header := []xlsxCell{stringCell("节点名称"), stringCell("节点ID"), stringCell("节点序号"), stringCell("时间（北京时间）")}
	if !gateway {
		header = []xlsxCell{stringCell("设备名称"), stringCell("设备ID"), stringCell("节点序号"), stringCell("时间（北京时间）")}
	}
	for _, c := range columns {
		header = append(header, stringCell(c))
	}
	type rowKey struct {
		node      string
		timestamp time.Time
	}
	rows := map[rowKey][]xlsxCell{}
	keys := []rowKey{}
	for _, s := range series {
		for _, p := range s.Points {
			key := rowKey{s.NodeKey, p.Timestamp.UTC()}
			row, ok := rows[key]
			if !ok {
				row = make([]xlsxCell, len(header))
				row[0] = stringCell(s.NodeName)
				row[1] = stringCell(s.NodeKey)
				row[2] = stringCell("")
				if s.NodeIndex != nil {
					row[2] = numberCell(float64(*s.NodeIndex))
				}
				row[3] = stringCell(exportTime(p.Timestamp))
				keys = append(keys, key)
			}
			row[4+columnIndex[metricKey(s)]] = numberCell(p.Value)
			if idx, ok := qualityIndex[metricKey(s)]; ok {
				row[4+idx] = stringCell(p.Quality)
			}
			rows[key] = row
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].node != keys[j].node {
			return keys[i].node < keys[j].node
		}
		return keys[i].timestamp.Before(keys[j].timestamp)
	})
	result := [][]xlsxCell{header}
	for _, key := range keys {
		result = append(result, rows[key])
	}
	return result
}
func xlsxGatewayWideSheet(series []telemetrySeries) string {
	var buf bytes.Buffer
	buf.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>`)
	rows := gatewayWideRows(series)
	for i, row := range rows {
		writeXLSXRow(&buf, i+1, row)
	}
	buf.WriteString(`</sheetData><autoFilter ref="A1:` + xlsxColumnName(len(rows[0])) + strconv.Itoa(len(rows)) + `"/></worksheet>`)
	return buf.String()
}
func renderGatewayWideCSV(series []telemetrySeries) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	for _, row := range gatewayWideRows(series) {
		values := make([]string, len(row))
		for i, c := range row {
			values[i] = c.value
		}
		if err := writer.Write(values); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}
