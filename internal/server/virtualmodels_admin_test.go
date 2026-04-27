package server

// Tests for the renamed /api/admin/virtualmodels endpoints.
// Prior to this refactor the routes were served at /api/admin/vmodels.
// These tests verify that:
//   - The new paths (/api/admin/virtualmodels) return the expected responses.
//   - The old paths (/api/admin/vmodels) return 404.
//   - Full CRUD lifecycle works end-to-end via the HTTP API.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"omnillm/internal/database"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

func adminRequest(t *testing.T, method, url string, body []byte) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		t.Fatalf("adminRequest: new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer test-api-key")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("adminRequest: do: %v", err)
	}
	return resp
}

func readBodyStr(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("readBodyStr: %v", err)
	}
	return string(data)
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("mustJSON: %v", err)
	}
	return data
}

func parseJSON(t *testing.T, s string) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("parseJSON: %v\nbody: %s", err, s)
	}
	return m
}

// cleanupVirtualModel deletes a virtual model and its upstreams from the DB.
func cleanupVirtualModel(t *testing.T, id string) {
	t.Helper()
	store := database.NewVirtualModelStore()
	_ = store.Delete(id)
	us := database.NewVirtualModelUpstreamStore()
	_ = us.SetForVModel(id, nil)
}

// ─── Old path returns 404 ─────────────────────────────────────────────────────

func TestVirtualModelsOldPathReturns404(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	for _, path := range []string{
		"/api/admin/vmodels",
		"/api/admin/vmodels/some-id",
	} {
		t.Run(path, func(t *testing.T) {
			resp := adminRequest(t, http.MethodGet, srv.URL+path, nil)
			body := readBodyStr(t, resp)
			if resp.StatusCode != http.StatusNotFound {
				t.Errorf("expected 404 for old path %s, got %d: %s", path, resp.StatusCode, body)
			}
		})
	}
}

// ─── List ─────────────────────────────────────────────────────────────────────

func TestListVirtualModelsEmpty(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp := adminRequest(t, http.MethodGet, srv.URL+"/api/admin/virtualmodels", nil)
	body := readBodyStr(t, resp)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, body)
	}
	data, ok := result["data"].([]interface{})
	if !ok {
		t.Fatalf("expected data array in response, got: %s", body)
	}
	_ = data // empty is fine — no assertions on count across test isolation
}

// ─── Create ───────────────────────────────────────────────────────────────────

func TestCreateVirtualModelSuccess(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-create-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	payload := map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Test Virtual Model",
		"description":      "Created by integration test",
		"lb_strategy":      "round-robin",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams":        []interface{}{},
	}

	resp := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", mustJSON(t, payload))
	body := readBodyStr(t, resp)

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}

	result := parseJSON(t, body)
	if result["virtual_model_id"] != vmID {
		t.Errorf("expected virtual_model_id=%q, got %v", vmID, result["virtual_model_id"])
	}
	if result["name"] != "Test Virtual Model" {
		t.Errorf("expected name='Test Virtual Model', got %v", result["name"])
	}
	if result["lb_strategy"] != "round-robin" {
		t.Errorf("expected lb_strategy='round-robin', got %v", result["lb_strategy"])
	}
}

func TestCreateVirtualModelDuplicateIDReturns409(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-dup-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	payload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Dupe",
		"lb_strategy":      "random",
	})

	resp1 := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", payload)
	readBodyStr(t, resp1)
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d", resp1.StatusCode)
	}

	resp2 := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", payload)
	body2 := readBodyStr(t, resp2)
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate create: expected 409, got %d: %s", resp2.StatusCode, body2)
	}
}

func TestCreateVirtualModelMissingRequiredFieldsReturns400(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	for _, tc := range []struct {
		name    string
		payload map[string]interface{}
	}{
		{
			"missing virtual_model_id",
			map[string]interface{}{"name": "x", "lb_strategy": "random"},
		},
		{
			"missing name",
			map[string]interface{}{"virtual_model_id": "x", "lb_strategy": "random"},
		},
		{
			"missing lb_strategy",
			map[string]interface{}{"virtual_model_id": "x", "name": "x"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", mustJSON(t, tc.payload))
			body := readBodyStr(t, resp)
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", resp.StatusCode, body)
			}
		})
	}
}

