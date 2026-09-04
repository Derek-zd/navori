package secrets

import (
	"strings"
	"testing"
)

func TestNewFromHex(t *testing.T) {
	valid := strings.Repeat("ab", 32) // 32 bytes hex
	s, err := NewFromHex(valid)
	if err != nil {
		t.Fatalf("NewFromHex(valid): %v", err)
	}
	if s == nil {
		t.Fatal("NewFromHex returned nil Secrets")
	}

	cases := []struct {
		name string
		hex  string
		ferr bool
	}{
		{"too short", strings.Repeat("ab", 31), true},
		{"too long", strings.Repeat("ab", 33), true},
		{"odd length", "abc", true},
		{"not hex", strings.Repeat("zz", 32), true},
		{"empty", "", true},
	}
	for _, c := range cases {
		if _, err := NewFromHex(c.hex); (err != nil) != c.ferr {
			t.Errorf("%s: err=%v, want err=%v", c.name, err, c.ferr)
		}
	}
}

func TestRoundTripExplicitKey(t *testing.T) {
	hexKey := strings.Repeat("cd", 32)
	s, err := NewFromHex(hexKey)
	if err != nil {
		t.Fatalf("NewFromHex: %v", err)
	}
	enc, err := s.Encrypt("kubeconfig-secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	dec, err := s.Decrypt(enc)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if dec != "kubeconfig-secret" {
		t.Errorf("round trip = %q", dec)
	}

	// a different key must fail to decrypt
	s2, _ := NewFromHex(strings.Repeat("ef", 32))
	if _, err := s2.Decrypt(enc); err == nil {
		t.Error("expected decrypt with wrong key to fail")
	}
}
