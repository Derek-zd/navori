package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"navori/internal/store"
)

func idParam(r *http.Request) (uint, error) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(id), nil
}

// ---- repositories ----

func (s *Server) listRepositories(w http.ResponseWriter, r *http.Request) {
	var repos []store.Repository
	if err := s.DB.DB.Order("id desc").Find(&repos).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(repos))
	for _, v := range repos {
		out = append(out, repositoryJSON(v))
	}
	ok(w, out)
}

func (s *Server) createRepository(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           string
		GitURL         string
		CredentialID   uint
		DefaultBranch  string
		DockerfilePath string
		BuildContext   string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name == "" || req.GitURL == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name and gitUrl are required")
		return
	}
	if req.DefaultBranch == "" {
		req.DefaultBranch = "main"
	}
	if req.DockerfilePath == "" {
		req.DockerfilePath = "Dockerfile"
	}
	if req.BuildContext == "" {
		req.BuildContext = "."
	}
	repo := store.Repository{
		Name:           req.Name,
		GitURL:         req.GitURL,
		CredentialID:   req.CredentialID,
		DefaultBranch:  req.DefaultBranch,
		DockerfilePath: req.DockerfilePath,
		BuildContext:   req.BuildContext,
		ScanStatus:     "pending",
	}
	if err := s.DB.DB.Create(&repo).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "repository.create", repo.Name)
	created(w, repositoryJSON(repo))
}

func (s *Server) getRepository(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	ok(w, repositoryJSON(repo))
}

func (s *Server) updateRepository(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	var req struct {
		Name           *string
		GitURL         *string
		CredentialID   *uint
		DefaultBranch  *string
		DockerfilePath *string
		BuildContext   *string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name != nil {
		repo.Name = *req.Name
	}
	if req.GitURL != nil {
		repo.GitURL = *req.GitURL
	}
	if req.CredentialID != nil {
		repo.CredentialID = *req.CredentialID
	}
	if req.DefaultBranch != nil {
		repo.DefaultBranch = *req.DefaultBranch
	}
	if req.DockerfilePath != nil {
		repo.DockerfilePath = *req.DockerfilePath
	}
	if req.BuildContext != nil {
		repo.BuildContext = *req.BuildContext
	}
	if err := s.DB.DB.Save(&repo).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "repository.update", repo.Name)
	ok(w, repositoryJSON(repo))
}

func (s *Server) deleteRepository(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.Repository{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "repository.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func (s *Server) scanRepository(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	s.DB.DB.Model(&repo).Updates(map[string]interface{}{"scan_status": "scanning", "scan_message": ""})
	go s.doScan(&repo)
	s.audit(r, "repository.scan", repo.Name)
	ok(w, map[string]interface{}{"scanStatus": "scanning"})
}

func repositoryJSON(v store.Repository) map[string]interface{} {
	return map[string]interface{}{
		"id":             v.ID,
		"name":           v.Name,
		"gitUrl":         v.GitURL,
		"credentialId":   v.CredentialID,
		"defaultBranch":  v.DefaultBranch,
		"dockerfilePath": v.DockerfilePath,
		"buildContext":   v.BuildContext,
		"scanStatus":     v.ScanStatus,
		"scanMessage":    v.ScanMessage,
		"createdAt":      v.CreatedAt,
		"updatedAt":      v.UpdatedAt,
	}
}

// ---- credentials ----

func (s *Server) listCredentials(w http.ResponseWriter, r *http.Request) {
	var creds []store.GitCredential
	if err := s.DB.DB.Order("id desc").Find(&creds).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(creds))
	for _, v := range creds {
		out = append(out, map[string]interface{}{
			"id": v.ID, "name": v.Name, "type": v.Type, "username": v.Username,
			"secretSet": v.SecretEnc != "",
		})
	}
	ok(w, out)
}

func (s *Server) createCredential(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string
		Type     string
		Username string
		Secret   string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name == "" || req.Secret == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name and secret are required")
		return
	}
	if req.Type == "" {
		req.Type = "https"
	}
	enc, err := s.Sec.Encrypt(req.Secret)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	cred := store.GitCredential{Name: req.Name, Type: req.Type, Username: req.Username, SecretEnc: enc}
	if err := s.DB.DB.Create(&cred).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "credential.create", cred.Name)
	created(w, map[string]interface{}{"id": cred.ID, "name": cred.Name, "type": cred.Type, "username": cred.Username, "secretSet": true})
}

func (s *Server) updateCredential(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var cred store.GitCredential
	if err := s.DB.DB.First(&cred, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "credential not found")
		return
	}
	var req struct {
		Name     *string
		Type     *string
		Username *string
		Secret   *string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name != nil {
		cred.Name = *req.Name
	}
	if req.Type != nil {
		cred.Type = *req.Type
	}
	if req.Username != nil {
		cred.Username = *req.Username
	}
	if req.Secret != nil && *req.Secret != "" {
		enc, err := s.Sec.Encrypt(*req.Secret)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		cred.SecretEnc = enc
	}
	if err := s.DB.DB.Save(&cred).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "credential.update", cred.Name)
	ok(w, map[string]interface{}{"id": cred.ID, "name": cred.Name, "type": cred.Type, "username": cred.Username, "secretSet": cred.SecretEnc != ""})
}

func (s *Server) deleteCredential(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.GitCredential{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "credential.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}
