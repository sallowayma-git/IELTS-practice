# IELTS Practice Repository Threat Model

Generated: 2026-07-01

This document is the current repository-local threat model for the IELTS Practice deployment work. It is intended to guide future security fixes and reviews across unrelated changes. It does not contain `.env` values, bridge lines, client authorization contents, hidden service private keys, database dumps, or other secrets.

## Overview

IELTS Practice is a self-hosted IELTS practice application with a browser frontend, an Express backend, PostgreSQL persistence, and optional Tor onion deployment. The frontend serves IELTS reading, listening, settings, account, timer, data import/export, and admin UI assets. The backend in `backend/src/app.js` serves static assets, protected generated practice content, authentication pages, handoff routes, practice-record APIs, traffic analytics, admin APIs, and health checks.

The current production architecture separates three public entrypoints:

- Business onion: `business-tor -> business-proxy -> app:3000`
- Admin onion: `admin-tor -> admin-proxy -> app:3000`, with Tor v3 client authorization
- Auth onion: `auth-tor -> auth-proxy -> app:3000`

Business and admin do not directly host password login forms. They start an auth handoff flow through the auth onion. The auth service authenticates the user, creates a short-lived one-time handoff ticket, and the target entrypoint redeems it to create a local Express session. The app uses server-side `express-session` backed by PostgreSQL and a companion HttpOnly verifier cookie, `ielts.sv`, to reduce copied-cookie replay risk when only `ielts.sid` is stolen. Sensitive successful mutations rotate the verifier.

Important assets include:

- User accounts, password hashes, roles, and session state
- TOTP secrets, recovery codes, TOTP verification state, and admin step-up state
- Auth handoff signed state, one-time tickets, ticket verifier hashes, and public URL configuration
- Practice records, answer history, duration/correctness metrics, analytics, and admin exports
- Admin privileges and admin mutation endpoints
- PostgreSQL data and session store
- Tor hidden service volumes, client-auth public files, bridge files, WebTunnel transport assets, and onion hostnames
- Generated/static exam assets, private listening content, and user-imported data
- Deployment configuration in Docker Compose, Nginx proxy configs, and `.env`

The repository is designed for a private or small self-hosted deployment, not a hardened multi-tenant SaaS. Severity should be calibrated upward when the deployment is reachable by untrusted users over onion, LAN, or public network surfaces.

## Threat Model, Trust Boundaries, and Assumptions

Primary actors:

- Anonymous internet/onion visitor: can reach public business/auth routes, login/register pages, and any static content exposed through proxies.
- Authenticated business user: can access business practice UI and only their own practice records.
- Authenticated admin user: can access admin UI and privileged APIs only after admin role and TOTP verification.
- Operator: controls `.env`, Docker Compose overrides, proxy configs, Tor bridge/client-auth files, hidden service volumes, and backups.
- Developer: controls source, migrations, bundle generation, tests, and release/deployment scripts.
- Attacker with partial client compromise: may copy cookies, localStorage, sessionStorage, import files, or URLs from a victim browser.
- Attacker with network/proxy influence: may attempt Host or forwarded-header poisoning unless proxy configs canonicalize headers.

Main trust boundaries:

- Browser to backend: all HTTP paths, query strings, bodies, headers, cookies, and CSRF headers are attacker-controlled until validated.
- Auth onion to business/admin onion: auth handoff state and tickets cross between independent public origins and must remain audience-bound, short-lived, single-use, and tied to the initiating browser.
- Proxy to app: `Host`, `X-Forwarded-*`, and audience headers are security-sensitive. Production Nginx configs must set canonical values rather than forwarding attacker-controlled host input.
- User to own records: `/api/practice-records` must always scope reads and writes to the authenticated user.
- User/admin boundary: `/admin` and `/api/admin/*` must require admin role and TOTP state; business onion must block admin paths before they reach the app where possible.
- Auth surface boundary: auth onion should expose only login/register/TOTP/handoff APIs required for authentication, not business practice content or admin APIs.
- Static content to filesystem: Express static serving and listening/reading manifest resolution must not allow path traversal, symlink escape, dotfile exposure, hidden service key exposure, or generated content bypass.
- Frontend document to runtime state: `postMessage`, imported backup data, generated exam assets, URL route parameters, and localStorage preferences are untrusted frontend inputs.
- Backend to PostgreSQL: SQL must be parameterized and migrations must preserve role, ownership, session, and ticket invariants.
- Compose profile boundary: the legacy base `tor` service must not start in the default compose graph; split onion services are the production path.

