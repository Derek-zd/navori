package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"navori/internal/agentx"
	"navori/internal/store"
)

func TestAgentHelloUsesTokenIdentity(t *testing.T) {
	s, db := newDispatchTestServer(t)
	a := store.Agent{Name: "US", TokenHash: "x", Status: "offline"}
	if err := db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}

	// The request still carries a name to prove hello ignores it and uses the
	// agent record resolved from the token.
	req := httptest.NewRequest(http.MethodPost, "/api/agent/hello",
		strings.NewReader(`{"name":"WRONG","version":"0.1.0","host":"host-1","protocol":1}`))
	req = req.WithContext(context.WithValue(req.Context(), agentKey, &a))
	rec := httptest.NewRecorder()
	s.agentHello(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp agentx.HelloResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Name != "US" {
		t.Fatalf("hello name = %q, want token identity US", resp.Name)
	}

	var got store.Agent
	if err := db.First(&got, a.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != "online" || got.Hostname != "host-1" {
		t.Fatalf("agent after hello = %+v", got)
	}
}
