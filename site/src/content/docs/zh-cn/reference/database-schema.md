---
title: 数据库结构
description: StackVitals 使用的 Supabase Postgres 数据库结构概述。
---

StackVitals 使用 Supabase Postgres，迁移文件按编号顺序从 `supabase/migrations/*.sql` 应用。

## 核心表

| 表 | 用途 |
|---|---|
| `projects` | 每个被跟踪的应用一行，以自由格式的 `slug` 为键，与采集器配置匹配 |
| `providers` | 提供商注册表——`aws`、`amplify`、`supabase`、`resend`、`openai`、`github`、`cloudflare` |
| `resources` | 提供商资源——部署、域名、数据库、API 账户等 |
| `metric_snapshots` | 状态、计数、使用量、延迟和部署状态的时间序列 |
| `cost_snapshots` | 按提供商/服务的每日或每月成本；默认为账户级别 |
| `health_checks` | 正常运行时间、HTTP 状态、响应时间和最后成功检查 |
| `collector_runs` | 每次采集运行的审计跟踪，包括错误 |
| `dashboard_users` | 用于 RLS 访问控制的邮箱允许列表 |

## 关键设计决策

### 追加写入快照

`metric_snapshots`、`cost_snapshots` 和 `health_checks` 是追加写入的。读取层按逻辑键取最新值，而非就地更新。这样可以保留历史记录并避免更新冲突。

### 账户级别成本

成本行保持在账户级别（`project_id` 为 null），除非采集器能将成本映射到特定项目。仪表盘不会猜测项目级别的成本拆分。

### 提供商 slug

`projects.slug` 是自由格式的字符串，必须与 `projects.config.json` 中的 slug 匹配。`providers.key` 映射到 TypeScript 类型 `ProviderKey`。新的提供商键总是与其采集器适配器一起添加，不会提前添加。

### 项目范围的资源

资源标识包含 `project_id`，因此同一物理提供商资源可以出现在多个已配置项目中。账户级资源继续以 null 项目保持唯一。

### RLS

行级安全策略将所有读取限制为邮箱出现在 `dashboard_users` 中的已认证用户。这是持久的数据边界——前端邮箱允许列表（`VITE_DASHBOARD_ALLOWED_EMAIL`）是额外的关卡，不是替代品。

## 迁移

迁移按编号顺序从 `supabase/migrations/` 应用：

1. 核心 schema（projects、providers、resources、snapshots、health checks、collector runs）
2. Dashboard users 表 + RLS 策略
3. 注册 GitHub Actions 提供商
4. 从零启动本地 Supabase 环境所需的数据表权限
5. 可选的项目卡片排序字段
6. 删除未使用的成本归属字段
7. 支持 30 天历史视图的时间戳索引
8. 删除已停用的 Resend 投递指标
9. 为本地或显式配置的数据库授予快照保留所需的删除权限
10. 将资源标识限定到项目，使同一提供商资源可以出现在多个项目中

在开发过程中运行 `npm run db:reset` 可以从头重新应用所有迁移和种子数据。
现有安装应按顺序应用所有较新的迁移。迁移 008 删除已停用的 Resend 数据行，009 启用保留期清理，010 避免共享提供商资源在多个已配置项目之间发生冲突。