Current assumptions:

- Production split-onion deployments provide explicit `AUTH_PUBLIC_URL`, `BUSINESS_PUBLIC_URL`, and `ADMIN_PUBLIC_URL`; blank or inferred production URLs are unsafe.
- Public URL construction must not derive callback origins from `Host` or `X-Forwarded-Host`.
- Admin onion client authorization protects network-level access to admin UI, but backend role/TOTP checks remain mandatory because client auth is not a substitute for application authorization.
- `ielts.sid` and `ielts.sv` together are still bearer-like credentials. The current verifier design narrows partial-cookie replay and rotates after selected sensitive mutations, but a copied full cookie jar remains a residual risk until a stronger session registry/security-epoch design is implemented.
- Operator-managed secrets and backups are out of source control and must not be printed in logs, terminal output, docs, commits, or support transcripts.

## Attack Surface, Mitigations, and Attacker Stories

Authentication and session management are centered in `backend/src/auth.js`, `backend/src/authHandoff.js`, `backend/src/totp.js`, and session middleware in `backend/src/app.js`. Relevant attacker stories include credential stuffing, CSRF, login CSRF, TOTP replay, auth handoff ticket reuse, poisoned callback origins, copied-cookie replay, and account-type confusion between business and admin flows.

Existing mitigations include bcrypt password hashing, password validation, session regeneration on login/register/account-sensitive changes, CSRF tokens for mutations, signed auth handoff state, one-time ticket storage with hashed tokens, audience and return-path checks, public URL validation, exact proxy audience headers, TOTP verification and replay controls, and the HttpOnly `ielts.sv` verifier cookie. Sensitive TOTP and admin mutations rotate `ielts.sv`.

Authorization is centered in `backend/src/admin.js`, `backend/src/practiceRecords.js`, `backend/src/app.js`, and the proxy allowlists. Relevant attacker stories include normal users reaching `/api/admin/*`, admins bypassing TOTP, users reading or deleting another user's records, business onion exposing admin routes, auth onion exposing account-management or practice APIs, and role confusion during auth handoff.

Existing mitigations include `requireAuth`, `requireAdmin`, `requireAdminTotp`, user-scoped SQL predicates, admin route blocking at business/auth proxies, admin-proxy allowlisting, auth-proxy blocking of account-management API exposure, last-admin protection, role checks during handoff, and backend regression tests around these route boundaries.

Static file and practice content serving are attack surfaces because exam assets, generated JS, listening pages, and templates are loaded by URL. Relevant attacker stories include direct unauthenticated access to generated exam assets, URL guessing, path traversal, serving dotfiles/secrets, symlink escape, or using legacy listening pages to bypass auth.

Existing mitigations include authenticated wrappers for protected reading/listening routes, resource URL guards, manifest-based listening route resolution, static boundary middleware, dotfile and null-byte denial, realpath containment checks, and route tests that unauthenticated protected content returns an auth error rather than serving the exercise.

Frontend/browser surfaces include localStorage preferences, data import/export, admin/business UI state, timers, postMessage bridges, generated exam assets, and copied browser storage. Relevant attacker stories include XSS through imported data or generated content, malicious `postMessage` payloads, corrupt backup import, open external links, and URL route manipulation.

