package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"navori/internal/store"
)

func (s *Server) listVariables(w http.ResponseWriter, r *http.Request) {
	var vs []store.Variable
	if err := s.DB.DB.Order("id desc").Find(&vs).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(vs))
	for _, v := range vs {
		out = append(out, variableJSON(v))
	}
	ok(w, out)
}

func (s *Server) createVariable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key         string
		Value       string
		Secret      bool
		Description string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Key == "" || req.Value == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "key and value are required")
		return
	}
	enc, err := s.Sec.Encrypt(req.Value)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	v := store.Variable{Key: req.Key, ValueEnc: enc, Secret: req.Secret, Description: req.Description}
	if err := s.DB.DB.Create(&v).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "variable.create", v.Key)
	created(w, variableJSON(v))
}

func (s *Server) updateVariable(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var v store.Variable
	if err := s.DB.DB.First(&v, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "variable not found")
		return
	}
	var req struct {
		Value       *string
		Secret      *bool
		Description *string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Value != nil && *req.Value != "" {
		enc, err := s.Sec.Encrypt(*req.Value)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		v.ValueEnc = enc
	}
	if req.Secret != nil {
		v.Secret = *req.Secret
	}
	if req.Description != nil {
		v.Description = *req.Description
	}
	if err := s.DB.DB.Save(&v).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "variable.update", v.Key)
	ok(w, variableJSON(v))
}

func (s *Server) deleteVariable(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.Variable{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "variable.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func variableJSON(v store.Variable) map[string]interface{} {
	return map[string]interface{}{
		"id": v.ID, "key": v.Key, "secret": v.Secret, "description": v.Description,
		"valueSet": v.ValueEnc != "",
	}
}
