# Navori — 上下文摘要

> 新会话接续：先读本文件 + AGENTS.md。

---

## 一、项目概述

Navori = 轻量 CI/CD（git 无关、单容器、分支驱动构建部署）。详见 AGENTS.md。

## 二、目录位置

工作目录 /Users/derek/code/ops/

    navori/
    ├── AGENTS.md / CONTEXT.md / DEFERRED.md
    └── docs/（DESIGN.md / RESEARCH.md / API.md / ...）

通用纪律：../ENGINEERING-DISCIPLINE.md（ops 根目录，跨项目复用）

---

## 三、当前进度

- [x] 方案 + 调研 + 数据模型 + 配置模型（DESIGN.md v2 / RESEARCH.md v2）
- [x] 改名 lightcicd → Navori
- [x] M0：API 契约 + 三件套 + 测试策略 + 里程碑
- [x] M1：骨架 + 认证（Go 单二进制 + SQLite/MySQL + JWT + 首启 bootstrap）
- [x] M2：仓库 + 触发（gitx/rules/webhook/trigger + React SPA 仓库/流水线/Dashboard 页）
- [x] M3：构建推送（tagx/buildx/registry/engine + SSE 日志 + reaper + 重跑 + 镜像仓库页/Run 详情页）
- [x] M4：部署 + 审批 + 通知（deploy/notify/deploy_targets/approval + 变量/用户 + 部署目标页/待审批页/设置页）
- [x] M5：打磨（磁盘 GC + 审计 + README/示例 + Dockerfile 多阶段构建）

## 四、UI 评审反馈处理（2026-08-14）

- [x] U1 审批按钮 loading 态 + 乐观移除 + toast
- [x] U2 namespace 移到流水线 deploy 配置，部署目标不再含 namespace 表单
- [x] U3 workload kind 下拉（Deployment/StatefulSet/DaemonSet/Job/CronJob）
- [x] U4 变量独立成导航项（/variables），设置页只留用户管理
- [x] U5 新增/编辑全部改 Modal 弹窗式（仓库/流水线/镜像仓库/部署目标/变量/用户）

## 五、UX 调研与计划调整（2026-08-17）

- [x] 完成 DevOps 流水线产品设计调研（docs/UX-RESEARCH.md）
- [x] 已按 P0/P1/P2 整合进 MILESTONES.md：M6（UX P0）/ M7（UX P1）/ M8（P2 暂缓）
- [x] M6 已完成（2026-08-18 验收）：Run 详情日志体验、审批嵌入 Run 详情、Dashboard 概览化、空状态引导、统一状态与色彩体系
- [x] 修复镜像仓库测试凭据存储问题（临时 DOCKER_CONFIG + --password-stdin）
- [x] 新增凭证管理（Git HTTPS/SSH、镜像仓库），代码仓库/镜像仓库可引用凭证（环境变量与凭证页）
- [x] 镜像仓库弹窗新增测试连接；列表新增状态灯
- [x] 代码仓库/镜像仓库表单内可直接新建凭证
- [x] 代码仓库默认分支改为扫描时自动探测
- [x] 部署环境增加测试状态显示；Toast 移到顶部
- [x] 定时任务与状态检测设计已入 DESIGN.md §9.1（待实施）
- [x] SPA history fallback 修复（刷新任意前端路由不再 404）
- [x] 流水线列表增加状态列 + 流水线详情页（运行历史）
- [x] 构建 Docker 配置隔离：DOCKER_CONFIG 指向 DATA_DIR/docker-config，移除 BUILDX_CONFIG 干扰
- [x] 验证：流水线跑通，审批通过后成功部署到集群

## 六、当前进度（2026-08-18 晚整理）

- [x] M0–M6 全部完成
- [x] M7 全部完成（M7.1 部署环境历史/回滚方向、M7.2 Run 详情 Tabs、M7.3 流水线表单、M7.4 变量分级、M7.5 列表筛选）
- [x] 流水线分组（group），作为应用/产品雏形
- [x] 定时任务 D9 状态检测、D10 cron 触发、D11 有新 commit 才跑（已完成并修复空跑问题）
- [x] 健康检测间隔可配（HEALTH_CHECK_INTERVAL）
- [x] 通知模块：通道管理 + REST/邮件/飞书/钉钉/企微；发件邮箱移到系统设置；审批/取消/拒绝/完成通知；IM markdown 格式
- [x] V1 功能面完成：M0–M7、定时任务 D9–D11、通知模块、审计查看页、取消按钮、MySQL/webhook/K8s 验证
- [x] 真实环境验证（部分）：K8s 手动验证通过；MySQL（10.8.10.102）自动迁移+CRUD 通过；webhook 出站通知 HMAC 自测通过
- [ ] 架构模块化（讨论中，见设计评审）

## 七、V1 已收官（2026-08-18）

- [x] V1 全部里程碑与功能完成（M0–M7 + 定时任务 + 通知 + 审计等）
- [x] 真实环境验证：K8s 部署（手动）、MySQL（10.8.10.102/navori_test）、webhook HMAC 自测均通过
- [ ] 遗留非阻塞：长构建中途取消实测（代码已实现，未实测）、钉钉/企业微信/邮件/SSH 部署实测（待有条件环境）

## 七A、V2 方向与接续（新会话从这里开始）

- 待办与占位符：见 DEFERRED.md（D4 SSH 部署、D5 gRPC agent、D6 多级 RBAC、D7 多实例调度、D8 导入导出、D11 定时触发深度、D16 完整审计中心）
- 领域方向：应用/分组深化为 Application 实体（版本管理、多环境、回滚）——见 DESIGN.md §18 与 UX-RESEARCH
- 架构：engine/scheduler 抽离为独立包（模块化，见 DESIGN 评审）
- 通知增强：IM 模板、审批通知已做；剩余按 DESIGN §11 P1/P2
- 技术栈：Go 1.24+ / chi / SQLite+MySQL / React+Vite+Tailwind（go:embed）

## 八、技术栈速查

Go 1.24+ / chi / SQLite(modernc.org/sqlite) + MySQL(go-sql-driver) / React + Vite + Tailwind(go:embed)
docker(podman) / kubectl / git / SSE / JWT / AES-256-GCM / HMAC-SHA256 / GORM AutoMigrate

