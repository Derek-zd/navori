package api

import (
	"log"

	"navori/internal/notify"
	"navori/internal/store"
)

// notifyAgentStatus sends an executor online/offline event to every channel
// explicitly marked for system alerts. It runs asynchronously so a slow SMTP
// or IM endpoint never delays heartbeat/hello handling.
func (s *Server) notifyAgentStatus(a *store.Agent, status string) {
	if a == nil {
		return
	}
	var chans []store.NotifyChannel
	if err := s.DB.DB.Where("system_alerts = ?", true).Find(&chans).Error; err != nil {
		log.Printf("agent alert: load channels: %v", err)
		return
	}
	if len(chans) == 0 {
		return
	}
	ev := notify.Event{
		"event":       "agent." + status,
		"status":      status,
		"agentId":     a.ID,
		"agentName":   a.Name,
		"agentLabels": a.Labels,
		"hostname":    a.Hostname,
		"version":     a.Version,
		"lastSeenAt":  timeStr(a.LastSeenAt),
	}
	for _, ch := range chans {
		cfg := s.decryptChannelConfig(ch.ConfigJSON)
		if ch.Type == "email" {
			smtp := s.smtpConfig()
			to, _ := cfg["to"].(string)
			merged := map[string]interface{}{}
			for k, v := range smtp {
				merged[k] = v
			}
			merged["to"] = to
			cfg = merged
		}
		channelType := ch.Type
		s.sendWithRetry(ev, func() error { return notify.SendChannel(channelType, cfg, ev) })
	}
}
