package api

import (
	"testing"

	"navori/internal/store"
)

func TestChannelSummaryIncludesSystemAlerts(t *testing.T) {
	ch := store.NotifyChannel{Name: "ops", Type: "rest", SystemAlerts: true}
	out := channelSummary(ch, map[string]interface{}{"url": "https://example.test", "secret": "x"})
	if out["systemAlerts"] != true {
		t.Fatalf("systemAlerts missing: %#v", out)
	}
	cfg := out["config"].(map[string]interface{})
	if cfg["secret"] != "already-set" {
		t.Fatalf("secret should be redacted: %#v", cfg)
	}
}