Existing mitigations include guard tests for resource URLs, local data rendering, message-origin behavior, listening record bridge URLs, and route shortening. Backend CSP and proxy allowlists reduce exposure, but legacy exercise pages and generated content still require careful review when template or bundle behavior changes.

Deployment and onion networking are attack surfaces because a small config mistake can bypass intended boundaries. Relevant attacker stories include accidentally starting the legacy base `tor` service, publishing PostgreSQL or Tor control ports, losing hidden service volumes, leaking bridge lines or private keys, trusting attacker-controlled forwarded headers, or exposing business/admin/auth surfaces through the wrong proxy.

Existing mitigations include loopback-only app port binding, no host ports on postgres/proxy/tor in production overrides, separate hidden service volumes for business/admin/auth, explicit profile gating of the base `tor` service behind `legacy-onion`, WebTunnel transport mounted into the Tor image, and canonical Nginx forwarded host/proto/audience headers.

Data and backup surfaces include PostgreSQL dumps, hidden service volume archives, bridge files, `.env`, client auth public files, and generated deployment backups. Relevant attacker stories include accidental secret printing, unsafe backup permissions, committing runtime artifacts, or restoring a hidden service into the wrong volume.

Existing mitigations include `.gitignore` coverage for local bridge files, transports, hidden service backups, dumps, SQL archives, and client auth files; backup procedures list filenames and sizes only; and operational runbooks avoid `docker compose down -v`, volume deletion, or printing secrets.

## Severity Calibration (Critical, High, Medium, Low)

Critical findings:

- Any unauthenticated or normal-user path to `/api/admin/*`, admin exports, user management, role changes, or admin account takeover.
- Forging or replaying auth handoff state/tickets to create a business or admin session for another user.
- Host or forwarded-header poisoning that causes tickets, callbacks, or session cookies to be sent to an attacker-controlled origin.
- Arbitrary file read or static serving of `.env`, hidden service private keys, bridge files, TOTP secrets, session secrets, database credentials, or backups.
- Remote code execution in backend request handling, build/deployment scripts used in production, or unsafe restore flows.
- Production compose behavior that starts a legacy Tor path bypassing split business/auth/admin onion boundaries.

High findings:

- Full cookie-jar replay that materially extends account takeover windows, especially for admin sessions.
- CSRF bypass for account, TOTP, admin, record deletion, export, or site-content mutation endpoints.
- Horizontal authorization bugs allowing one user to read, modify, export, or delete another user's practice records.
- Stored or reflected XSS that can steal session state, perform admin actions, or alter practice/account data.
- SQL injection in auth, admin, analytics, export, practice-record, or handoff-ticket paths.
- Proxy allowlist mistakes that expose `/api/admin/*` through business/auth onion or expose practice content through auth onion.

Medium findings:

- Denial of service from oversized JSON/import/export/analytics payloads that bypass request or schema limits.
- Weak rate limiting around login, TOTP, admin mutation, export, or traffic analytics endpoints.
- Sensitive metadata leakage in analytics/export responses without direct account takeover.
- Frontend data-integrity issues that require a user to import malicious local files into their own browser.
- CSP gaps in legacy pages where no practical session theft or privileged action path is demonstrated.
- Deployment documentation ambiguity that could lead to unsafe operator choices but does not itself change runtime behavior.

Low findings:

- Local-only developer tooling issues without production invocation.
- Minor error-message information disclosure that does not reveal secrets, user existence in a meaningful way, or authorization state beyond expected 401/403 semantics.
- Cosmetic UI/security-copy inconsistencies that do not affect route guards, auth flow, or data exposure.
- Stale generated or test-only assets that are not reachable in production and do not contain secrets.

Future security work should prioritize the remaining bearer-like full-cookie-jar replay risk. The recommended next design direction is a server-side session registry with active/revoked session state, audience binding, and user security epochs, followed by admin step-up freshness for high-risk operations. This should be done before larger proof-of-possession or client-bound cryptographic designs.
