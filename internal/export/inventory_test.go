package export

import (
	"archive/zip"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
)

func TestAdminInventoryDownloadRequiresAdministratorAndValidIDs(t *testing.T) {
	h := NewHandler(nil, nil)
	user := auth.Actor{UserID: uuid.New()}
	admin := auth.Actor{UserID: uuid.New(), IsSystemAdmin: true}
	if resp := inventoryRequest(h, user, `{"device_ids":["`+uuid.NewString()+`"]}`); resp.Code != http.StatusUnauthorized {
		t.Fatalf("user inventory request returned %d", resp.Code)
	}
	id := uuid.New()
	for _, ids := range [][]uuid.UUID{nil, {}, {uuid.Nil}, {id, id}} {
		if resp := inventoryRequest(h, admin, inventoryRequestBody(t, ids...)); resp.Code != http.StatusBadRequest {
			t.Fatalf("invalid device IDs %v returned %d", ids, resp.Code)
		}
	}
}

func TestAdminInventoryDownloadIncludesCurrentGatewayNodes(t *testing.T) {
	db := testdb.Open(t, 0)
	adminID := testdb.Admin(t, db)
	admin := auth.Actor{UserID: adminID, IsSystemAdmin: true}
	gateway, other, station, thcpn, thcpnNode, source, thcpnSource := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	const nodeSN = "00123456789012345678"
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO devices(id,name,device_type,asset_no,serial_no) VALUES
		($1,'网关 & A','gateway','LR-00005101','EC-00410999'), ($2,'其他网关','gateway','LR-00005102','EC-00411000'),
		($3,'标准站','standalone','ZC-00005103','EC-00411001'), ($4,'旧组网站','gateway','LR-00005104','EC-00411002'),
		($5,'旧组网站节点','gateway_node','LR-00005105','EC-00411003')`, gateway, other, station, thcpn, thcpnNode)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES
		($1,'LoRa V2','http_api','lorawan_v2','env:NOT_USED',$3), ($2,'THCPN','mysql','thcpn','env:NOT_USED',$3)`, source, thcpnSource, adminID)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES
		($1,$3,'lorawan_v2','00898604000000000001'), ($2,$3,'lorawan_v2','unused-gateway-SN')`, gateway, other, source)
	must(`INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id)
		VALUES($1,$2,'gateway_node',$3,1,2)`, thcpn, thcpnNode, thcpnSource)
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index,asset_no,hardware_sn) VALUES
		($1,1,$4,$2,31,'LR-00006101','SHOULD-NOT-REPLACE-NODE-SN'), ($1,2,'unused-node',$3,1,'LR-00006102',NULL),
		($1,3,'unbound-node',NULL,NULL,'LR-00006103',NULL)`, source, gateway, other, nodeSN)
	must(`INSERT INTO lorawan_legacy_nodes(gateway_device_id,node_index) VALUES($1,7),($1,31)`, gateway)
	must(`INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) VALUES
		($1,31,'土壤节点',$2,'system_admin'), ($1,90,'历史节点',$2,'system_admin')`, gateway, adminID)
	h := NewHandler(NewService(db, nil, config.ExportConfig{}), nil, audit.NewService(db))
	if resp := inventoryRequest(h, admin, inventoryRequestBody(t, uuid.New(), gateway)); resp.Code != http.StatusNotFound {
		t.Fatalf("missing device returned %d: %s", resp.Code, resp.Body.String())
	}
	resp := inventoryRequest(h, admin, inventoryRequestBody(t, station, gateway, thcpn))
	if resp.Code != http.StatusOK || resp.Header().Get("Content-Type") != contentTypeXLSX || !strings.HasPrefix(resp.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("download failed: %d %v", resp.Code, resp.Header())
	}
	book, err := zip.NewReader(strings.NewReader(resp.Body.String()), int64(resp.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	metadata := readZipFile(t, book, "xl/workbook.xml")
	if !strings.Contains(metadata, `name="设备清单"`) || !strings.Contains(metadata, `name="网关节点"`) ||
		!strings.Contains(readZipFile(t, book, "[Content_Types].xml"), `/xl/worksheets/sheet2.xml`) ||
		!strings.Contains(readZipFile(t, book, "xl/_rels/workbook.xml.rels"), `Target="worksheets/sheet2.xml"`) {
		t.Fatal("workbook is missing the second sheet registration")
	}
	assets := readZipFile(t, book, "xl/worksheets/sheet1.xml")
	if !strings.Contains(assets, `<c r="A2" t="inlineStr"><is><t>ZC-00005103</t>`) || !strings.Contains(assets, `网关 &amp; A`) ||
		strings.Contains(assets, "EC-00410") || strings.Contains(assets, gateway.String()) {
		t.Fatalf("wrong asset display or order: %s", assets)
	}
	nodeSheet := readZipFile(t, book, "xl/worksheets/sheet2.xml")
	var sheet struct {
		Rows []struct {
			Cells []struct {
				Type  string `xml:"t,attr"`
				Text  string `xml:"is>t"`
				Value string `xml:"v"`
			} `xml:"c"`
		} `xml:"sheetData>row"`
	}
	if err := xml.Unmarshal([]byte(nodeSheet), &sheet); err != nil || len(sheet.Rows) != 4 {
		t.Fatalf("expected header, indexed-only and bound V2 nodes and THCPN node: %v %s", err, nodeSheet)
	}
	legacy, bound, thcpnChild := sheet.Rows[1].Cells, sheet.Rows[2].Cells, sheet.Rows[3].Cells
	if legacy[5].Text != "" || legacy[6].Value != "7" || bound[0].Text != "LR-00005101" || bound[2].Text != "00898604000000000001" ||
		bound[4].Text != "土壤节点" || bound[5].Type != "inlineStr" || bound[5].Text != nodeSN || bound[6].Type != "" || bound[6].Value != "31" ||
		thcpnChild[0].Text != "LR-00005104" || thcpnChild[3].Text != "LR-00005105" || thcpnChild[6].Value != "" {
		t.Fatalf("incorrect node identity, text typing or sequence: %s", nodeSheet)
	}
	var audits, jobs int
	if err := db.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM audit_logs WHERE action='admin.device.inventory.export' AND actor_admin_id=$1), (SELECT count(*) FROM export_jobs)`, adminID).Scan(&audits, &jobs); err != nil || audits != 1 || jobs != 0 {
		t.Fatalf("expected a single audit and no export job: %d %d %v", audits, jobs, err)
	}
}

func inventoryRequest(h *Handler, actor auth.Actor, body string) *httptest.ResponseRecorder {
	resp := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(resp)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/devices/export", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	auth.SetActorContext(c, actor)
	h.AdminDownloadDeviceInventory(c)
	return resp
}

func inventoryRequestBody(t *testing.T, ids ...uuid.UUID) string {
	t.Helper()
	body, err := json.Marshal(map[string][]uuid.UUID{"device_ids": ids})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
