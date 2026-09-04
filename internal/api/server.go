package api

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"navori/internal/auth"
	"navori/internal/config"
	"navori/internal/secrets"
	"navori/internal/store"
	"navori/web"
)

const cookieName = "navori_token"

// Server holds shared dependencies for HTTP handlers.
type Server struct {
	DB   *store.Store
	Auth *auth.Auth
	Cfg  *config.Config
	Sec  *secrets.Secrets

	cancelMu sync.Mutex
	cancels  map[uint]context.CancelFunc

	approveMu    sync.Mutex
	approveChans map[uint]chan string
}

// Handler assembles the chi router.
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// public
	r.Post("/api/auth/login", s.login)
	r.Post("/api/auth/logout", s.logout)
	r.Get("/api/system/health", s.health)
	r.Post("/api/webhooks", s.webhook)

	// authenticated
	r.Group(func(r chi.Router) {
		r.Use(s.requireAuth)
		r.Get("/api/auth/me", s.me)
		r.Get("/api/system/info", s.info)
		r.Get("/api/system/config", s.sysConfig)
		r.Get("/api/system/settings", s.getSystemSettings)
		r.Patch("/api/system/settings", s.updateSystemSettings)

		r.Get("/api/repositories", s.listRepositories)
		r.Post("/api/repositories", s.createRepository)
		r.Get("/api/repositories/{id}", s.getRepository)
		r.Patch("/api/repositories/{id}", s.updateRepository)
		r.Delete("/api/repositories/{id}", s.deleteRepository)
		r.Post("/api/repositories/{id}/scan", s.scanRepository)

		r.Get("/api/credentials", s.listCredentials)
		r.Post("/api/credentials", s.createCredential)
		r.Patch("/api/credentials/{id}", s.updateCredential)
		r.Delete("/api/credentials/{id}", s.deleteCredential)

		r.Get("/api/pipelines", s.listPipelines)
		r.Post("/api/pipelines", s.createPipeline)
		r.Get("/api/pipelines/{id}", s.getPipeline)
		r.Patch("/api/pipelines/{id}", s.updatePipeline)
		r.Delete("/api/pipelines/{id}", s.deletePipeline)
		r.Post("/api/pipelines/{id}/run", s.runPipeline)

		r.Get("/api/registries", s.listRegistries)
		r.Post("/api/registries", s.createRegistry)
		r.Post("/api/registries/test", s.testRegistryConfig)
		r.Get("/api/registries/{id}", s.getRegistry)
		r.Patch("/api/registries/{id}", s.updateRegistry)
		r.Delete("/api/registries/{id}", s.deleteRegistry)
		r.Post("/api/registries/{id}/test", s.testRegistry)

		r.Get("/api/deploy-targets", s.listDeployTargets)
		r.Post("/api/deploy-targets", s.createDeployTarget)
		r.Get("/api/deploy-targets/{id}", s.getDeployTarget)
		r.Patch("/api/deploy-targets/{id}", s.updateDeployTarget)
		r.Delete("/api/deploy-targets/{id}", s.deleteDeployTarget)
		r.Post("/api/deploy-targets/{id}/test", s.testDeployTarget)
		r.Get("/api/deploy-targets/{id}/history", s.getDeployTargetHistory)

		r.Get("/api/variables", s.listVariables)
		r.Post("/api/variables", s.createVariable)
		r.Patch("/api/variables/{id}", s.updateVariable)
		r.Delete("/api/variables/{id}", s.deleteVariable)

		r.Get("/api/users", s.listUsers)
		r.Post("/api/users", s.createUser)
		r.Patch("/api/users/{id}", s.updateUser)
		r.Delete("/api/users/{id}", s.deleteUser)

		r.Get("/api/audit-logs", s.listAuditLogs)

		r.Get("/api/notify-channels", s.listNotifyChannels)
		r.Post("/api/notify-channels", s.createNotifyChannel)
		r.Get("/api/notify-channels/{id}", s.getNotifyChannel)
		r.Patch("/api/notify-channels/{id}", s.updateNotifyChannel)
		r.Delete("/api/notify-channels/{id}", s.deleteNotifyChannel)

		r.Get("/api/runs", s.listRuns)
		r.Get("/api/runs/{id}", s.getRun)
		r.Get("/api/runs/{id}/logs", s.runLogs)
		r.Post("/api/runs/{id}/stop", s.stopRun)
		r.Post("/api/runs/{id}/rerun", s.rerunRun)
		r.Post("/api/runs/{id}/approve", s.approveRun)
		r.Post("/api/runs/{id}/reject", s.rejectRun)
	})

	// embedded SPA (catch-all with history fallback)
	dist, err := fs.Sub(web.FS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// Never fallback for unknown API routes.
		if len(req.URL.Path) >= 4 && req.URL.Path[:4] == "/api" {
			http.NotFound(w, req)
			return
		}
		// Serve real files directly; otherwise let the SPA handle the route.
		name := strings.TrimPrefix(req.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(dist, name); err == nil {
			fileServer.ServeHTTP(w, req)
			return
		}
		req2 := req.Clone(req.Context())
		req2.URL.Path = "/"
		fileServer.ServeHTTP(w, req2)
	}))

	return r
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string
		Password string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid request body")
		return
	}

	var u store.User
	if err := s.DB.DB.Where("username = ?", req.Username).First(&u).Error; err != nil {
		fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "invalid credentials")
		return
	}
	if !auth.CheckPassword(u.PasswordHash, req.Password) {
		fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "invalid credentials")
		return
	}

	token, err := s.Auth.Sign(u.ID, u.Username, u.Role)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", "failed to sign token")
		return
	}

	expiry := 7 * 24 * time.Hour
	if d, err := time.ParseDuration(s.Cfg.JWTExpiry); err == nil {
		expiry = d
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(expiry.Seconds()),
	})

	ok(w, map[string]interface{}{"user": userJSON(u)})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	ok(w, map[string]interface{}{})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	var u store.User
	if err := s.DB.DB.First(&u, claims.UserID).Error; err != nil {
		fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "user not found")
		return
	}
	ok(w, map[string]interface{}{"user": userJSON(u)})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]interface{}{"status": "ok", "db": s.DB.Driver})
}

func (s *Server) info(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]interface{}{"version": s.Cfg.Version})
}

func (s *Server) sysConfig(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]interface{}{"webhookBaseUrl": s.Cfg.BaseURL})
}

func userJSON(u store.User) map[string]interface{} {
	return map[string]interface{}{"id": u.ID, "username": u.Username, "role": u.Role}
}