// ─── Get ──────────────────────────────────────────────────────────────────────

func TestGetVirtualModelSuccess(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-get-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	// Create via DB directly
	store := database.NewVirtualModelStore()
	if err := store.Create(&database.VirtualModelRecord{
		VirtualModelID: vmID,
		Name:           "Get Test",
		LbStrategy:     database.LbStrategyPriority,
		APIShape:       "openai",
		Enabled:        true,
	}); err != nil {
		t.Fatalf("create in DB: %v", err)
	}

	resp := adminRequest(t, http.MethodGet, srv.URL+"/api/admin/virtualmodels/"+vmID, nil)
	body := readBodyStr(t, resp)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
	result := parseJSON(t, body)
	if result["virtual_model_id"] != vmID {
		t.Errorf("expected virtual_model_id=%q, got %v", vmID, result["virtual_model_id"])
	}
	if result["name"] != "Get Test" {
		t.Errorf("expected name='Get Test', got %v", result["name"])
	}
}

func TestGetVirtualModelNotFoundReturns404(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp := adminRequest(t, http.MethodGet, srv.URL+"/api/admin/virtualmodels/does-not-exist", nil)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", resp.StatusCode, body)
	}
}

// ─── Update ───────────────────────────────────────────────────────────────────

func TestUpdateVirtualModelSuccess(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-update-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	store := database.NewVirtualModelStore()
	if err := store.Create(&database.VirtualModelRecord{
		VirtualModelID: vmID,
		Name:           "Before Update",
		LbStrategy:     database.LbStrategyRoundRobin,
		APIShape:       "openai",
		Enabled:        true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	update := map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "After Update",
		"lb_strategy":      "weighted",
		"api_shape":        "openai",
		"enabled":          false,
		"upstreams":        []interface{}{},
	}

	resp := adminRequest(t, http.MethodPut, srv.URL+"/api/admin/virtualmodels/"+vmID, mustJSON(t, update))
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	result := parseJSON(t, body)
	if result["name"] != "After Update" {
		t.Errorf("expected name='After Update', got %v", result["name"])
	}
	if result["lb_strategy"] != "weighted" {
		t.Errorf("expected lb_strategy='weighted', got %v", result["lb_strategy"])
	}
	if enabled, _ := result["enabled"].(bool); enabled {
		t.Error("expected enabled=false after update")
	}
}

func TestUpdateVirtualModelNotFoundReturns404(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	update := mustJSON(t, map[string]interface{}{
		"virtual_model_id": "no-such-vm",
		"name":             "x",
		"lb_strategy":      "random",
	})
	resp := adminRequest(t, http.MethodPut, srv.URL+"/api/admin/virtualmodels/no-such-vm", update)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", resp.StatusCode, body)
	}
}

// ─── Delete ───────────────────────────────────────────────────────────────────

func TestDeleteVirtualModelSuccess(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-delete-vm-001"
	// no t.Cleanup needed — the test itself deletes it

	store := database.NewVirtualModelStore()
	if err := store.Create(&database.VirtualModelRecord{
		VirtualModelID: vmID,
		Name:           "To Be Deleted",
		LbStrategy:     database.LbStrategyRandom,
		APIShape:       "openai",
		Enabled:        true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	resp := adminRequest(t, http.MethodDelete, srv.URL+"/api/admin/virtualmodels/"+vmID, nil)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", resp.StatusCode, body)
	}
	result := parseJSON(t, body)
	if result["deleted"] != vmID {
		t.Errorf("expected deleted=%q in response, got %v", vmID, result["deleted"])
	}

	// Confirm it's gone
	getResp := adminRequest(t, http.MethodGet, srv.URL+"/api/admin/virtualmodels/"+vmID, nil)
	getBody := readBodyStr(t, getResp)
	if getResp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 after deletion, got %d: %s", getResp.StatusCode, getBody)
	}
}

