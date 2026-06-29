CREATE TABLE IF NOT EXISTS site_content_settings (
    key text PRIMARY KEY CHECK (key IN ('login_notice', 'home_banner')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_content_settings (key, payload)
VALUES
    ('login_notice', '{"enabled": false, "title": "Welcome back", "body": "You are signed in. Your practice records will sync with this account.", "ctaLabel": "Continue", "ctaHref": ""}'::jsonb),
    ('home_banner', '{"enabled": false, "title": "Announcement", "body": "Use this space for important study updates.", "ctaLabel": "", "ctaHref": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
