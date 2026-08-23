---
title: 适配器
description: 所有支持的采集器适配器的完整参考——采集内容、所需凭证和最小权限。
---

适配器由凭据控制启用，因此一个仅有项目配置的全新 clone 只会运行 HTTP 健康检查适配器。AWS 凭据默认启用 Cost Explorer；如果凭据不包含成本读取权限，请使用下文的配置开关将其关闭。

## 适配器参考

| 适配器 | 采集内容 | 凭证 | 最小权限 |
|---|---|---|---|
| HTTP 健康检查 | 公共 URL 的可用性和响应时间 | 无（只需项目的公共 URL） | — |
| Amplify | 部署状态、分支、最新构建 | AWS access key/secret、region | 只读 Amplify 访问 |
| AWS Cost Explorer | 按 AWS 服务划分的账户级当月/上月成本 | AWS access key/secret、region | 只读 Cost Explorer 访问 |
| AWS 应用后端 | Cognito 用户池可用性/用户估算值，以及 DynamoDB 表状态/条目数/大小 | AWS access key/secret、资源 ID、可选 region | 对已配置资源的 `cognito-idp:DescribeUserPool` 和 `dynamodb:DescribeTable` |
| Supabase 项目健康 | 仪表盘自身项目或被监控应用的可达性 | Supabase 项目 URL + service-role key | 项目范围的 service-role key |
| 被监控应用 Supabase 聚合 | 通过自定义 RPC 获取的仅计数聚合统计 | 应用的 Supabase URL、anon key、service-role key、RPC 名称 | Service-role key（仅计数 RPC——从不读取原始数据） |
| Resend | 发送域名验证状态 | Resend API key | 只读 API key |
| OpenAI 使用量 | Token 总数、请求次数、缓存 Token、按 Key/模型的花费 | OpenAI admin API key | Admin key（使用量端点需要） |
| GitHub Actions | 工作流运行次数、最新状态、分支、持续时间和可选部署状态 | 仓库 `owner/repo` 映射 + 读取 token | Actions: read |
| Cloudflare Pages | 最新生产部署状态 | Cloudflare API token + account ID | 对 Pages 的只读账户访问 |
| Cloudflare 域名 | Zone 状态、DNS 记录数、apex/www/MX、注册商过期信息 | Cloudflare API token、可选 account ID | 只读 token（范围限定为 zones/DNS） |

## 适配器详情

### HTTP 健康检查

探测你项目的公共 URL。不需要凭证——只需在项目配置中设置 `publicUrl`。当公共 URL 位于 Cloudflare Bot Fight Mode 后面时，可以选择使用 `resources.healthCheckUrl` 覆盖。

自定义请求头（`HTTP_HEALTH_CHECK_HEADER_NAME` / `HTTP_HEALTH_CHECK_HEADER_VALUE`）可用于通过 WAF Skip 规则绕过 Super Bot Fight Mode（Pro 计划）。Free 计划的 Bot Fight Mode 无法通过此方式绕过——请改用非 Cloudflare URL 进行健康检查。

### Amplify

从 AWS Amplify 读取部署状态。需要一个具有只读 Amplify 访问权限的 IAM 用户或角色。配置字段：`resources.amplifyAppId`、`resources.amplifyBranchName`，region 通过 `AWS_REGION` 设置。

### AWS Cost Explorer

采集按 AWS 服务划分的账户级当月和上月成本。成本保持在账户级别（`project_id` 为 null）——仪表盘不会猜测项目级别的拆分。

提供 AWS 凭据时默认启用。如果这些凭据刻意不包含 Cost Explorer 权限，请设置
`"aws": { "costExplorerEnabled": false }`。

### AWS 应用后端

为使用 Cognito 和 DynamoDB 作为身份认证及数据层的应用读取聚合元数据。配置
`resources.cognitoUserPoolId`、`resources.dynamoDbTables`，并可选配置
`resources.awsBackendRegion`。该适配器只调用 `DescribeUserPool` 和 `DescribeTable`，从不列出用户或读取表内项目。

### Supabase 项目健康

检查 Supabase 项目的可达性。对于仪表盘自身的项目，在配置中设置 `"hubSupabase": true`。对于被监控的应用，提供其项目 URL 和 service-role key。

### 被监控应用 Supabase 聚合

调用你在被监控应用自身 Supabase 项目中定义的仅计数聚合 RPC。参见仓库中的 `docs/examples/app-aggregate-rpc.sql` 示例 RPC。采集器从不读取原始表——只使用 RPC 的聚合输出。

### Resend

检查发送域名验证状态。

**不采集**投递量的聚合统计，并且没有相关计划。Resend 没有提供任何分析或统计端点：`GET /emails` 返回的是逐条消息的原始记录（收件人地址、主题），且不支持按日期或标签过滤，因此统计投递量意味着要翻遍整个账户的发送历史，并读取本工具承诺永不接触的那类数据。Resend 文档中唯一的聚合方案是把 webhook 事件流式写入你自己运行的数据库，这需要一个常驻的接收端。两者都与本项目的非目标冲突。

### OpenAI 使用量

采集 Token 总数、请求次数、缓存 Token 数和按 API key 及模型的花费。需要 admin API key。配置中可选的 `apiKeyLabels` 为 key ID 提供显示名称。

### GitHub Actions

采集工作流运行次数、最新状态/结论、触发类型、分支和持续时间总计。对采集器自身的仓库使用内置的 `GITHUB_TOKEN`；私有跨仓库采集需要具有 Actions read 权限的 PAT。运行时长由运行持续时间推导，不使用 GitHub 计费端点。

将 `resources.githubRepository` 设置为 `owner/repo`。如需把某个工作流作为项目的部署状态，请将 `resources.githubDeployWorkflow` 设置为该工作流的文件名，例如 `deploy-site.yml`。将 `resources.githubActionsEnabled` 设置为 `false` 可停止采集已映射仓库的 GitHub 数据。

### Cloudflare Pages

将 `resources.cloudflarePagesProject` 设置为 Pages 项目名称。提供 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 后，采集器会报告最新的生产部署，并排除预览部署。

### Cloudflare 域名

采集 zone 状态、DNS 记录数、apex/www/MX 存在性、代理记录数、注册商名称和过期天数。域名组可以省略 `projectSlug` 以保持在账户级别。Account ID 可在可用时启用注册商过期信息查询。
