-- The resend_verification_email_*_count metrics are retired. Resend exposes no aggregate
-- delivery-statistics endpoint: GET /emails returns raw per-message rows with no date or tag
-- filter, and the only aggregate path Resend documents is streaming webhook events into your
-- own database, which needs an always-on receiver. Both are outside this project's data and
-- infrastructure boundaries, so the collector wrote a hardcoded zero for every one of them.
--
-- Snapshots are append-only and the read path picks the latest row per metric key, so leaving
-- these rows in place would keep showing a permanently frozen "0 emails delivered" in App
-- Detail long after the collector stopped writing them. Delete them instead.
delete from public.metric_snapshots
where metric_key in (
  'resend_verification_email_sent_count',
  'resend_verification_email_delivered_count',
  'resend_verification_email_bounced_count',
  'resend_verification_email_failed_count',
  -- Renamed to resend_domain_status_available now that the adapter only reports domain state.
  'resend_verification_email_health_available'
);
