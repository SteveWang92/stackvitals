---
title: 概述
description: StackVitals 是什么，它能做什么。
---

StackVitals 是一个轻量级、自托管的运维仪表盘，专为独立开发者的 Web 项目设计。它可以展示正常运行时间、部署状态、提供商状态、域名健康、当月云成本和 AI/CI 使用情况——而不会从被监控的应用中复制原始数据。

## 两个组成部分

1. **采集器** — Node 脚本调用外部提供商 API（AWS、Supabase、OpenAI、GitHub、Cloudflare、Resend），并将追加写入的快照存入你的 Supabase 数据库。它们通过 GitHub Actions 定时运行，不在浏览器中执行。
2. **仪表盘** — 一个静态 React/Vite 前端，从 Supabase 读取预聚合的数据行，并通过多标签页视图呈现。

两者都在同一个代码仓库中。没有常驻服务。

## 监控内容

每个适配器都是可选的——只有在提供了相应凭证时才会激活。你可以只启用需要的适配器：

| 适配器 | 采集内容 |
|---|---|
| HTTP 健康检查 | 公共 URL 的可用性和响应时间 |
| Amplify | 部署状态、分支、最新构建 |
| AWS Cost Explorer | 按 AWS 服务划分的账户级当月/上月成本 |
| AWS 应用后端 | Cognito 用户池可用性/用户估算值，以及 DynamoDB 表状态/条目数/大小 |
| Supabase 项目健康 | 仪表盘自身项目或被监控应用的可达性 |
| 被监控应用 Supabase 聚合 | 通过自定义 RPC 获取的仅计数聚合统计 |
| Resend | 发送域名验证状态 |
| OpenAI 使用量 | Token 总数、请求次数、缓存 Token、按 Key/模型的花费 |
| GitHub Actions | 工作流运行次数、最新状态、持续时间和可选的部署工作流状态 |
| Cloudflare Pages | 最新生产部署状态 |
| Cloudflare 域名 | Zone 状态、DNS 记录数、注册商过期信息 |

完整信息请参阅[适配器参考](/zh-cn/reference/adapters/)。

## 单用户设计

这不是多租户系统。它专为一个人管理多个项目而设计。访问控制有两层：前端检查登录邮箱是否在允许列表中，Supabase RLS 独立限制只有 `dashboard_users` 中的认证邮箱才能读取数据。

## 数据安全

只采集聚合的运维信号——状态、计数、持续时间、成本。被监控应用的原始用户数据、请求内容、消息体和数据表转储永远不会进入此工具。每个被监控应用的凭证仅用于调用该应用自身项目中的仅计数 RPC。

## 下一步

准备好搭建自己的实例了吗？请参阅[自托管指南](/zh-cn/getting-started/self-hosting/)。
