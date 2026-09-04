package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"navori/internal/registryx"
	"navori/internal/store"
)

func (s *Server) listRegistries(w http.ResponseWriter, r *http.Request) {
	var regs []store.Registry
	if err := s.DB.DB.Order("id desc").Find(&regs).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(regs))
	for _, v := range regs {
		out = append(out, registryJSON(v))
	}
	ok(w, out)
}

func (s *Server) createRegistry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name            string
		URL             string
		Username        string
		Password        string
		CredentialID    uint
		Namespace       string
		InsecureSkipTLS bool
		IsDefault       bool
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name == "" || req.URL == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name and url are required")
		return
	}
	reg := store.Registry{
		Name:            req.Name,
		URL:             req.URL,
		Namespace:       req.Namespace,
		InsecureSkipTLS: req.InsecureSkipTLS,
		IsDefault:       req.IsDefault,
	}
	if req.CredentialID != 0 {
		reg.CredentialID = req.CredentialID
	} else if req.Username != "" {
		reg.Username = req.Username
		if req.Password != "" {
			enc, err := s.Sec.Encrypt(req.Password)
			if err != nil {
				fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
				return
			}
			reg.PasswordEnc = enc
		}
	}
	if err := s.DB.DB.Create(&reg).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "registry.create", reg.Name)
	created(w, registryJSON(reg))
}

func (s *Server) getRegistry(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var reg store.Registry
	if err := s.DB.DB.First(&reg, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "registry not found")
		return
	}
	ok(w, registryJSON(reg))
}

func (s *Server) updateRegistry(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var reg store.Registry
	if err := s.DB.DB.First(&reg, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "registry not found")
		return
	}
	var req struct {
		Name            *string
		URL             *string
		Username        *string
		Password        *string
		CredentialID    *uint
		Namespace       *string
		InsecureSkipTLS *bool
		IsDefault       *bool
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name != nil {
		reg.Name = *req.Name
	}
	if req.URL != nil {
		reg.URL = *req.URL
	}
	if req.CredentialID != nil {
		reg.CredentialID = *req.CredentialID
		if *req.CredentialID != 0 {
			reg.Username = ""
			reg.PasswordEnc = ""
		}
	}
	if req.Username != nil {
		reg.Username = *req.Username
		if *req.Username != "" && req.CredentialID != nil && *req.CredentialID == 0 {
			reg.CredentialID = 0
		}
	}
	if req.Password != nil && *req.Password != "" {
		enc, err := s.Sec.Encrypt(*req.Password)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		reg.PasswordEnc = enc
	}
	if req.Namespace != nil {
		reg.Namespace = *req.Namespace
	}
	if req.InsecureSkipTLS != nil {
		reg.InsecureSkipTLS = *req.InsecureSkipTLS
	}
	if req.IsDefault != nil {
		reg.IsDefault = *req.IsDefault
	}
	if err := s.DB.DB.Save(&reg).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "registry.update", reg.Name)
	ok(w, registryJSON(reg))
}

func (s *Server) deleteRegistry(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.Registry{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "registry.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func (s *Server) testRegistryConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL          string
		Username     string
		Password     string
		CredentialID uint
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if len(req.URL) == 0 {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "url is required")
		return
	}
	username, password := req.Username, req.Password
	if req.CredentialID != 0 {
		var cred store.GitCredential
		if s.DB.DB.First(&cred, req.CredentialID).Error == nil {
			secret, _ := s.Sec.Decrypt(cred.SecretEnc)
			username, password = cred.Username, secret
		}
	}
	if len(username) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := registryx.CheckLogin(ctx, req.URL, username, password); err != nil {
			fail(w, http.StatusBadRequest, "E_CONNECT_FAILED", err.Error())
			return
		}
	} else {
		conn, err := net.DialTimeout("tcp", stripScheme(req.URL), 5*time.Second)
		if err != nil {
			fail(w, http.StatusBadRequest, "E_CONNECT_FAILED", err.Error())
			return
		}
		conn.Close()
	}
	ok(w, map[string]interface{}{"ok": true})
}

func (s *Server) testRegistry(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var reg store.Registry
	if err := s.DB.DB.First(&reg, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "registry not found")
		return
	}
	username, password := s.registryCredentials(&reg)
	if len(username) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := registryx.CheckLogin(ctx, reg.URL, username, password); err != nil {
			s.updateRegistryTestStatus(&reg, "error")
			fail(w, http.StatusBadRequest, "E_CONNECT_FAILED", err.Error())
			return
		}
	} else {
		conn, err := net.DialTimeout("tcp", stripScheme(reg.URL), 5*time.Second)
		if err != nil {
			s.updateRegistryTestStatus(&reg, "error")
			fail(w, http.StatusBadRequest, "E_CONNECT_FAILED", err.Error())
			return
		}
		conn.Close()
	}
	s.updateRegistryTestStatus(&reg, "success")
	ok(w, map[string]interface{}{"ok": true})
}

func (s *Server) updateRegistryTestStatus(reg *store.Registry, status string) {
	now := time.Now()
	reg.LastTestStatus = status
	reg.LastTestAt = &now
	s.DB.DB.Model(reg).Updates(map[string]interface{}{"last_test_status": status, "last_test_at": now})
} // registryCredentials resolves the effective username/password for a registry,
// preferring a referenced credential over directly stored credentials.
func (s *Server) registryCredentials(reg *store.Registry) (string, string) {
	if reg.CredentialID != 0 {
		var cred store.GitCredential
		if s.DB.DB.First(&cred, reg.CredentialID).Error == nil {
			secret, _ := s.Sec.Decrypt(cred.SecretEnc)
			return cred.Username, secret
		}
	}
	if reg.Username != "" {
		pwd, _ := s.Sec.Decrypt(reg.PasswordEnc)
		return reg.Username, pwd
	}
	return "", ""
}

func stripScheme(u string) string {
	u = strings.TrimPrefix(u, "https://")
	u = strings.TrimPrefix(u, "http://")
	return strings.TrimSuffix(u, "/")
}

func registryJSON(v store.Registry) map[string]interface{} {
	return map[string]interface{}{
		"id":              v.ID,
		"name":            v.Name,
		"url":             v.URL,
		"username":        v.Username,
		"passwordSet":     v.PasswordEnc != "",
		"credentialId":    v.CredentialID,
		"namespace":       v.Namespace,
		"insecureSkipTls": v.InsecureSkipTLS,
		"isDefault":       v.IsDefault,
		"lastTestStatus":  v.LastTestStatus,
		"lastTestAt":      v.LastTestAt,
	}
}
