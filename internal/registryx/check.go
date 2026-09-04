package registryx

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CheckLogin verifies registry credentials against the Docker Registry v2 API.
// It avoids invoking docker login / the OS credential helper entirely.
func CheckLogin(ctx context.Context, rawURL, username, password string) error {
	base := normalizeBase(rawURL)
	client := &http.Client{Timeout: 15 * time.Second}

	// First request to /v2/ with basic auth (or without for anonymous registries).
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v2/", nil)
	if err != nil {
		return err
	}
	if len(username) > 0 {
		req.SetBasicAuth(username, password)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusOK {
		resp.Body.Close()
		return nil
	}
	if resp.StatusCode == http.StatusUnauthorized {
		challenge := resp.Header.Get("WWW-Authenticate")
		resp.Body.Close()
		if strings.HasPrefix(challenge, "Bearer ") {
			realm, service, scope := parseBearer(challenge)
			token, err := fetchToken(ctx, client, realm, service, scope, username, password)
			if err != nil {
				return err
			}
			req2, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v2/", nil)
			if err != nil {
				return err
			}
			req2.Header.Set("Authorization", "Bearer "+token)
			resp2, err := client.Do(req2)
			if err != nil {
				return err
			}
			defer resp2.Body.Close()
			if resp2.StatusCode == http.StatusOK {
				return nil
			}
			return fmt.Errorf("registry auth failed: %s", resp2.Status)
		}
		return fmt.Errorf("registry requires authentication: %s", challenge)
	}
	resp.Body.Close()
	return fmt.Errorf("registry responded %s", resp.Status)
}

func normalizeBase(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	u = strings.TrimSuffix(u, "/")
	if !strings.Contains(u, "://") {
		u = "https://" + u
	}
	return u
}

type tokenResponse struct {
	Token       string `json:"token"`
	AccessToken string `json:"access_token"`
}

func fetchToken(ctx context.Context, client *http.Client, realm, service, scope, username, password string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realm, nil)
	if err != nil {
		return "", err
	}
	query := req.URL.Query()
	if len(service) > 0 {
		query.Set("service", service)
	}
	if len(scope) > 0 {
		query.Set("scope", scope)
	}
	req.URL.RawQuery = query.Encode()
	if len(username) > 0 {
		req.SetBasicAuth(username, password)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint %s: %s", resp.Status, string(body))
	}
	var tr tokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", err
	}
	if len(tr.Token) > 0 {
		return tr.Token, nil
	}
	if len(tr.AccessToken) > 0 {
		return tr.AccessToken, nil
	}
	return "", fmt.Errorf("token endpoint returned no token")
}

func parseBearer(challenge string) (realm, service, scope string) {
	// challenge format: Bearer realm="...",service="...",scope="..."
	body := strings.TrimSpace(strings.TrimPrefix(challenge, "Bearer "))
	for _, part := range strings.Split(body, ",") {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := kv[0]
		val := strings.Trim(strings.TrimSpace(kv[1]), `"`)
		switch key {
		case "realm":
			realm = val
		case "service":
			service = val
		case "scope":
			scope = val
		}
	}
	return realm, service, scope
}
