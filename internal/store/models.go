package store

import "time"

// User is an account with an admin|user role.
type User struct {
	ID           uint   `gorm:"primaryKey"`
	Username     string `gorm:"size:64;uniqueIndex;not null"`
	PasswordHash string `gorm:"size:255;not null"`
	Role         string `gorm:"size:16;not null;default:user"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Registry is an OCI image registry target.
type Registry struct {
	ID              uint   `gorm:"primaryKey"`
	Name            string `gorm:"size:64;uniqueIndex;not null"`
	URL             string `gorm:"size:255;not null"`
	Username        string `gorm:"size:64"`
	PasswordEnc     string `gorm:"type:text"`
	CredentialID    uint
	Namespace       string `gorm:"size:64"`
	InsecureSkipTLS bool   `gorm:"not null;default:false"`
	IsDefault       bool   `gorm:"not null;default:false"`
	LastTestStatus  string `gorm:"size:16"`
	LastTestAt      *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// DeployTarget is a deployment environment (k8s now, ssh in v2).
type DeployTarget struct {
	ID               uint   `gorm:"primaryKey"`
	Name             string `gorm:"size:64;uniqueIndex;not null"`
	Type             string `gorm:"size:16;not null;default:k8s"`
	KubeconfigEnc    string `gorm:"type:text"`
	SSHEnc           string `gorm:"type:text"`
	DefaultNamespace string `gorm:"size:64"`
	IsDefault        bool   `gorm:"not null;default:false"`
	LastTestStatus   string `gorm:"size:16"`
	LastTestAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// GitCredential holds credentials for cloning repositories.
type GitCredential struct {
	ID        uint   `gorm:"primaryKey"`
	Name      string `gorm:"size:64;uniqueIndex;not null"`
	Type      string `gorm:"size:16;not null;default:https"`
	Username  string `gorm:"size:64"`
	SecretEnc string `gorm:"type:text"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository is a git source to build from.
type Repository struct {
	ID             uint   `gorm:"primaryKey"`
	Name           string `gorm:"size:64;uniqueIndex;not null"`
	GitURL         string `gorm:"size:512;not null"`
	CredentialID   uint
	DefaultBranch  string `gorm:"size:128;not null;default:main"`
	DockerfilePath string `gorm:"size:256;not null;default:Dockerfile"`
	BuildContext   string `gorm:"size:256;not null;default:."`
	ScanStatus     string `gorm:"size:16;not null;default:pending"`
	ScanMessage    string `gorm:"size:512"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Pipeline is a one-repo build/deploy pipeline.
type Pipeline struct {
	ID              uint   `gorm:"primaryKey"`
	RepoID          uint   `gorm:"uniqueIndex;not null"`
	ConfigJSON      string `gorm:"type:text"`
	BranchRulesJSON string `gorm:"type:text"`
	NotifyJSON      string `gorm:"type:text"`
	WebhookToken    string `gorm:"size:64"`
	Group           string `gorm:"size:64"`
	Schedule        string `gorm:"size:128"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Run is one pipeline execution.
type Run struct {
	ID                 uint   `gorm:"primaryKey"`
	PipelineID         uint   `gorm:"index;not null"`
	Number             int    `gorm:"not null"`
	TriggerType        string `gorm:"size:16;not null"`
	Ref                string `gorm:"size:256"`
	Commit             string `gorm:"size:64"`
	Status             string `gorm:"size:32;not null;default:pending"`
	ImageTag           string `gorm:"size:256"`
	ConfigSnapshotJSON string `gorm:"type:text"`
	ApprovalRequired   bool   `gorm:"not null;default:false"`
	ApprovedBy         string `gorm:"size:64"`
	ApprovedAt         *time.Time
	RejectedReason     string `gorm:"size:512"`
	LogDir             string `gorm:"size:256"`
	Error              string `gorm:"size:1024"`
	StartedAt          *time.Time
	FinishedAt         *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Step is one phase of a Run (pull/build/push/approve/deploy).
type Step struct {
	ID         uint   `gorm:"primaryKey"`
	RunID      uint   `gorm:"index;not null"`
	StepOrder  int    `gorm:"not null"`
	Name       string `gorm:"size:16;not null"`
	Status     string `gorm:"size:16;not null;default:pending"`
	LogFile    string `gorm:"size:256"`
	StartedAt  *time.Time
	FinishedAt *time.Time
}

// Variable is a global key-value usable in tag templates via {var.KEY}.
type Variable struct {
	ID          uint   `gorm:"primaryKey"`
	Key         string `gorm:"size:64;uniqueIndex;not null"`
	ValueEnc    string `gorm:"type:text"`
	Secret      bool   `gorm:"not null;default:false"`
	Description string `gorm:"size:255"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// WebhookEvent dedupes inbound webhooks by commit digest.
type WebhookEvent struct {
	ID            uint   `gorm:"primaryKey"`
	PipelineID    uint   `gorm:"index;not null"`
	PayloadDigest string `gorm:"size:128;uniqueIndex;not null"`
	CreatedAt     time.Time
}

// AuditLog records write operations (including approvals).
type AuditLog struct {
	ID        uint   `gorm:"primaryKey"`
	Username  string `gorm:"size:64"`
	Action    string `gorm:"size:64;not null"`
	Target    string `gorm:"size:255"`
	CreatedAt time.Time
}

// NotifyChannel is a reusable notification destination (REST/email/IM).
type NotifyChannel struct {
	ID         uint   `gorm:"primaryKey"`
	Name       string `gorm:"size:64;uniqueIndex;not null"`
	Type       string `gorm:"size:16;not null"` // rest | email | feishu | dingtalk | wecom
	ConfigJSON string `gorm:"type:text"`        // encrypted config
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// AppConfig holds single-row application settings (e.g. global SMTP).
type AppConfig struct {
	ID        uint   `gorm:"primaryKey"`
	SMTPEnc   string `gorm:"type:text"` // encrypted SMTP config JSON
	UpdatedAt time.Time
}