func TestDeleteVirtualModelNotFoundReturns404(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp := adminRequest(t, http.MethodDelete, srv.URL+"/api/admin/virtualmodels/no-such-vm", nil)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", resp.StatusCode, body)
	}
}

// ─── Upstreams ────────────────────────────────────────────────────────────────

func TestCreateVirtualModelWithUpstreams(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-upstreams-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	payload := map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Upstreams Test",
		"lb_strategy":      "priority",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams": []interface{}{
			map[string]interface{}{"provider_id": "p1", "model_id": "p1/claude-3-sonnet", "weight": 1, "priority": 0},
			map[string]interface{}{"provider_id": "p2", "model_id": "p2/gpt-4", "weight": 1, "priority": 1},
		},
	}

	resp := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", mustJSON(t, payload))
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}

	result := parseJSON(t, body)
	upstreams, ok := result["upstreams"].([]interface{})
	if !ok {
		t.Fatalf("expected upstreams array in response, got: %s", body)
	}
	if len(upstreams) != 2 {
		t.Errorf("expected 2 upstreams, got %d", len(upstreams))
	}
}

// ─── Full CRUD lifecycle ──────────────────────────────────────────────────────

func TestVirtualModelCRUDLifecycle(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-lifecycle-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	base := srv.URL + "/api/admin/virtualmodels"

	// 1. Create
	createPayload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Lifecycle Start",
		"lb_strategy":      "round-robin",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams":        []interface{}{},
	})
	r1 := adminRequest(t, http.MethodPost, base, createPayload)
	b1 := readBodyStr(t, r1)
	if r1.StatusCode != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", r1.StatusCode, b1)
	}

	// 2. List — new item must appear
	r2 := adminRequest(t, http.MethodGet, base, nil)
	b2 := readBodyStr(t, r2)
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", r2.StatusCode, b2)
	}
	var listResp map[string]interface{}
	if err := json.Unmarshal([]byte(b2), &listResp); err != nil {
		t.Fatalf("list parse: %v", err)
	}
	items, _ := listResp["data"].([]interface{})
	found := false
	for _, item := range items {
		m, _ := item.(map[string]interface{})
		if m["virtual_model_id"] == vmID {
			found = true
		}
	}
	if !found {
		t.Errorf("newly created vm %q not found in list", vmID)
	}

	// 3. Get
	r3 := adminRequest(t, http.MethodGet, fmt.Sprintf("%s/%s", base, vmID), nil)
	b3 := readBodyStr(t, r3)
	if r3.StatusCode != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", r3.StatusCode, b3)
	}

	// 4. Update
	updatePayload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Lifecycle Updated",
		"lb_strategy":      "weighted",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams":        []interface{}{},
	})
	r4 := adminRequest(t, http.MethodPut, fmt.Sprintf("%s/%s", base, vmID), updatePayload)
	b4 := readBodyStr(t, r4)
	if r4.StatusCode != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", r4.StatusCode, b4)
	}
	updated := parseJSON(t, b4)
	if updated["name"] != "Lifecycle Updated" {
		t.Errorf("update: expected name='Lifecycle Updated', got %v", updated["name"])
	}
	if updated["lb_strategy"] != "weighted" {
		t.Errorf("update: expected lb_strategy='weighted', got %v", updated["lb_strategy"])
	}

	// 5. Delete
	r5 := adminRequest(t, http.MethodDelete, fmt.Sprintf("%s/%s", base, vmID), nil)
	b5 := readBodyStr(t, r5)
	if r5.StatusCode != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", r5.StatusCode, b5)
	}

	// 6. Get after delete → 404
	r6 := adminRequest(t, http.MethodGet, fmt.Sprintf("%s/%s", base, vmID), nil)
	b6 := readBodyStr(t, r6)
	if r6.StatusCode != http.StatusNotFound {
		t.Fatalf("get after delete: expected 404, got %d: %s", r6.StatusCode, b6)
	}
}

