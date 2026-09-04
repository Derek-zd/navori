package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"navori/internal/store"
)

func (s *Server) listNotifyChannels(w http.ResponseWriter, r *http.Request) {
	var chs []store.NotifyChannel
	if err := s.DB.DB.Order("id desc").Find(&chs).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(chs))
	for _, c := range chs {
		cfg := s.decryptChannelConfig(c.ConfigJSON)
		out = append(out, channelSummary(c, cfg))
	}
	ok(w, out)
}

func (s *Server) createNotifyChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string
		Type   string
		Config map[string]interface{}
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name == "" || req.Type == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name and type are required")
		return
	}
	cfgJSON, _ := json.Marshal(req.Config)
	enc, err := s.Sec.Encrypt(string(cfgJSON))
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	ch := store.NotifyChannel{Name: req.Name, Type: req.Type, ConfigJSON: enc}
	if err := s.DB.DB.Create(&ch).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "channel.create", ch.Name)
	created(w, channelSummary(ch, req.Config))
}

func (s *Server) getNotifyChannel(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var ch store.NotifyChannel
	if err := s.DB.DB.First(&ch, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "channel not found")
		return
	}
	cfg := s.decryptChannelConfig(ch.ConfigJSON)
	ok(w, channelSummary(ch, cfg))
}

func (s *Server) updateNotifyChannel(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var ch store.NotifyChannel
	if err := s.DB.DB.First(&ch, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "channel not found")
		return
	}
	var req struct {
		Name   *string
		Type   *string
		Config map[string]interface{}
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name != nil {
		ch.Name = *req.Name
	}
	if req.Type != nil {
		ch.Type = *req.Type
	}
	if req.Config != nil {
		cfgJSON, _ := json.Marshal(req.Config)
		enc, err := s.Sec.Encrypt(string(cfgJSON))
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		ch.ConfigJSON = enc
	}
	if err := s.DB.DB.Save(&ch).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "channel.update", ch.Name)
	ok(w, channelSummary(ch, s.decryptChannelConfig(ch.ConfigJSON)))
}

func (s *Server) deleteNotifyChannel(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.NotifyChannel{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "channel.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func (s *Server) decryptChannelConfig(enc string) map[string]interface{} {
	cfg := map[string]interface{}{}
	if enc == "" {
		return cfg
	}
	plain, err := s.Sec.Decrypt(enc)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal([]byte(plain), &cfg)
	return cfg
}

func channelSummary(ch store.NotifyChannel, cfg map[string]interface{}) map[string]interface{} {
	// redact sensitive fields
	redact := map[string]interface{}{}
	for k, v := range cfg {
		switch k {
		case "password", "secret":
			redact[k] = "already-set"
		default:
			redact[k] = v
		}
	}
	return map[string]interface{}{
		"id":     ch.ID,
		"name":   ch.Name,
		"type":   ch.Type,
		"config": redact,
	}
}
