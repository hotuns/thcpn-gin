package export

import (
	"archive/zip"
	"bytes"
	"math"
	"strconv"
	"time"
)

func renderTelemetryXLSX(series []telemetrySeries) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	files := []struct {
		name string
		body []byte
	}{
		{name: "[Content_Types].xml", body: []byte(xlsxContentTypesXML)},
		{name: "_rels/.rels", body: []byte(xlsxRootRelsXML)},
		{name: "docProps/app.xml", body: []byte(xlsxAppXML)},
		{name: "docProps/core.xml", body: []byte(xlsxCoreXML(time.Now().UTC()))},
		{name: "xl/workbook.xml", body: []byte(xlsxWorkbookXML)},
		{name: "xl/_rels/workbook.xml.rels", body: []byte(xlsxWorkbookRelsXML)},
		{name: "xl/styles.xml", body: []byte(xlsxStylesXML)},
		{name: "xl/worksheets/sheet1.xml", body: []byte(xlsxTelemetrySheetXML(series))},
	}
	for _, file := range files {
		if err := writeBytesFile(zw, file.name, file.body); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func xlsxTelemetrySheetXML(series []telemetrySeries) string {
	var buf bytes.Buffer
	buf.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	buf.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	writeXLSXRow(&buf, 1, []xlsxCell{
		stringCell("data_stream_id"),
		stringCell("device_id"),
		stringCell("code"),
		stringCell("name"),
		stringCell("unit"),
		stringCell("ts"),
		stringCell("value"),
		stringCell("quality"),
	})
	row := 2
	for _, item := range series {
		for _, point := range item.Points {
			writeXLSXRow(&buf, row, []xlsxCell{
				stringCell(item.DataStreamID.String()),
				stringCell(item.DeviceID.String()),
				stringCell(item.Code),
				stringCell(item.Name),
				stringCell(item.Unit),
				stringCell(point.Timestamp.UTC().Format(time.RFC3339Nano)),
				numberCell(point.Value),
				stringCell(point.Quality),
			})
			row++
		}
	}
	buf.WriteString(`</sheetData></worksheet>`)
	return buf.String()
}

type xlsxCell struct {
	typ   string
	value string
}

func stringCell(value string) xlsxCell {
	return xlsxCell{typ: "inlineStr", value: value}
}

func numberCell(value float64) xlsxCell {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return stringCell(strconv.FormatFloat(value, 'f', -1, 64))
	}
	return xlsxCell{value: strconv.FormatFloat(value, 'f', -1, 64)}
}

func writeXLSXRow(buf *bytes.Buffer, row int, cells []xlsxCell) {
	buf.WriteString(`<row r="`)
	buf.WriteString(strconv.Itoa(row))
	buf.WriteString(`">`)
	for i, cell := range cells {
		ref := xlsxColumnName(i+1) + strconv.Itoa(row)
		buf.WriteString(`<c r="`)
		buf.WriteString(ref)
		buf.WriteString(`"`)
		if cell.typ != "" {
			buf.WriteString(` t="`)
			buf.WriteString(cell.typ)
			buf.WriteString(`"`)
		}
		buf.WriteString(`>`)
		if cell.typ == "inlineStr" {
			buf.WriteString(`<is><t>`)
			writeXMLText(buf, cell.value)
			buf.WriteString(`</t></is>`)
		} else {
			buf.WriteString(`<v>`)
			buf.WriteString(cell.value)
			buf.WriteString(`</v>`)
		}
		buf.WriteString(`</c>`)
	}
	buf.WriteString(`</row>`)
}

func xlsxColumnName(index int) string {
	if index <= 0 {
		return ""
	}
	var chars []byte
	for index > 0 {
		index--
		chars = append(chars, byte('A'+index%26))
		index /= 26
	}
	for left, right := 0, len(chars)-1; left < right; left, right = left+1, right-1 {
		chars[left], chars[right] = chars[right], chars[left]
	}
	return string(chars)
}

func writeXMLText(buf *bytes.Buffer, value string) {
	for _, r := range value {
		if !isValidXMLChar(r) {
			buf.WriteRune(' ')
			continue
		}
		switch r {
		case '&':
			buf.WriteString("&amp;")
		case '<':
			buf.WriteString("&lt;")
		case '>':
			buf.WriteString("&gt;")
		case '"':
			buf.WriteString("&quot;")
		case '\'':
			buf.WriteString("&apos;")
		default:
			buf.WriteRune(r)
		}
	}
}

func isValidXMLChar(r rune) bool {
	return r == 0x09 ||
		r == 0x0A ||
		r == 0x0D ||
		(r >= 0x20 && r <= 0xD7FF) ||
		(r >= 0xE000 && r <= 0xFFFD) ||
		(r >= 0x10000 && r <= 0x10FFFF)
}

func xlsxCoreXML(now time.Time) string {
	created := now.Format(time.RFC3339)
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
		`xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
		`xmlns:dcterms="http://purl.org/dc/terms/" ` +
		`xmlns:dcmitype="http://purl.org/dc/dcmitype/" ` +
		`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<dc:creator>In-situ EcoCloud</dc:creator>` +
		`<cp:lastModifiedBy>In-situ EcoCloud</cp:lastModifiedBy>` +
		`<dcterms:created xsi:type="dcterms:W3CDTF">` + created + `</dcterms:created>` +
		`<dcterms:modified xsi:type="dcterms:W3CDTF">` + created + `</dcterms:modified>` +
		`</cp:coreProperties>`
}

const xlsxContentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const xlsxRootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const xlsxAppXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>In-situ EcoCloud</Application>
</Properties>`

const xlsxWorkbookXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="telemetry" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

const xlsxWorkbookRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const xlsxStylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