// ─── Default api_shape ────────────────────────────────────────────────────────

func TestCreateVirtualModelDefaultAPIShape(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-default-shape-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	// Omit api_shape — server should default to "openai"
	payload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Default Shape",
		"lb_strategy":      "random",
		"upstreams":        []interface{}{},
	})

	resp := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", payload)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}

	result := parseJSON(t, body)
	if result["api_shape"] != "openai" {
		t.Errorf("expected default api_shape='openai', got %v", result["api_shape"])
	}
}

// ─── Upstreams replaced on update ────────────────────────────────────────────

func TestUpdateVirtualModelReplacesUpstreams(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-replace-upstreams-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	// Create with 2 upstreams
	createPayload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Upstream Replace",
		"lb_strategy":      "priority",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams": []interface{}{
			map[string]interface{}{"provider_id": "p1", "model_id": "p1/model-a", "weight": 1, "priority": 0},
			map[string]interface{}{"provider_id": "p2", "model_id": "p2/model-b", "weight": 1, "priority": 1},
		},
	})
	r1 := adminRequest(t, http.MethodPost, srv.URL+"/api/admin/virtualmodels", createPayload)
	readBodyStr(t, r1)
	if r1.StatusCode != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", r1.StatusCode)
	}

	// Update with only 1 upstream — should replace, not append
	updatePayload := mustJSON(t, map[string]interface{}{
		"virtual_model_id": vmID,
		"name":             "Upstream Replace",
		"lb_strategy":      "priority",
		"api_shape":        "openai",
		"enabled":          true,
		"upstreams": []interface{}{
			map[string]interface{}{"provider_id": "p3", "model_id": "p3/model-c", "weight": 1, "priority": 0},
		},
	})
	r2 := adminRequest(t, http.MethodPut, srv.URL+"/api/admin/virtualmodels/"+vmID, updatePayload)
	b2 := readBodyStr(t, r2)
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", r2.StatusCode, b2)
	}

	result := parseJSON(t, b2)
	upstreams, _ := result["upstreams"].([]interface{})
	if len(upstreams) != 1 {
		t.Errorf("expected 1 upstream after replace, got %d", len(upstreams))
	}
}

// ─── List shows upstreams inline ─────────────────────────────────────────────

func TestListVirtualModelsIncludesUpstreams(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	vmID := "test-list-upstreams-vm-001"
	t.Cleanup(func() { cleanupVirtualModel(t, vmID) })

	store := database.NewVirtualModelStore()
	if err := store.Create(&database.VirtualModelRecord{
		VirtualModelID: vmID,
		Name:           "List Upstreams",
		LbStrategy:     database.LbStrategyRoundRobin,
		APIShape:       "openai",
		Enabled:        true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	us := database.NewVirtualModelUpstreamStore()
	if err := us.SetForVModel(vmID, []database.VirtualModelUpstreamRecord{
		{VirtualModelID: vmID, ProviderID: "pa", ModelID: "pa/m1", Weight: 1, Priority: 0},
	}); err != nil {
		t.Fatalf("set upstreams: %v", err)
	}

	resp := adminRequest(t, http.MethodGet, srv.URL+"/api/admin/virtualmodels", nil)
	body := readBodyStr(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var listResp map[string]interface{}
	if err := json.Unmarshal([]byte(body), &listResp); err != nil {
		t.Fatalf("parse: %v", err)
	}

	items, _ := listResp["data"].([]interface{})
	for _, item := range items {
		m, _ := item.(map[string]interface{})
		if m["virtual_model_id"] == vmID {
			ups, _ := m["upstreams"].([]interface{})
			if len(ups) != 1 {
				t.Errorf("expected 1 upstream in list for %s, got %d", vmID, len(ups))
			}
			return
		}
	}
	t.Errorf("vm %q not found in list", vmID)
}
