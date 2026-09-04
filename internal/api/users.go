package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"navori/internal/auth"
	"navori/internal/store"
)

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var us []store.User
	if err := s.DB.DB.Order("id desc").Find(&us).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(us))
	for _, u := range us {
		out = append(out, userJSON(u))
	}
	ok(w, out)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var req struct {
		Username string
		Password string
		Role     string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Username == "" || req.Password == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "username and password are required")
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	u := store.User{Username: req.Username, PasswordHash: hash, Role: req.Role}
	if err := s.DB.DB.Create(&u).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "user.create", u.Username)
	created(w, userJSON(u))
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var u store.User
	if err := s.DB.DB.First(&u, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "user not found")
		return
	}
	var req struct {
		Role     *string
		Password *string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Role != nil {
		u.Role = *req.Role
	}
	if req.Password != nil && *req.Password != "" {
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		u.PasswordHash = hash
	}
	if err := s.DB.DB.Save(&u).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "user.update", u.Username)
	ok(w, userJSON(u))
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.User{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "user.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func isAdmin(r *http.Request) bool {
	c := claimsFrom(r)
	return c != nil && c.Role == "admin"
}
