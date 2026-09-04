package api

import (
	"encoding/json"
	"net/http"

	"navori/internal/store"
)

// getAppConfig returns the single app config row (creating if needed).
func (s *Server) getAppConfig() *store.AppConfig {
	var cfg store.AppConfig
	if err := s.DB.DB.First(&cfg).Error; err != nil {
		cfg = store.AppConfig{}
		if err := s.DB.DB.Create(&cfg).Error; err != nil {
			return &cfg
		}
	}
	return &cfg
}

func (s *Server) getSystemSettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.getAppConfig()
	smtp := map[string]interface{}{}
	if cfg.SMTPEnc != "" {
		if plain, err := s.Sec.Decrypt(cfg.SMTPEnc); err == nil {
			_ = json.Unmarshal([]byte(plain), &smtp)
			if pw, ok := smtp["password"]; ok && pw != "" {
				smtp["password"] = "already-set"
			}
		}
	}
	ok(w, map[string]interface{}{"smtp": smtp})
}

func (s *Server) updateSystemSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SMTP map[string]interface{}
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	cfg := s.getAppConfig()
	// merge with existing to preserve password if blank
	current := map[string]interface{}{}
	if cfg.SMTPEnc != "" {
		if plain, err := s.Sec.Decrypt(cfg.SMTPEnc); err == nil {
			_ = json.Unmarshal([]byte(plain), &current)
		}
	}
	for k, v := range req.SMTP {
		if (k == "password" && v == "") || (k == "password" && v == "already-set") {
			continue // keep existing
		}
		current[k] = v
	}
	b, _ := json.Marshal(current)
	enc, err := s.Sec.Encrypt(string(b))
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	cfg.SMTPEnc = enc
	if err := s.DB.DB.Save(cfg).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "settings.update", "system")
	s.getSystemSettings(w, r)
}

// smtpConfig returns decrypted SMTP settings (for notify).
func (s *Server) smtpConfig() map[string]interface{} {
	cfg := s.getAppConfig()
	out := map[string]interface{}{}
	if cfg.SMTPEnc == "" {
		return out
	}
	if plain, err := s.Sec.Decrypt(cfg.SMTPEnc); err == nil {
		_ = json.Unmarshal([]byte(plain), &out)
	}
	return out
}
