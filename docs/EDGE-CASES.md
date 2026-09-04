# Navori 边界场景与错误码

> 状态：v1 初稿（M0）
> 配套：API.md（错误码清单 §一）

---

## 一、边界场景

| 模块 | 场景 | 处理 |
|---|---|---|
| tagx | 分支名含 /、大写、非法字符 | 清洗：小写、- 替换、去首尾 .- |
| tagx | 分支名超 60 字符 | 截断 |
| tagx | 分支名为空 | 回退 branch |
| tagx | 渲染后 tag 首字符非法 / 超 128 | E_INVALID_TAG |
| 分支规则 | glob 跨段（含 /） | ** 跨段、* 单段 |
| 分支规则 | 未写进规则的分支 push | 不触发（保守默认） |
| webhook | 同 sha 并发重复 | webhook_events 唯一约束 + 去重 |
| engine | 每流水线并发 >1 | 只留 1 in-flight，其余排队合并 |
| engine | 审批时重复 approve/reject | E_RUN_STATE（非 awaiting_approval） |
| engine | 构建中停止 | 杀进程组（Setpgid + kill）；deploy 不可中断为已知限制 |
| deploy | rollout status 超时 | 判定失败 → 非首次 rollout undo |
| notify | 目标不可达 | 3 次指数退避后记日志，不阻断 |
| 安全 | image_name 注入 | 白名单正则 |
| 安全 | shell 参数注入 | 转义审查 |
| store | sqlite 与 mysql 方言差异 | GORM AutoMigrate 统一；避免方言专属 DDL |

---

## 二、错误码触发条件

| code | 典型触发 |
|---|---|
| E_NOT_FOUND | 访问不存在的 repo/pipeline/run |
| E_UNAUTHORIZED | 未登录、token 过期、webhook token 错 |
| E_FORBIDDEN | user 访问 admin 接口、非 approver 审批 |
| E_VALIDATION | 字段缺失/类型错、glob 非法 |
| E_CONFLICT | 同名 repo/pipeline/registry |
| E_DUP_COMMIT | 同 sha 重复 webhook（非错误） |
| E_INVALID_TAG | tag 渲染非法 |
| E_CONNECT_FAILED | registry 登录失败、kubeconfig 连通失败 |
| E_RUN_STATE | 非 awaiting_approval 审批、对终态 run 停止 |
| E_INTERNAL | 未预期异常 |

