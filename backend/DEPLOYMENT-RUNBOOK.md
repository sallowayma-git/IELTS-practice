# Onion Deployment Runbook

This runbook records operational rules for the IELTS-practice business,
admin, and auth onion deployment.

## Hard Rules

- Do not run `docker compose down -v`.
- Do not delete `business_tor_hidden_service`, `admin_tor_hidden_service`, or
  `auth_tor_hidden_service` volumes.
- Do not delete onion hostname files.
- Do not open host ports.
- Do not modify UFW, SSH, netplan, router, or host firewall rules.
- Do not print `.env`, bridge lines, client auth files, hidden service private
  keys, or database contents.
- Production split-onion deployment must not start the base `tor` service from
  `backend/docker-compose.yml`. That service is legacy/dev only and must require
  the explicit `--profile legacy-onion` profile.

## Proxy And Tor Recreate Rule

If an onion proxy container is recreated, force-recreate the matching Tor
container after the proxy is healthy.

Reason: Tor's `HiddenServicePort` target is configured as a Docker service
name, such as `business-proxy:80`, `admin-proxy:80`, or `auth-proxy:80`.
When Docker recreates a proxy container, the proxy can receive a new container
IP. A running Tor process can keep using the previously resolved target. The
symptom is cross-onion routing, for example business onion traffic reaching
`auth-proxy`, or auth onion traffic reaching `business-proxy`.

Required pairs:

- `business-proxy` changed or recreated -> recreate `business-tor`
- `admin-proxy` changed or recreated -> recreate `admin-tor`
- `auth-proxy` changed or recreated -> recreate `auth-tor`

Recreate only the matching Tor container. Do not delete volumes.

## App-Only Deployment

If only app code or static assets changed:

1. Back up changed target files.
2. Build/load `backend-app:latest`.
3. Recreate only `app`.
4. Verify:
   - `curl -s http://127.0.0.1:3000/api/health`
   - onion hostnames unchanged
   - host ports still only `127.0.0.1:3000`

Proxy/Tor recreation is not required for app-only changes.

## Legacy Base Tor Service

The base `tor` service in `backend/docker-compose.yml` is not part of the
production split-onion deployment. It is retained only for legacy/dev use and is
gated behind the explicit `legacy-onion` profile.

Default compose service checks must not include `tor`:

```sh
docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  config --services
```

Expected default services include `postgres` and `app`, but not `tor`.

To inspect or run the legacy service manually, opt in explicitly:

```sh
docker compose --profile legacy-onion \
  --env-file backend/.env \
  -f backend/docker-compose.yml \
  config --services
```

The split business, admin, and auth onion services are separate and continue to
use their own `business-onion`, `admin-onion`, and `auth-onion` profiles.

## Proxy Deployment

If any of these files changed:

- `backend/business-proxy/nginx.conf`
- `backend/admin-proxy/nginx.conf`
- `backend/auth-proxy/nginx.conf`

Then:

1. Back up the proxy config.
2. Recreate the changed proxy with `--no-deps --force-recreate`.
3. Wait for the proxy container to be running.
4. Recreate the matching Tor container with `--no-deps --force-recreate`.
5. Wait for `Bootstrapped 100% (done): Done`.
6. Verify the onion hostname is unchanged.

## Compose Examples

Business proxy change:

```sh
docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.business-onion.override.yml \
  --profile business-onion \
  up -d --no-deps --force-recreate business-proxy

docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.business-onion.override.yml \
  --profile business-onion \
  up -d --no-deps --force-recreate business-tor
```

Auth proxy change:

```sh
docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.auth-onion.override.yml \
  --profile auth-onion \
  up -d --no-deps --force-recreate auth-proxy

docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.auth-onion.override.yml \
  --profile auth-onion \
  up -d --no-deps --force-recreate auth-tor
```

Admin proxy change:

```sh
docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.admin-onion.override.yml \
  --profile admin-onion \
  up -d --no-deps --force-recreate admin-proxy

docker compose --env-file backend/.env \
  -f backend/docker-compose.yml \
  -f backend/docker-compose.prod.override.yml \
  -f backend/docker-compose.admin-onion.override.yml \
  --profile admin-onion \
  up -d --no-deps --force-recreate admin-tor
```

## Required Verification

After any proxy/Tor deployment:

```sh
curl -s http://127.0.0.1:3000/api/health

docker logs --tail=120 ielts-practice-business-tor | grep 'Bootstrapped 100%.*Done' || true
docker logs --tail=120 ielts-practice-admin-tor | grep 'Bootstrapped 100%.*Done' || true
docker logs --tail=120 ielts-practice-auth-tor | grep 'Bootstrapped 100%.*Done' || true

docker exec ielts-practice-business-tor sh -lc 'cat /var/lib/tor/hidden_service/hostname'
docker exec ielts-practice-admin-tor sh -lc 'cat /var/lib/tor/admin_hidden_service/hostname'
docker exec ielts-practice-auth-tor sh -lc 'cat /var/lib/tor/auth_hidden_service/hostname'

ss -ltnp | grep -E ':3000|:5432|:55432|:9050|:9051|:80|:443' || true
```

Expected:

- app health returns `{"ok":true}`
- each affected Tor container shows `Bootstrapped 100% (done): Done`
- onion hostnames are unchanged
- host ports expose only `127.0.0.1:3000`
- no host listeners on `5432`, `55432`, `9050`, `9051`, `80`, or `443`

## Manual Smoke Tests

Business onion:

- `/` loads the business app.
- unauthenticated login goes to the auth onion, not business `/auth/login`.
- `/admin` and `/api/admin` remain blocked.

Auth onion:

- `/` redirects to `/auth/login`.
- business login flow uses `/auth/business/login?state=...`.
- admin login flow uses `/auth/admin/login?state=...`.

Admin onion:

- client authorization is still required.
- unauthenticated `/admin` starts the admin auth flow.
- ordinary learner accounts cannot complete the admin flow.
