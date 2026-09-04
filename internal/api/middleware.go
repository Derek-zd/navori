package api

import (
	"context"
	"net/http"

	"navori/internal/auth"
)

type ctxKey string

const claimsKey ctxKey = "claims"

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "missing token")
			return
		}
		claims, err := s.Auth.Parse(c.Value)
		if err != nil {
			fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "invalid token")
			return
		}
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func claimsFrom(r *http.Request) *auth.Claims {
	c, _ := r.Context().Value(claimsKey).(*auth.Claims)
	return c
}
