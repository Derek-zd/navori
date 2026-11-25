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

// agentEvent formats executor online/offline notifications. It returns the
// title, plain text and markdown text used by IM/email channels.
func agentEvent(ev Event) (title, plain, markdown string, ok bool) {
	event, _ := ev["event"].(string)
	if !strings.HasPrefix(event, "agent.") {
		return "", "", "", false
	}
	status, _ := ev["status"].(string)
	name, _ := ev["agentName"].(string)
	host, _ := ev["hostname"].(string)
	labels, _ := ev["agentLabels"].(string)
	version, _ := ev["version"].(string)
	lastSeen, _ := ev["lastSeenAt"].(string)
	if name == "" {
		name = "执行器"
	}
	if host == "" {
		host = "—"
	}
	if labels == "" {
		labels = "—"
	}
	if version == "" {
		version = "—"
	}
	if lastSeen == "" {
		lastSeen = "—"
	}
	icon, word := "🟢", "上线"
	if status == "offline" {
		icon, word = "🔴", "离线"
	}
	title = fmt.Sprintf("%s 执行器%s", icon, word)
	plain = fmt.Sprintf("%s 执行器%s：%s\n主机: %s\n标签: %s\n版本: %s\n心跳: %s",
		icon, word, name, host, labels, version, lastSeen)
	markdown = fmt.Sprintf("**%s 执行器%s：%s**\n主机: %s\n标签: %s\n版本: %s\n心跳: %s",
		icon, word, name, host, labels, version, lastSeen)
	return title, plain, markdown, true
}

// sendIM posts a generic text payload to an IM webhook (simplified).
func sendIM(typ string, cfg map[string]interface{}, ev Event) error {
	url, _ := cfg["webhook"].(string)
	if url == "" {
		return fmt.Errorf("%s channel missing webhook", typ)
	}
	status, _ := ev["status"].(string)
	pipeline := eventUint(ev, "pipelineId")
	repo, _ := ev["repo"].(string)
	group, _ := ev["pipelineGroup"].(string)
	image, _ := ev["imageTag"].(string)
	commit, _ := ev["commitShort"].(string)
	branch, _ := ev["branch"].(string)

	mdTitle, plainLine, mdLine, isAgent := agentEvent(ev)
	if !isAgent {
		name := repo
		if name == "" {
			name = fmt.Sprintf("流水线 #%d", pipeline)
		}
		displayName := name
		if group != "" {
			displayName = group + "/" + name
		}
		mdTitle = fmt.Sprintf("**%s %s**", statusIcon(status), displayName)
		// feishu text messages do not render markdown; keep plain lines
		plainLine = fmt.Sprintf("%s %s\n状态: %s\n流水线: #%d\n分支: %s\n镜像: %s\ncommit: %s",
			statusIcon(status), displayName, status, pipeline, branch, image, commit)
		mdLine = fmt.Sprintf("%s\n状态: %s\n流水线: #%d\n分支: %s\n镜像: %s\ncommit: %s",
			mdTitle, status, pipeline, branch, image, commit)
	}
	if deploy := deployNotificationText(ev); deploy != "" {
		plainLine += "\n" + deploy
		mdLine += "\n" + deploy
	}
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
	pipeline := eventUint(ev, "pipelineId")
	repo, _ := ev["repo"].(string)
	subject := ""
	body := ""
	if title, plain, _, isAgent := agentEvent(ev); isAgent {
		subject = "[Navori] " + title
		body = plain
	} else {
		name := repo
		if name == "" {
			name = fmt.Sprintf("流水线 #%d", pipeline)
		}
		subject = fmt.Sprintf("[Navori] %s 状态: %s", name, status)
		body = fmt.Sprintf("流水线: %s (#%d)\n状态: %s\n镜像: %v\n错误: %v", name, pipeline, status, ev["imageTag"], ev["error"])
		if deploy := deployNotificationText(ev); deploy != "" {
			body += "\n\n" + deploy
		}
	}
	msg := []byte("To: " + toRaw + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	auth := smtp.PlainAuth("", username, password, host)
	if err := smtp.SendMail(addr, auth, from, strings.Split(toRaw, ","), msg); err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

// eventUint reads a numeric event field regardless of whether it was built
// in-process (uint) or decoded from JSON (float64).
func eventUint(ev Event, key string) uint64 {
	switch v := ev[key].(type) {
	case uint:
		return uint64(v)
	case uint64:
		return v
	case int:
		return uint64(v)
	case int64:
		return uint64(v)
	case float64:
		return uint64(v)
	}
	return 0
}

// deployNotificationText formats the deploy block for IM and email channels.
func deployNotificationText(ev Event) string {
	raw, ok := ev["deploy"].(map[string]interface{})
	if !ok || len(raw) == 0 {
		return ""
	}
	text := func(key string) string {
		if v, ok := raw[key].(string); ok {
			return v
		}
		return ""
	}
	lines := []string{
		"部署: " + text("targetName"),
		"服务: " + text("name") + " (" + text("kind") + ")",
		"命名空间: " + text("namespace"),
		"执行器: " + text("executor"),
		"部署结果: " + deployStatusLabel(text("status")),
	}
	if msg := text("error"); msg != "" {
		lines = append(lines, "原因: "+msg)
	}
	return strings.Join(lines, "\n")
}

func deployStatusLabel(status string) string {
	switch status {
	case "success":
		return "成功"
	case "failed":
		return "失败"
	case "skipped":
		return "跳过"
	case "cancelled":
		return "已取消"
	case "":
		return "—"
	default:
		return status
	}
}
