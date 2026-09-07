package notify

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// Event is the outgoing webhook payload (keys are camelCase per API contract).
type Event map[string]interface{}

// Send posts the event to url, signed with secret (HMAC-SHA256).
func Send(url, secret string, ev Event) error {
	body, _ := json.Marshal(ev)
	sig := hmacSHA256(secret, body)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Navori-Signature", "sha256="+sig)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("notify webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func hmacSHA256(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// statusIcon maps a run status to a small unicode marker for IM messages.
func statusIcon(status string) string {
	switch status {
	case "success":
		return "✅"
	case "failed":
		return "❌"
	case "cancelled", "rejected":
		return "⏹️"
	case "running", "pending", "awaiting_approval":
		return "⏳"
	default:
		return "•"
	}
}

// SendChannel dispatches an event to a notification channel by type.
// cfg is the decrypted channel config map.
func SendChannel(typ string, cfg map[string]interface{}, ev Event) error {
	switch typ {
	case "rest":
		url, _ := cfg["url"].(string)
		secret, _ := cfg["secret"].(string)
		if url == "" {
			return fmt.Errorf("rest channel missing url")
		}
		return Send(url, secret, ev)
	case "email":
		return sendEmail(cfg, ev)
	case "feishu", "dingtalk", "wecom":
		return sendIM(typ, cfg, ev)
	default:
		return fmt.Errorf("unsupported channel type %q", typ)
	}
}

// sendIM posts a generic text payload to an IM webhook (simplified).
func sendIM(typ string, cfg map[string]interface{}, ev Event) error {
	url, _ := cfg["webhook"].(string)
	if url == "" {
		return fmt.Errorf("%s channel missing webhook", typ)
	}
	status, _ := ev["status"].(string)
	pipeline, _ := ev["pipelineId"].(float64)
	repo, _ := ev["repo"].(string)
	group, _ := ev["pipelineGroup"].(string)
	image, _ := ev["imageTag"].(string)
	commit, _ := ev["commitShort"].(string)
	branch, _ := ev["branch"].(string)

	name := repo
	if name == "" {
		name = fmt.Sprintf("流水线 #%.0f", pipeline)
	}
	displayName := name
	if group != "" {
		displayName = group + "/" + name
	}
	mdTitle := fmt.Sprintf("**%s %s**", statusIcon(status), displayName)
	// feishu text messages do not render markdown; keep plain lines
	plainLine := fmt.Sprintf("%s %s\n状态: %s\n流水线: #%.0f\n分支: %s\n镜像: %s\ncommit: %s",
		statusIcon(status), displayName, status, pipeline, branch, image, commit)
	mdLine := fmt.Sprintf("%s\n状态: %s\n流水线: #%.0f\n分支: %s\n镜像: %s\ncommit: %s",
		mdTitle, status, pipeline, branch, image, commit)
	var payload interface{}
	switch typ {
	case "feishu":
		payload = map[string]interface{}{"msg_type": "text", "content": map[string]interface{}{"text": plainLine}}
	case "dingtalk":
		payload = map[string]interface{}{"msgtype": "markdown", "markdown": map[string]interface{}{"title": "Navori 通知", "text": mdLine}}
	default: // wecom
		payload = map[string]interface{}{"msgtype": "markdown", "markdown": map[string]interface{}{"content": mdLine}}
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("IM webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func sendEmail(cfg map[string]interface{}, ev Event) error {
	host, _ := cfg["host"].(string)
	portStr, _ := cfg["port"].(string)
	username, _ := cfg["username"].(string)
	password, _ := cfg["password"].(string)
	from, _ := cfg["from"].(string)
	toRaw, _ := cfg["to"].(string)
	if host == "" || from == "" || toRaw == "" {
		return fmt.Errorf("email channel incomplete config")
	}
	port := 25
	if n, err := strconv.Atoi(portStr); err == nil {
		port = n
	}
	addr := host + ":" + strconv.Itoa(port)
	status, _ := ev["status"].(string)
	pipeline, _ := ev["pipelineId"].(float64)
	repo, _ := ev["repo"].(string)
	name := repo
	if name == "" {
		name = fmt.Sprintf("流水线 #%.0f", pipeline)
	}
	subject := fmt.Sprintf("[Navori] %s 状态: %s", name, status)
	body := fmt.Sprintf("流水线: %s (#%.0f)\n状态: %s\n镜像: %v\n错误: %v", name, pipeline, status, ev["imageTag"], ev["error"])
	msg := []byte("To: " + toRaw + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	auth := smtp.PlainAuth("", username, password, host)
	if err := smtp.SendMail(addr, auth, from, strings.Split(toRaw, ","), msg); err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}
