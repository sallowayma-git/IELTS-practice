const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const otp = require('otplib');
const session = require('express-session');

const { createApp } = require('../src/app');
const { MemoryAuthStore, PostgresAuthStore, createRateLimiter, normalizeRateLimitKey } = require('../src/auth');
const { MemoryAuthHandoffStore } = require('../src/authHandoff');
const { MemoryAdminStore, PostgresAdminStore, createTrafficMiddleware, normalizeAdminSearchQuery, normalizeTrafficEvent, serializeRecord } = require('../src/admin');
const { bootstrapAdmin } = require('../src/bootstrapAdmin');
const { runMigrations } = require('../src/migrations');
const { MemoryPracticeRecordStore, extractColumns, mergePracticeRecords, normalizePracticeRecord } = require('../src/practiceRecords');
const { MemoryTotpStore, PostgresTotpStore } = require('../src/totp');

test('docker image hardening excludes secrets and runs app as non-root', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'backend', 'Dockerfile'), 'utf8');
    const torDockerfile = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'Dockerfile'), 'utf8');
    const appSource = fs.readFileSync(path.join(repoRoot, 'backend', 'src', 'app.js'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    const compose = fs.readFileSync(path.join(repoRoot, 'backend', 'docker-compose.yml'), 'utf8');
    const encryptedBridgeCompose = fs.readFileSync(path.join(repoRoot, 'backend', 'docker-compose.bridges-encrypted.yml'), 'utf8');
    const envExample = fs.readFileSync(path.join(repoRoot, 'backend', '.env.example'), 'utf8');
    const bridgesTemplate = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'bridges.txt'), 'utf8');
    const bridgesPlaceholder = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'bridges.placeholder.txt'), 'utf8');
    const torEntrypoint = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'docker-entrypoint.sh'), 'utf8');
    const siteHealthWatcher = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'watch-site-health.ps1'), 'utf8');
    const bridgeTester = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'test-obfs4-bridges.ps1'), 'utf8');
    const bridgeEncryptor = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'encrypt-tor-bridges.ps1'), 'utf8');
    const healthLogRedactor = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'redact-site-health-logs.ps1'), 'utf8');
    const smokePostgres = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'smoke-postgres.mjs'), 'utf8');

    assert.match(dockerfile, /^FROM node:24-alpine/m);
    assert.doesNotMatch(dockerfile, /^FROM node:20-alpine/m);
    assert.match(dockerfile, /\nUSER node\s*\n/);
    for (const pattern of ['.git', 'backend/.env', 'backend/.env.*', 'backend/logs', 'backend/node_modules', 'backend/tor/bridges.local.txt', 'backend/tor/bridges.age', 'backend/tor/bridge-age-identity.txt', 'backend/tor/bridge.identity', 'backend/tor/bridge.pub', 'backend/tor/*.identity', 'backend/tor/*.pub', 'backend/tor/*.agekey', 'ListeningPractice']) {
        assert(
            dockerignore.split(/\r?\n/).includes(pattern),
            `.dockerignore must exclude ${pattern}`
        );
    }
    assert(dockerignore.split(/\r?\n/).includes('!backend/migrations/*.sql'));
    assert(dockerignore.split(/\r?\n/).includes('backend/tor/bridges.age.tmp-*'));
    assert(gitignore.split(/\r?\n/).includes('backend/logs/'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridges.local.txt'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridges.age'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridges.age.tmp-*'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridge-age-identity.txt'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridge.identity'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridge.pub'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/*.identity'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/*.pub'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/*.agekey'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/admin-authorized-clients/*.auth'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/admin_hidden_service/'));
    assert(gitignore.split(/\r?\n/).includes('backend/tor/auth_hidden_service/'));
    assert(gitignore.split(/\r?\n/).includes('*admin_tor_hidden_service*'));
    assert(gitignore.split(/\r?\n/).includes('*auth_tor_hidden_service*'));
    assert(gitignore.split(/\r?\n/).includes('!backend/migrations/*.sql'));
    assert(torDockerfile.includes('apt-get install -y --no-install-recommends age ca-certificates obfs4proxy tor'));
    assert(compose.includes('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?'));
    assert(compose.includes('PGPASSWORD: ${POSTGRES_PASSWORD:?'));
    assert(compose.includes('postgres_data:/var/lib/postgresql/data'));
    assert(compose.includes('postgres_data:'));
    assert.equal((compose.match(/restart: unless-stopped/g) || []).length, 3);
    assert(!compose.includes(':-postgres'));
    assert(!compose.includes('POSTGRES_PASSWORD: postgres'));
    assert(!compose.includes('postgres://postgres:postgres@postgres'));
    assert(!compose.includes('TOR_BRIDGES:'));
    assert(compose.includes('TOR_BRIDGES_LOCAL_FILE'));
    assert(compose.includes('source: ${TOR_BRIDGES_LOCAL_FILE:-./tor/bridges.placeholder.txt}'));
    assert(compose.includes('TOR_BRIDGES_ENCRYPTED_FILE'));
    assert(compose.includes('TOR_BRIDGES_AGE_IDENTITY_FILE'));
    assert(compose.includes('target: /etc/tor/bridges.local.txt'));
    assert(compose.includes('/run/tor:rw,noexec,nosuid,nodev,size=1m,mode=750'));
    assert(encryptedBridgeCompose.includes('TOR_BRIDGES_ENCRYPTED_FILE: /run/secrets/tor_bridges_encrypted'));
    assert(encryptedBridgeCompose.includes('TOR_BRIDGES_AGE_IDENTITY_FILE: /run/secrets/tor_bridge_age_identity'));
    assert(encryptedBridgeCompose.includes('source: tor_bridges_encrypted'));
    assert(encryptedBridgeCompose.includes('source: tor_bridge_age_identity'));
    assert(encryptedBridgeCompose.match(/mode: 0400/g)?.length >= 2);
    assert(encryptedBridgeCompose.includes('source: ./tor/bridges.placeholder.txt'));
    assert(encryptedBridgeCompose.includes('target: /etc/tor/bridges.local.txt'));
    assert(encryptedBridgeCompose.includes('TOR_BRIDGES_ENCRYPTED_LOCAL_FILE:?'));
    assert(encryptedBridgeCompose.includes('TOR_BRIDGES_AGE_IDENTITY_LOCAL_FILE:?'));
    assert(!/^TOR_BRIDGES=/m.test(envExample));
    assert(envExample.includes('TOR_BRIDGES_ENCRYPTED_FILE='));
    assert(envExample.includes('TOR_BRIDGES_AGE_IDENTITY_FILE='));
    assert(envExample.includes('TOR_BRIDGES_LOCAL_FILE=./tor/bridges.placeholder.txt'));
    assert(envExample.includes('# TOR_BRIDGES_LOCAL_FILE=./tor/bridges.local.txt'));
    assert(!/^TOR_BRIDGES_LOCAL_FILE=\.\/tor\/bridges\.local\.txt$/m.test(envExample));
    assert(envExample.includes('TOR_BRIDGES_ENCRYPTED_LOCAL_FILE=./tor/bridges.age'));
    assert(envExample.includes('TOR_BRIDGES_AGE_IDENTITY_LOCAL_FILE=./tor/bridge-age-identity.txt'));
    assert(envExample.includes('TRAFFIC_SECRET='));
    assert(compose.includes('TRAFFIC_SECRET: ${TRAFFIC_SECRET:-}'));
    assert(envExample.includes('AUTH_PUBLIC_URL=http://replace-with-auth-onion.onion'));
    assert(envExample.includes('BUSINESS_PUBLIC_URL=http://replace-with-business-onion.onion'));
    assert(envExample.includes('ADMIN_PUBLIC_URL=http://replace-with-admin-onion.onion'));
    assert(compose.includes('AUTH_PUBLIC_URL: ${AUTH_PUBLIC_URL:?Set AUTH_PUBLIC_URL to the public auth origin}'));
    assert(compose.includes('BUSINESS_PUBLIC_URL: ${BUSINESS_PUBLIC_URL:?Set BUSINESS_PUBLIC_URL to the public business origin}'));
    assert(compose.includes('ADMIN_PUBLIC_URL: ${ADMIN_PUBLIC_URL:?Set ADMIN_PUBLIC_URL to the public admin origin}'));
    assert(!/obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+cert=/.test(bridgesTemplate));
    assert(bridgesTemplate.includes('encrypt the private bridge'));
    assert(!/obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+cert=/.test(bridgesPlaceholder));
    assert(bridgesPlaceholder.includes('encrypted mode never mounts a local'));
    assert(torEntrypoint.includes('RUNTIME_DIR="/run/tor"'));
    assert(torEntrypoint.includes('BRIDGE_INCLUDE_CONFIG="$TORRC_DIR/bridges-runtime.conf"'));
    assert(torEntrypoint.includes('BRIDGE_CONFIG="$RUNTIME_DIR/bridges.conf"'));
    assert(torEntrypoint.includes('VALID_BRIDGES_FILE="$RUNTIME_DIR/bridges.valid"'));
    assert(torEntrypoint.includes('set -f'));
    assert(torEntrypoint.includes('umask 077'));
    assert(torEntrypoint.includes('chmod 750 "$TORRC_DIR" "$RUNTIME_DIR"'));
    assert(torEntrypoint.includes('chmod 600 "$VALID_BRIDGES_FILE"'));
    assert(torEntrypoint.includes('chown "$TOR_USER:$TOR_USER" "$BRIDGE_CONFIG"'));
    assert(torEntrypoint.includes('chmod 600 "$BRIDGE_CONFIG"'));
    assert(torEntrypoint.includes('chown "$TOR_USER:$TOR_USER" "$BRIDGE_INCLUDE_CONFIG"'));
    assert(torEntrypoint.includes('chmod 600 "$BRIDGE_INCLUDE_CONFIG"'));
    assert(torEntrypoint.includes("printf '%%include %s\\n' \"$BRIDGE_CONFIG\""));
    assert(torEntrypoint.includes('MAX_BRIDGE_LINE_LENGTH=1200'));
    assert(torEntrypoint.includes('is_valid_bridge_endpoint()'));
    assert(torEntrypoint.includes('is_valid_obfs4_bridge()'));
    assert(torEntrypoint.includes('^[0-9A-Fa-f:.]+') || torEntrypoint.includes('\\[[0-9A-Fa-f:.]+\\]'));
    assert(torEntrypoint.includes('[ "${#3}" -eq 40 ]'));
    assert(torEntrypoint.includes('cert='));
    assert(torEntrypoint.includes('if [ -s "$VALID_BRIDGES_FILE" ]'));
    assert(!torEntrypoint.includes('${TOR_BRIDGES:-}'));
    assert(!torEntrypoint.includes('TOR_BRIDGES="${'));
    assert(torEntrypoint.includes('BRIDGE_ENCRYPTED_FILE="${TOR_BRIDGES_ENCRYPTED_FILE:-}"'));
    assert(torEntrypoint.includes('BRIDGE_AGE_IDENTITY_FILE="${TOR_BRIDGES_AGE_IDENTITY_FILE:-}"'));
    assert(torEntrypoint.includes('age --decrypt --identity "$BRIDGE_AGE_IDENTITY_FILE"'));
    assert(torEntrypoint.includes('Failed to decrypt the configured Tor bridge file'));
    assert(torEntrypoint.includes('cleanup_bridge_sensitive_files() {'));
    assert(torEntrypoint.includes('trap cleanup_bridge_sensitive_files EXIT INT TERM HUP'));
    assert(torEntrypoint.includes('rm -f "$DECRYPTED_BRIDGES_FILE"'));
    assert(torEntrypoint.includes('trap - EXIT INT TERM HUP'));
    assert(!/Bridge\\ \*\)\s*printf '%s\\n' "\$bridge"/.test(torEntrypoint));
    assert(siteHealthWatcher.includes('$response.StatusCode -lt 400'));
    assert(!siteHealthWatcher.includes('$response.StatusCode -lt 500'));
    assert(siteHealthWatcher.includes('$env:SITE_HEALTH_BRIDGE_WARNING_THRESHOLD'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 86400)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(0, 1000)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 60)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 5000)]'));
    assert(siteHealthWatcher.includes('function Resolve-IntegerInRange'));
    assert(siteHealthWatcher.includes('function Protect-SiteHealthText'));
    assert(siteHealthWatcher.includes('[onion-url-hidden]'));
    assert(siteHealthWatcher.includes('[onion-hostname-hidden]'));
    assert(siteHealthWatcher.includes('[bridge-line-hidden]'));
    assert(siteHealthWatcher.includes('webtunnel\\s+\\S+\\s+[A-Fa-f0-9]{40}'));
    assert(siteHealthWatcher.includes('url=[bridge-url-hidden]'));
    assert(siteHealthWatcher.includes('[bridge-fingerprint-hidden]'));
    assert(siteHealthWatcher.includes('error = Protect-SiteHealthText ($output -join "`n")'));
    assert(siteHealthWatcher.includes('error = Protect-SiteHealthText $_.Exception.Message'));
    assert(siteHealthWatcher.includes('monitor failed: $(Protect-SiteHealthText $_.Exception.Message)'));
    assert(siteHealthWatcher.includes("-Name 'SITE_HEALTH_BRIDGE_WARNING_THRESHOLD'"));
    assert(siteHealthWatcher.includes('[switch]$IncludeOnionHostname'));
    assert(siteHealthWatcher.includes('hostnamePresent = [bool]$hostname'));
    assert(siteHealthWatcher.includes("hostname = if ($IncludeOnionHostname) { $hostname } else { '' }"));
    assert(siteHealthWatcher.includes('[switch]$IncludeBridgeFingerprints'));
    assert(siteHealthWatcher.includes("INCLUDE_BRIDGE_FINGERPRINTS=$includeFingerprints"));
    assert(siteHealthWatcher.includes('config=/run/tor/bridges.conf'));
    assert(siteHealthWatcher.includes("configuredBridgeCount=%s"));
    assert(siteHealthWatcher.includes("sed 's/^/fingerprint=/'"));
    assert(!siteHealthWatcher.includes('cat /etc/tor/torrc.d/bridges.conf'));
    assert(!siteHealthWatcher.includes("Where-Object { $_ -match '^\\s*Bridge\\s+' }"));
    assert(siteHealthWatcher.includes('fingerprints = if ($IncludeBridgeFingerprints) { @($fingerprints) } else { @() }'));
    assert(siteHealthWatcher.includes('seenFingerprints = if ($IncludeBridgeFingerprints) { $seenFingerprints } else { @() }'));
    assert(bridgeTester.includes('[switch]$RevealBridgeLines'));
    assert(bridgeTester.includes('[switch]$RevealBridgeMetadata'));
    assert(bridgeTester.includes('[string]$EncryptedBridgeFile'));
    assert(bridgeTester.includes('[string]$AgeIdentityFile'));
    assert(bridgeTester.includes('Inline -Bridge values can be exposed through shell history or process lists'));
    assert(bridgeTester.includes('$decryptedBridgeLines = @(& age --decrypt --identity $AgeIdentityFile $EncryptedBridgeFile 2>$null)'));
    assert(bridgeTester.includes('foreach ($line in $decryptedBridgeLines)'));
    assert(!bridgeTester.includes('$decryptedBridgeFile = New-TemporaryFile'));
    assert(!bridgeTester.includes('--output $decryptedBridgeFile.FullName'));
    assert(bridgeTester.includes("throw 'Failed to decrypt encrypted bridge file.'"));
    assert(bridgeTester.includes('[ValidateRange(10, 600)]'));
    assert(bridgeTester.includes('[ValidateRange(1, 100)]'));
    assert(bridgeTester.includes('[int]$MaxCandidates = 20'));
    assert(bridgeTester.includes('$MAX_BRIDGE_LINE_LENGTH = 1200'));
    assert(bridgeTester.includes('$OBFS4_BRIDGE_PATTERN'));
    assert(bridgeTester.includes('function Test-BridgeEndpoint'));
    assert(bridgeTester.includes('function Protect-BridgeDiagnosticText'));
    assert(bridgeTester.includes("$safe = $safe -replace '\\b[A-Fa-f0-9]{40}\\b', '[bridge-fingerprint]'"));
    assert(bridgeTester.includes('webtunnel\\s+\\S+\\s+[A-Fa-f0-9]{40}'));
    assert(bridgeTester.includes('url=[bridge-url-hidden]'));
    assert(bridgeTester.includes('function New-BridgeResult'));
    assert(bridgeTester.includes('cert='));
    assert(bridgeTester.includes('[^|\\r\\n]*\\bcert=\\S+[^|\\r\\n]*'));
    assert(!bridgeTester.includes('[^|`r`n]'));
    assert(bridgeTester.includes('$endpoint = $Matches[1]'));
    assert(bridgeTester.includes('$fingerprint = $Matches[2].ToUpperInvariant()'));
    assert(bridgeTester.includes('bridgeIndex = $Index'));
    assert(bridgeTester.includes('error = Protect-BridgeDiagnosticText -Text $ErrorText -Candidate $Candidate'));
    assert(bridgeTester.includes('if ($RevealBridgeMetadata -or $RevealBridgeLines)'));
    assert(!bridgeTester.includes('fingerprint.Substring(0, 8)'));
    assert(bridgeTester.includes('function Protect-BridgeCandidateFile'));
    assert(bridgeTester.includes('[System.Security.Principal.WindowsIdentity]::GetCurrent()'));
    assert(bridgeTester.includes('$acl.SetAccessRuleProtection($true, $false)'));
    assert(bridgeTester.includes('$acl.RemoveAccessRuleAll($rule)'));
    assert(bridgeTester.includes("[System.Security.Principal.SecurityIdentifier]::new($sidValue)"));
    assert(bridgeTester.includes("'S-1-5-18'"));
    assert(bridgeTester.includes("'S-1-5-32-544'"));
    assert(bridgeTester.includes('Set-Acl -LiteralPath $Path -AclObject $acl'));
    assert(bridgeTester.includes('chmod 600'));
    assert(bridgeTester.includes('$candidateFile = New-TemporaryFile'));
    assert.match(bridgeTester, /\$candidateFile = New-TemporaryFile\s+Protect-BridgeCandidateFile -Path \$candidateFile\.FullName\s+\[System\.IO\.File\]::WriteAllText/s);
    assert(bridgeTester.includes('[System.IO.File]::WriteAllText'));
    assert(bridgeTester.includes('--mount $bridgeMount'));
    assert(bridgeTester.includes('target=/tmp/bridge-candidate.txt,readonly'));
    assert(bridgeTester.includes("-e 'TOR_BRIDGES_FILE=/tmp/bridge-candidate.txt'"));
    assert(bridgeTester.includes('Remove-Item -LiteralPath $candidateFile.FullName -Force'));
    assert(!bridgeTester.includes('Remove-Item -LiteralPath $decryptedBridgeFile.FullName -Force'));
    assert(!bridgeTester.includes('-e "TOR_BRIDGES=$($Candidate.line)"'));
    assert(!bridgeTester.includes('TOR_BRIDGES='));
    assert(bridgeTester.includes('Get-CandidateBridges | Select-Object -First $MaxCandidates'));
    assert.match(bridgeTester, /if \(\$RevealBridgeLines\) \{\s*\$result\.line = \$Candidate\.line\s*\}/);
    assert.match(bridgeTester, /\$seen\.Add\(\$item\.line\)/);
    assert.doesNotMatch(bridgeTester, /\$seen\.Add\(\$item\.fingerprint\)/);
    assert(bridgeEncryptor.includes('[string]$BridgeFile'));
    assert(bridgeEncryptor.includes('[string]$OutputFile'));
    assert(bridgeEncryptor.includes('[string]$AgeIdentityFile'));
    assert(bridgeEncryptor.includes('[switch]$CreateIdentity'));
    assert(bridgeEncryptor.includes('[switch]$Force'));
    assert(bridgeEncryptor.includes("Join-Path $PSScriptRoot '..\\tor\\bridges.local.txt'"));
    assert(bridgeEncryptor.includes("Join-Path $PSScriptRoot '..\\tor\\bridges.age'"));
    assert(bridgeEncryptor.includes("Join-Path $PSScriptRoot '..\\tor\\bridge-age-identity.txt'"));
    assert(bridgeEncryptor.includes('function Protect-PrivateFile'));
    assert(bridgeEncryptor.includes('[System.Security.Principal.WindowsIdentity]::GetCurrent()'));
    assert(bridgeEncryptor.includes('$acl.SetAccessRuleProtection($true, $false)'));
    assert(bridgeEncryptor.includes('$acl.RemoveAccessRuleAll($rule)'));
    assert(bridgeEncryptor.includes("[System.Security.Principal.SecurityIdentifier]::new($sidValue)"));
    assert(bridgeEncryptor.includes("'S-1-5-18'"));
    assert(bridgeEncryptor.includes("'S-1-5-32-544'"));
    assert(bridgeEncryptor.includes('Set-Acl -LiteralPath $Path -AclObject $acl'));
    assert(bridgeEncryptor.includes('chmod 600'));
    assert(bridgeEncryptor.includes('Assert-ToolAvailable -Tool $AgePath'));
    assert(bridgeEncryptor.includes('Assert-ToolAvailable -Tool $AgeKeygenPath'));
    assert(bridgeEncryptor.includes('& $AgeKeygenPath -o $AgeIdentityFile *> $null'));
    assert(bridgeEncryptor.includes('& $AgeKeygenPath -y $AgeIdentityFile 2>$null'));
    assert(bridgeEncryptor.includes('$recipientLines | Where-Object'));
    assert(bridgeEncryptor.includes('^age1[0-9a-z]+$'));
    assert(bridgeEncryptor.includes('$temporaryOutput = "$OutputFile.tmp-'));
    assert(bridgeEncryptor.includes('& $AgePath --encrypt --recipient $recipient --output $temporaryOutput $BridgeFile *> $null'));
    assert(bridgeEncryptor.includes('Move-Item -LiteralPath $temporaryOutput -Destination $OutputFile -Force'));
    assert(bridgeEncryptor.includes('Remove-Item -LiteralPath $temporaryOutput -Force'));
    assert(bridgeEncryptor.includes('TOR_BRIDGES_ENCRYPTED_LOCAL_FILE'));
    assert(bridgeEncryptor.includes('TOR_BRIDGES_AGE_IDENTITY_LOCAL_FILE'));
    assert(!bridgeEncryptor.includes('[string[]]$Bridge'));
    assert(!bridgeEncryptor.includes('Write-Host'));
    assert(!bridgeEncryptor.includes('Get-Content $BridgeFile'));
    assert(healthLogRedactor.includes('[switch]$InPlace'));
    assert(healthLogRedactor.includes("Name = 'onionUrls'"));
    assert(healthLogRedactor.includes("Name = 'sensitiveQueryValues'"));
    assert(healthLogRedactor.includes("Name = 'webtunnelBridgeLines'"));
    assert(healthLogRedactor.includes("Name = 'bridgeUrls'"));
    assert(healthLogRedactor.includes('[?&#]'));
    assert(siteHealthWatcher.includes('[?&#]'));
    assert(healthLogRedactor.includes('access_token'));
    assert(healthLogRedactor.includes('sessionId'));
    assert(healthLogRedactor.includes('csrfToken'));
    assert(siteHealthWatcher.includes('access_token'));
    assert(siteHealthWatcher.includes('sessionId'));
    assert(siteHealthWatcher.includes('csrfToken'));
    assert(healthLogRedactor.includes('recoveryCode'));
    assert(healthLogRedactor.includes('recovery_code'));
    assert(healthLogRedactor.includes('totpToken'));
    assert(healthLogRedactor.includes('state|ticket'));
    assert(healthLogRedactor.includes('passcode'));
    assert(healthLogRedactor.includes('authorization'));
    assert(siteHealthWatcher.includes('recoveryCode'));
    assert(siteHealthWatcher.includes('recovery_code'));
    assert(siteHealthWatcher.includes('totpToken'));
    assert(siteHealthWatcher.includes('state|ticket'));
    assert(siteHealthWatcher.includes('passcode'));
    assert(siteHealthWatcher.includes('authorization'));
    assert(healthLogRedactor.includes("Replacement = '[onion-url-hidden]'"));
    assert(healthLogRedactor.includes("Replacement = '$1[hidden]'"));
    assert(healthLogRedactor.includes("Replacement = 'url=[bridge-url-hidden]'"));
    assert(healthLogRedactor.includes("Pattern = '\\b[a-z2-7]{56}\\.onion\\b'"));
    assert(healthLogRedactor.includes("Replacement = '[onion-hostname-hidden]'"));
    assert(healthLogRedactor.includes("Pattern = '\\b[A-Fa-f0-9]{40}\\b'"));
    assert(healthLogRedactor.includes("Replacement = '[bridge-fingerprint-hidden]'"));
    assert(healthLogRedactor.includes('if ($InPlace)'));
    assert(smokePostgres.includes('dotenv.config'));
    assert(smokePostgres.includes('process.env.POSTGRES_PASSWORD'));
    assert(smokePostgres.includes('Set DATABASE_URL or POSTGRES_PASSWORD'));
    assert(!smokePostgres.includes("|| 'postgres'"));
    assert(appSource.includes('function createStaticBoundaryMiddleware(root, options = {})'));
    assert(appSource.includes("blockedPrefixes: ['/ci-practice-fixtures']"));
    assert(appSource.includes('createStaticBoundaryMiddleware(staticDirectory, staticBoundaryOptions), express.static(staticDirectory'));
    assert(appSource.includes('createStaticBoundaryMiddleware(adminRoot), express.static(adminRoot'));
    assert(appSource.includes('function normalizeHttpErrorStatus(error, fallback = 500)'));
    assert(appSource.includes('Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback'));
    assert(!appSource.includes('const status = isZodError ? 400 : (error.status || error.statusCode || 500)'));
});

async function createClient(options = {}) {
    const sessionStore = new session.MemoryStore();
    const authStore = new MemoryAuthStore({ sessionStore });
    const totpStore = new MemoryTotpStore();
    const practiceStore = new MemoryPracticeRecordStore();
    const adminStore = new MemoryAdminStore({ authStore, practiceStore, totpStore, sessionStore });
    const authHandoffStore = new MemoryAuthHandoffStore();
    const app = createApp({
        authStore,
        totpStore,
        practiceStore,
        adminStore,
        authHandoffStore,
        sessionStore,
        sessionSecret: options.sessionSecret || 'test-session-secret',
        nodeEnv: options.nodeEnv,
        staticRoot: options.staticRoot,
        cookieSecure: options.cookieSecure,
        trustProxy: options.trustProxy,
        bcrypt: options.bcrypt,
        rateLimit: options.rateLimit || { maxAttempts: 100, windowMs: 60_000 },
        adminRateLimit: options.adminRateLimit,
        csrfRateLimit: options.csrfRateLimit,
        totpRateLimit: options.totpRateLimit,
        totpEnabled: options.totpEnabled,
        totpEncryptionKey: options.totpEncryptionKey || 'test-totp-key',
        totpVerificationMaxAgeMs: options.totpVerificationMaxAgeMs,
        authHandoffTicketTtlMs: options.authHandoffTicketTtlMs,
        authPublicUrl: options.authPublicUrl,
        businessPublicUrl: options.businessPublicUrl,
        adminPublicUrl: options.adminPublicUrl,
        totpRecoveryHashRounds: 4
    });
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        listener.once('error', reject);
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    function createSessionClient() {
        const cookieJar = new Map();
        let csrfToken = '';

        function getCookieHeader() {
            return Array.from(cookieJar.entries())
                .filter(([, value]) => value !== '')
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');
        }

        function splitCombinedSetCookie(value) {
            return String(value || '')
                .split(/,(?=\s*[^;,=\s]+=[^;,]*)/g)
                .map((item) => item.trim())
                .filter(Boolean);
        }

        function storeSetCookieHeaders(response) {
            const setCookies = typeof response.headers.getSetCookie === 'function'
                ? response.headers.getSetCookie()
                : splitCombinedSetCookie(response.headers.get('set-cookie'));
            setCookies.forEach((setCookie) => {
                const first = String(setCookie || '').split(';', 1)[0];
                const index = first.indexOf('=');
                if (index <= 0) return;
                const name = first.slice(0, index);
                const value = first.slice(index + 1);
                if (value === '') {
                    cookieJar.delete(name);
                } else {
                    cookieJar.set(name, value);
                }
            });
        }

        async function request(method, path, body, options = {}) {
            const headers = {
                ...(options.headers || {})
            };
            const cookieHeader = getCookieHeader();
            if (cookieHeader) {
                headers.cookie = cookieHeader;
            }
            if (options.csrf !== false && csrfToken && method !== 'GET') {
                headers['x-csrf-token'] = csrfToken;
            }
            const hasRawBody = Object.prototype.hasOwnProperty.call(options, 'rawBody');
            if (body !== undefined || hasRawBody) {
                headers['content-type'] = 'application/json';
            }
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers,
                redirect: options.redirect,
                body: hasRawBody ? options.rawBody : (body === undefined ? undefined : JSON.stringify(body))
            });
            storeSetCookieHeaders(response);
            const text = await response.text();
            let json = null;
            if (text) {
                try {
                    json = JSON.parse(text);
                } catch (_) {
                    json = null;
                }
            }
            if (json && json.csrfToken) {
                csrfToken = json.csrfToken;
            }
            return { response, json, text };
        }

        return {
            get csrfToken() {
                return csrfToken;
            },
            request,
            async csrf() {
                return request('GET', '/api/auth/csrf');
            }
        };
    }

    const primarySession = createSessionClient();

    return {
        sessionStore,
        authStore,
        adminStore,
        authHandoffStore,
        totpStore,
        practiceStore,
        get csrfToken() {
            return primarySession.csrfToken;
        },
        request: primarySession.request,
        csrf: primarySession.csrf,
        createSession: createSessionClient,
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
    };
}

function getResponseSessionCookie(result) {
    return result.response.headers.get('set-cookie')?.split(';')[0] || '';
}

function getStoredSessions(sessionStore) {
    return new Promise((resolve, reject) => {
        sessionStore.all((error, sessions) => {
            if (error) reject(error);
            else resolve(sessions || {});
        });
    });
}

function setStoredSession(sessionStore, sid, value) {
    return new Promise((resolve, reject) => {
        sessionStore.set(sid, value, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function createProductionAppWithSecret(sessionSecret, options = {}) {
    const sessionStore = new session.MemoryStore();
    const authStore = new MemoryAuthStore({ sessionStore });
    const totpStore = new MemoryTotpStore();
    const practiceStore = new MemoryPracticeRecordStore();
    return () => createApp({
        authStore,
        totpStore,
        practiceStore,
        adminStore: new MemoryAdminStore({ authStore, practiceStore, totpStore, sessionStore }),
        sessionStore,
        sessionSecret,
        nodeEnv: 'production',
        rateLimit: { maxAttempts: 100, windowMs: 60_000 },
        totpEncryptionKey: options.totpEncryptionKey || '0123456789abcdef0123456789abcdef'
    });
}

test('production app rejects missing or placeholder session secrets', () => {
    assert.throws(
        createProductionAppWithSecret('development-session-secret-change-me'),
        /SESSION_SECRET/
    );
    assert.throws(
        createProductionAppWithSecret('replace-with-a-long-random-session-secret'),
        /SESSION_SECRET/
    );
    assert.throws(
        createProductionAppWithSecret('short-secret'),
        /SESSION_SECRET/
    );
    assert.doesNotThrow(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef')
    );
});

test('production app rejects weak TOTP encryption keys', () => {
    assert.throws(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef', {
            totpEncryptionKey: 'short-totp-key'
        }),
        /TOTP_ENCRYPTION_KEY/
    );
    assert.doesNotThrow(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef', {
            totpEncryptionKey: 'fedcba9876543210fedcba9876543210'
        })
    );
});

async function register(client, username = 'alice', password = 'StrongPass1') {
    await client.csrf();
    return client.request('POST', '/api/auth/register', { username, password });
}

async function seedAdmin(client, username = 'admin_user', password = 'StrongPass1') {
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await client.authStore.createUser({
        username,
        usernameLower: username.toLowerCase(),
        passwordHash
    });
    user.role = 'admin';
    return user;
}

function generateTotpToken(secret, epochOffsetMs = 0) {
    const options = { secret };
    if (epochOffsetMs) {
        options.epoch = Date.now() + epochOffsetMs;
    }
    return otp.generateSync(options);
}

function parseRedirectLocation(location) {
    assert(location, 'expected redirect location header');
    return new URL(location, 'http://example.test');
}

function assertAuthStartRedirect(location, audience, returnTo) {
    const url = parseRedirectLocation(location);
    assert.equal(url.pathname, `/auth/${audience}/start`);
    assert.equal(url.searchParams.get('return_to'), returnTo);
}

function getRedirectParam(location, name) {
    return parseRedirectLocation(location).searchParams.get(name);
}

async function withDateNowOffset(offsetMs, callback) {
    const realNow = Date.now;
    Date.now = () => realNow() + offsetMs;
    try {
        return await callback();
    } finally {
        Date.now = realNow;
    }
}

async function enableTotpForCurrentSession(client) {
    const setup = await client.request('POST', '/api/auth/totp/setup', {});
    assert.equal(setup.response.status, 200);
    assert(setup.json.secret);
    assert.match(setup.json.otpauthUrl, /^otpauth:\/\/totp\//);

    const setupToken = generateTotpToken(setup.json.secret);
    const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
        token: setupToken
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.json.status.enabled, true);
    assert.equal(verified.json.recoveryCodes.length, 10);
    return {
        secret: setup.json.secret,
        setupToken,
        recoveryCodes: verified.json.recoveryCodes,
        user: verified.json.user,
        sessionCookie: getResponseSessionCookie(verified),
        csrfToken: verified.json.csrfToken
    };
}

test('auth registration rejects weak and duplicate credentials', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const weak = await client.request('POST', '/api/auth/register', {
            username: 'weak_user',
            password: 'weak'
        });
        assert.equal(weak.response.status, 400);
        assert.equal(weak.json.error, 'Password strength is insufficient');
        assert(weak.json.details.includes('Password must be at least 8 characters long'));

        const longPassword = `Aa1${'x'.repeat(70)}`;
        assert(Buffer.byteLength(longPassword, 'utf8') > 72);
        const tooLong = await client.request('POST', '/api/auth/register', {
            username: 'long_password_user',
            password: longPassword
        });
        assert.equal(tooLong.response.status, 400);
        assert.equal(tooLong.json.error, 'Password strength is insufficient');
        assert(tooLong.json.details.includes('Password must not exceed 72 UTF-8 bytes'));

        const multibytePassword = `Aa1${'界'.repeat(24)}`;
        assert(Buffer.byteLength(multibytePassword, 'utf8') > 72);
        const tooLongMultibyte = await client.request('POST', '/api/auth/register', {
            username: 'long_utf8_user',
            password: multibytePassword
        });
        assert.equal(tooLongMultibyte.response.status, 400);
        assert.equal(tooLongMultibyte.json.error, 'Password strength is insufficient');
        assert(tooLongMultibyte.json.details.includes('Password must not exceed 72 UTF-8 bytes'));

        const created = await client.request('POST', '/api/auth/register', {
            username: 'alice',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);
        assert.equal(created.json.user.username, 'alice');

        const duplicate = await client.request('POST', '/api/auth/register', {
            username: 'Alice',
            password: 'StrongPass1'
        });
        assert.equal(duplicate.response.status, 409);
        assert.equal(duplicate.json.error, 'Username already exists');
    } finally {
        await client.close();
    }
});

test('auth write endpoints require a valid CSRF token', async () => {
    const client = await createClient();
    try {
        const missing = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        });
        assert.equal(missing.response.status, 403);

        await client.csrf();
        const invalid = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        }, {
            csrf: false,
            headers: {
                'x-csrf-token': 'invalid-token'
            }
        });
        assert.equal(invalid.response.status, 403);

        const shortToken = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        }, {
            csrf: false,
            headers: {
                'x-csrf-token': client.csrfToken.slice(0, -1)
            }
        });
        assert.equal(shortToken.response.status, 403);

        const valid = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        });
        assert.equal(valid.response.status, 201);
    } finally {
        await client.close();
    }
});

test('auth CSRF endpoint is rate limited to prevent session store flooding', async () => {
    const client = await createClient({
        csrfRateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const first = await client.request('GET', '/api/auth/csrf');
        assert.equal(first.response.status, 200);
        assert(first.json.csrfToken);

        const limited = await client.request('GET', '/api/auth/csrf');
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('rate limiter bounds tracked keys', () => {
    const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000, maxKeys: 2 });
    limiter('first');
    limiter('second');
    limiter('third');
    assert.equal(limiter.size(), 2);
});

test('rate limiter hashes oversized keys before tracking attempts', () => {
    const longKey = `login-ip:${'x'.repeat(10_000)}`;
    const normalized = normalizeRateLimitKey(longKey);
    assert.match(normalized, /^sha256:[a-f0-9]{64}$/);
    assert.equal(normalizeRateLimitKey(longKey), normalized);
    assert.equal(normalizeRateLimitKey('csrf-ip:\r\n127.0.0.1'), 'csrf-ip: 127.0.0.1');

    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000 });
    limiter(longKey);
    assert.throws(
        () => limiter(longKey),
        /Too many requests, please try again later/
    );
    assert.equal(limiter.size(), 1);
});

test('login, logout, and authenticated practice API access', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'login_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const loggedInRecords = await client.request('GET', '/api/practice-records');
        assert.equal(loggedInRecords.response.status, 200);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);
        const logoutCookie = logout.response.headers.get('set-cookie') || '';
        assert.match(logoutCookie, /ielts\.sid=;/);
        assert.match(logoutCookie, /HttpOnly/);
        assert.match(logoutCookie, /SameSite=Lax/);

        await client.csrf();
        const wrong = await client.request('POST', '/api/auth/login', {
            username: 'login_user',
            password: 'WrongPass1'
        });
        assert.equal(wrong.response.status, 401);
        assert.equal(wrong.json.error, 'Username or password is incorrect');

        const login = await client.request('POST', '/api/auth/login', {
            username: 'login_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'login_user');

        const logoutAgain = await client.request('POST', '/api/auth/logout');
        assert.equal(logoutAgain.response.status, 200);

        const meAfterLogout = await client.request('GET', '/api/auth/me');
        assert.equal(meAfterLogout.response.status, 401);

        const afterLogout = await client.request('GET', '/api/practice-records');
        assert.equal(afterLogout.response.status, 401);
    } finally {
        await client.close();
    }
});

test('sensitive API responses are not cacheable', async () => {
    const client = await createClient();
    try {
        const csrf = await client.request('GET', '/api/auth/csrf');
        assert.equal(csrf.response.status, 200);
        assert.equal(csrf.response.headers.get('cache-control'), 'no-store');
        assert.equal(csrf.response.headers.get('pragma'), 'no-cache');
        assert.equal(csrf.response.headers.get('expires'), '0');

        const created = await client.request('POST', '/api/auth/register', {
            username: 'cache_user',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);

        const records = await client.request('GET', '/api/practice-records');
        assert.equal(records.response.status, 200);
        assert.equal(records.response.headers.get('cache-control'), 'no-store');

        await seedAdmin(client, 'cache_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'cache_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const summary = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(summary.response.status, 200);
        assert.equal(summary.response.headers.get('cache-control'), 'no-store');

        const adminPage = await adminSession.request('GET', '/admin');
        assert.equal(adminPage.response.status, 200);
        assert.equal(adminPage.response.headers.get('cache-control'), 'no-store');
        assert.equal(adminPage.response.headers.get('pragma'), 'no-cache');
        assert.equal(adminPage.response.headers.get('expires'), '0');
    } finally {
        await client.close();
    }
});

test('malformed JSON bodies return a stable validation error', async () => {
    const client = await createClient();
    try {
        const response = await client.request('POST', '/api/auth/register', undefined, {
            rawBody: '{"username":'
        });
        assert.equal(response.response.status, 400);
        assert.equal(response.json.error, 'Malformed request body');
        assert.doesNotMatch(response.text, /Unexpected token|JSON/i);
    } finally {
        await client.close();
    }
});

test('oversized JSON bodies return a stable payload error', async () => {
    const client = await createClient();
    try {
        const response = await client.request('POST', '/api/auth/register', undefined, {
            rawBody: JSON.stringify({
                username: 'large_payload',
                password: 'StrongPass1',
                filler: 'x'.repeat(2 * 1024 * 1024)
            })
        });
        assert.equal(response.response.status, 413);
        assert.equal(response.json.error, 'Request body too large');
        assert.doesNotMatch(response.text, /entity|PayloadTooLargeError|limit/i);
    } finally {
        await client.close();
    }
});

test('logout clears secure session cookies with matching attributes', async () => {
    const client = await createClient({ cookieSecure: true, trustProxy: true });
    const proxyHeaders = {
        'x-forwarded-proto': 'https'
    };
    try {
        const csrf = await client.request('GET', '/api/auth/csrf', undefined, {
            headers: proxyHeaders
        });
        assert.equal(csrf.response.status, 200);
        const csrfCookie = csrf.response.headers.get('set-cookie') || '';
        assert.match(csrfCookie, /Secure/);
        assert.match(csrfCookie, /SameSite=Lax/);

        const created = await client.request('POST', '/api/auth/register', {
            username: 'secure_cookie_user',
            password: 'StrongPass1'
        }, {
            headers: proxyHeaders
        });
        assert.equal(created.response.status, 201);

        const logout = await client.request('POST', '/api/auth/logout', undefined, {
            headers: proxyHeaders
        });
        assert.equal(logout.response.status, 200);
        const clearedCookie = logout.response.headers.get('set-cookie') || '';
        assert.match(clearedCookie, /ielts\.sid=;/);
        assert.match(clearedCookie, /HttpOnly/);
        assert.match(clearedCookie, /Secure/);
        assert.match(clearedCookie, /SameSite=Lax/);
    } finally {
        await client.close();
    }
});

test('login performs a dummy password check for unknown users', async () => {
    const compareCalls = [];
    const fakeBcrypt = {
        async hash(password) {
            return `hash:${password}`;
        },
        async compare(password, hash) {
            compareCalls.push({ password, hash });
            return hash === `hash:${password}`;
        }
    };
    const client = await createClient({ bcrypt: fakeBcrypt });
    try {
        await client.csrf();
        const missing = await client.request('POST', '/api/auth/login', {
            username: 'missing_user',
            password: 'StrongPass1'
        });
        assert.equal(missing.response.status, 401);
        assert.equal(missing.json.error, 'Username or password is incorrect');
        assert.equal(compareCalls.length, 1);
        assert.equal(compareCalls[0].password, 'StrongPass1');
        assert.match(compareCalls[0].hash, /^\$2[aby]\$12\$/);
    } finally {
        await client.close();
    }
});

test('password comparisons reject input beyond bcrypt byte limit', async () => {
    const client = await createClient();
    const passwordAtLimit = `Aa1${'x'.repeat(69)}`;
    const extendedPassword = `${passwordAtLimit}Z`;
    assert.equal(Buffer.byteLength(passwordAtLimit, 'utf8'), 72);
    assert(Buffer.byteLength(extendedPassword, 'utf8') > 72);
    try {
        const created = await register(client, 'bcrypt_limit_user', passwordAtLimit);
        assert.equal(created.response.status, 201);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const extendedLogin = await client.request('POST', '/api/auth/login', {
            username: 'bcrypt_limit_user',
            password: extendedPassword
        });
        assert.equal(extendedLogin.response.status, 401);
        assert.equal(extendedLogin.json.error, 'Username or password is incorrect');

        const login = await client.request('POST', '/api/auth/login', {
            username: 'bcrypt_limit_user',
            password: passwordAtLimit
        });
        assert.equal(login.response.status, 200);

        const rename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'bcrypt_limit_renamed',
            password: extendedPassword
        });
        assert.equal(rename.response.status, 401);
        assert.equal(rename.json.error, 'Current password is incorrect');

        const passwordChange = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: extendedPassword,
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordChange.response.status, 401);
        assert.equal(passwordChange.json.error, 'Current password is incorrect');

        const deleteAttempt = await client.request('DELETE', '/api/auth/account', {
            password: extendedPassword,
            confirm: 'bcrypt_limit_user'
        });
        assert.equal(deleteAttempt.response.status, 401);
        assert.equal(deleteAttempt.json.error, 'Current password is incorrect');
    } finally {
        await client.close();
    }
});

test('users can update their own username and password', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'account_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        await client.authStore.createUser({
            username: 'taken_user',
            usernameLower: 'taken_user',
            passwordHash: await bcrypt.hash('StrongPass1', 4)
        });

        const wrongPasswordRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'renamed_user',
            password: 'WrongPass1'
        });
        assert.equal(wrongPasswordRename.response.status, 401);

        const duplicateRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'taken_user',
            password: 'StrongPass1'
        });
        assert.equal(duplicateRename.response.status, 409);

        const renamed = await client.request('PATCH', '/api/auth/account/username', {
            username: 'renamed_user',
            password: 'StrongPass1'
        });
        assert.equal(renamed.response.status, 200);
        assert.equal(renamed.json.user.username, 'renamed_user');

        const me = await client.request('GET', '/api/auth/me');
        assert.equal(me.response.status, 200);
        assert.equal(me.json.user.username, 'renamed_user');

        const weakPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'weak'
        });
        assert.equal(weakPassword.response.status, 400);

        const longPassword = `Aa1${'x'.repeat(70)}`;
        assert(Buffer.byteLength(longPassword, 'utf8') > 72);
        const tooLongPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: longPassword
        });
        assert.equal(tooLongPassword.response.status, 400);
        assert.equal(tooLongPassword.json.error, 'Password strength is insufficient');
        assert(tooLongPassword.json.details.includes('Password must not exceed 72 UTF-8 bytes'));

        const wrongCurrentPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(wrongCurrentPassword.response.status, 401);

        const samePassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongPass1'
        });
        assert.equal(samePassword.response.status, 400);

        const passwordChanged = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordChanged.response.status, 200);
        assert.equal(passwordChanged.json.user.username, 'renamed_user');

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const oldUsernameLogin = await client.request('POST', '/api/auth/login', {
            username: 'account_user',
            password: 'StrongerPass2'
        });
        assert.equal(oldUsernameLogin.response.status, 401);

        const oldPasswordLogin = await client.request('POST', '/api/auth/login', {
            username: 'renamed_user',
            password: 'StrongPass1'
        });
        assert.equal(oldPasswordLogin.response.status, 401);

        const newPasswordLogin = await client.request('POST', '/api/auth/login', {
            username: 'renamed_user',
            password: 'StrongerPass2'
        });
        assert.equal(newPasswordLogin.response.status, 200);
        assert.equal(newPasswordLogin.json.user.username, 'renamed_user');
    } finally {
        await client.close();
    }
});

test('account username and password changes revoke other sessions', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'session_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const initialSessionCookie = getResponseSessionCookie(created);
        assert(initialSessionCookie);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const otherLogin = await otherSession.request('POST', '/api/auth/login', {
            username: 'session_user',
            password: 'StrongPass1'
        });
        assert.equal(otherLogin.response.status, 200);

        const renamed = await client.request('PATCH', '/api/auth/account/username', {
            username: 'session_user_renamed',
            password: 'StrongPass1'
        });
        assert.equal(renamed.response.status, 200);
        const renamedSessionCookie = getResponseSessionCookie(renamed);
        assert(renamedSessionCookie);
        assert.notEqual(renamedSessionCookie, initialSessionCookie);

        const otherAfterRename = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfterRename.response.status, 401);

        const anotherSession = client.createSession();
        await anotherSession.csrf();
        const anotherLogin = await anotherSession.request('POST', '/api/auth/login', {
            username: 'session_user_renamed',
            password: 'StrongPass1'
        });
        assert.equal(anotherLogin.response.status, 200);

        const passwordChanged = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordChanged.response.status, 200);
        const passwordChangedSessionCookie = getResponseSessionCookie(passwordChanged);
        assert(passwordChangedSessionCookie);
        assert.notEqual(passwordChangedSessionCookie, renamedSessionCookie);

        const anotherAfterPasswordChange = await anotherSession.request('GET', '/api/auth/me');
        assert.equal(anotherAfterPasswordChange.response.status, 401);

        const currentSession = await client.request('GET', '/api/auth/me');
        assert.equal(currentSession.response.status, 200);
        assert.equal(currentSession.json.user.username, 'session_user_renamed');
    } finally {
        await client.close();
    }
});

test('sensitive account password checks are rate limited', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const created = await register(client, 'account_limited', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const wrongRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'account_limited_new',
            password: 'WrongPass1'
        });
        assert.equal(wrongRename.response.status, 401);

        const limitedRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'account_limited_new',
            password: 'WrongPass1'
        });
        assert.equal(limitedRename.response.status, 429);

        const wrongPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(wrongPassword.response.status, 401);

        const limitedPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(limitedPassword.response.status, 429);

        const wrongDelete = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'account_limited'
        });
        assert.equal(wrongDelete.response.status, 401);

        const limitedDelete = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'account_limited'
        });
        assert.equal(limitedDelete.response.status, 429);
    } finally {
        await client.close();
    }
});

test('authenticated APIs refresh stale session users before trusting them', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'stale_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const storedUser = client.authStore.users.get('stale_user');
        storedUser.role = 'admin';

        const refreshedRole = await client.request('GET', '/api/auth/me');
        assert.equal(refreshedRole.response.status, 200);
        assert.equal(refreshedRole.json.user.role, 'admin');

        client.authStore.users.delete('stale_user');

        const staleMe = await client.request('GET', '/api/auth/me');
        assert.equal(staleMe.response.status, 401);

        const stalePractice = await client.request('GET', '/api/practice-records');
        assert.equal(stalePractice.response.status, 401);
    } finally {
        await client.close();
    }
});

test('pending TOTP sessions refresh stale users before trusting them', async () => {
    const client = await createClient();
    try {
        await register(client, 'pending_totp_user', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const pendingLogin = await client.request('POST', '/api/auth/login', {
            username: 'pending_totp_user',
            password: 'StrongPass1'
        });
        assert.equal(pendingLogin.response.status, 200);
        assert.equal(pendingLogin.json.requiresTotp, true);

        client.authStore.users.delete('pending_totp_user');
        const deletedPendingLogin = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        });
        assert.equal(deletedPendingLogin.response.status, 400);
        assert.equal(deletedPendingLogin.json.error, 'TOTP login was not started');

        const adminSession = client.createSession();
        const adminCreated = await register(adminSession, 'pending_totp_admin', 'StrongPass1');
        assert.equal(adminCreated.response.status, 201);
        const storedAdmin = client.authStore.users.get('pending_totp_admin');
        storedAdmin.role = 'admin';
        await adminSession.request('POST', '/api/auth/logout');

        await adminSession.csrf();
        const pendingSetup = await adminSession.request('POST', '/api/auth/login', {
            username: 'pending_totp_admin',
            password: 'StrongPass1'
        });
        assert.equal(pendingSetup.response.status, 200);
        assert.equal(pendingSetup.json.requiresTotpSetup, true);

        client.authStore.users.delete('pending_totp_admin');
        const deletedPendingSetup = await adminSession.request('POST', '/api/auth/totp/setup', {});
        assert.equal(deletedPendingSetup.response.status, 401);
        assert.equal(deletedPendingSetup.json.error, 'Authentication required');
    } finally {
        await client.close();
    }
});

test('users can delete their own account and associated records', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'delete_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const userId = created.json.user.id;

        const replaced = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'delete-record', title: 'Delete me', score: 80 }]
        });
        assert.equal(replaced.response.status, 200);
        assert.equal(replaced.json.records.length, 1);

        const wrongConfirm = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'wrong_user'
        });
        assert.equal(wrongConfirm.response.status, 400);

        const wrongPassword = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'delete_user'
        });
        assert.equal(wrongPassword.response.status, 401);

        const deleted = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'delete_user'
        });
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);

        const me = await client.request('GET', '/api/auth/me');
        assert.equal(me.response.status, 401);
        assert.equal(await client.authStore.findByUsernameLower('delete_user'), null);
        assert.deepEqual(await client.practiceStore.list(userId), []);

        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'delete_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 401);
    } finally {
        await client.close();
    }
});

test('the last admin account cannot delete itself', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        await seedAdmin(client, 'sole_admin', 'StrongPass1');
        const login = await client.request('POST', '/api/auth/login', {
            username: 'sole_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(client);

        const blocked = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'sole_admin'
        });
        assert.equal(blocked.response.status, 409);
        assert(await client.authStore.findByUsernameLower('sole_admin'));
    } finally {
        await client.close();
    }
});

test('Auth stores refuse direct last-admin deletion', async () => {
    const adminUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        username: 'auth_admin',
        username_lower: 'auth_admin',
        password_hash: 'hash',
        role: 'admin'
    };
    const memoryStore = new MemoryAuthStore();
    memoryStore.users.set(adminUser.username_lower, { ...adminUser });

    await assert.rejects(
        () => memoryStore.deleteUser(adminUser.id),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.message, 'The last admin account cannot be deleted');
            return true;
        }
    );
    assert(memoryStore.users.has(adminUser.username_lower));

    const deletedSessions = [];
    const ordinaryUser = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        username: 'auth_user',
        username_lower: 'auth_user',
        password_hash: 'hash',
        role: 'user'
    };
    const memoryDeleteStore = new MemoryAuthStore({
        sessionStore: {
            sessions: {
                target: JSON.stringify({ user: { id: ordinaryUser.id } }),
                other: JSON.stringify({ user: { id: adminUser.id } })
            },
            destroy(sid, callback) {
                deletedSessions.push(sid);
                callback();
            }
        }
    });
    memoryDeleteStore.users.set(adminUser.username_lower, { ...adminUser });
    memoryDeleteStore.users.set(ordinaryUser.username_lower, { ...ordinaryUser });

    const deletedMemoryUser = await memoryDeleteStore.deleteUser(ordinaryUser.id);
    assert.equal(deletedMemoryUser.id, ordinaryUser.id);
    assert.deepEqual(deletedSessions, ['target']);
    assert.equal(memoryDeleteStore.users.has(ordinaryUser.username_lower), false);

    const queries = [];
    const ordinaryPgUser = {
        ...ordinaryUser,
        username: 'auth_pg_user',
        username_lower: 'auth_pg_user'
    };
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE') {
                return { rows: [], rowCount: 0 };
            }
            if (text === 'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1 FOR UPDATE') {
                return { rows: [params[0] === adminUser.id ? adminUser : ordinaryPgUser], rowCount: 1 };
            }
            if (text === 'SELECT count(*)::int AS total FROM users WHERE role = $1') {
                return { rows: [{ total: 1 }], rowCount: 1 };
            }
            if (text.startsWith('DELETE FROM "session"')) {
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('DELETE FROM users')) {
                return { rows: [ordinaryPgUser], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
    };
    const db = {
        async withTransaction(handler) {
            queries.push({ text: 'BEGIN', params: [] });
            try {
                const result = await handler(client);
                queries.push({ text: 'COMMIT', params: [] });
                return result;
            } catch (error) {
                queries.push({ text: 'ROLLBACK', params: [] });
                throw error;
            }
        }
    };
    const postgresStore = new PostgresAuthStore(db);

    await assert.rejects(
        () => postgresStore.deleteUser(adminUser.id),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.message, 'The last admin account cannot be deleted');
            return true;
        }
    );

    assert.deepEqual(queries.map((item) => item.text), [
        'BEGIN',
        'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
        'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1 FOR UPDATE',
        'SELECT count(*)::int AS total FROM users WHERE role = $1',
        'ROLLBACK'
    ]);

    queries.length = 0;
    const deletedPostgresUser = await postgresStore.deleteUser(ordinaryPgUser.id);
    assert.equal(deletedPostgresUser.id, ordinaryPgUser.id);
    assert.deepEqual(queries.map((item) => item.text), [
        'BEGIN',
        'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
        'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1 FOR UPDATE',
        'DELETE FROM "session" WHERE (sess->\'user\'->>\'id\' = $1 OR sess->\'pendingTotpLogin\'->\'user\'->>\'id\' = $1 OR sess->\'pendingTotpSetup\'->\'user\'->>\'id\' = $1)',
        'DELETE FROM users WHERE id = $1 RETURNING id, username, username_lower, password_hash, role',
        'COMMIT'
    ]);
});

test('auth login rate limit returns 429 after repeated attempts', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const created = await register(client, 'limited_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const firstFailure = await client.request('POST', '/api/auth/login', {
            username: 'limited_user',
            password: 'WrongPass1'
        });
        assert.equal(firstFailure.response.status, 401);

        const limited = await client.request('POST', '/api/auth/login', {
            username: 'limited_user',
            password: 'WrongPass1'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('auth login rate limit applies across usernames from one IP', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        await client.csrf();
        const firstFailure = await client.request('POST', '/api/auth/login', {
            username: 'spray_one',
            password: 'WrongPass1'
        });
        assert.equal(firstFailure.response.status, 401);

        const limited = await client.request('POST', '/api/auth/login', {
            username: 'spray_two',
            password: 'WrongPass1'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('auth registration rate limit applies across usernames from one IP', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        await client.csrf();
        const created = await client.request('POST', '/api/auth/register', {
            username: 'register_ip_one',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);

        const limited = await client.request('POST', '/api/auth/register', {
            username: 'register_ip_two',
            password: 'StrongPass1'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('TOTP setup requires auth, CSRF, and returns recovery codes once', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const anonymous = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(anonymous.response.status, 401);

        const created = await register(client, 'totp_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const initialSessionCookie = getResponseSessionCookie(created);
        assert.match(initialSessionCookie, /^ielts\.sid=/);

        const missingCsrf = await client.request('POST', '/api/auth/totp/setup', {}, { csrf: false });
        assert.equal(missingCsrf.response.status, 403);

        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);
        assert(setup.json.secret);
        assert.match(setup.json.qrCodeDataUrl, /^data:image\/png;base64,/);
        const sessionsAfterSetup = await getStoredSessions(client.sessionStore);
        const pendingSetups = Object.values(sessionsAfterSetup)
            .map((storedSession) => storedSession.pendingTotpSetup)
            .filter(Boolean);
        assert.equal(pendingSetups.length, 1);
        assert.equal(pendingSetups[0].secret, undefined);
        assert.match(pendingSetups[0].secretEncrypted, /^v1:/);
        assert(!pendingSetups[0].secretEncrypted.includes(setup.json.secret));

        const bad = await client.request('POST', '/api/auth/totp/verify-setup', { token: '000000' });
        assert.equal(bad.response.status, 401);

        const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(verified.response.status, 200);
        assert.equal(verified.json.status.enabled, true);
        assert.equal(verified.json.status.recoveryCodesRemaining, 10);
        assert.equal(verified.json.recoveryCodes.length, 10);
        const verifiedSessionCookie = getResponseSessionCookie(verified);
        assert.match(verifiedSessionCookie, /^ielts\.sid=/);
        assert.notEqual(verifiedSessionCookie, initialSessionCookie);

        const status = await client.request('GET', '/api/auth/totp/status');
        assert.equal(status.response.status, 200);
        assert.equal(status.json.status.enabled, true);
        assert.equal(status.json.status.recoveryCodesRemaining, 10);

        const repeatedSetup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(repeatedSetup.response.status, 409);
    } finally {
        await client.close();
    }
});

test('TOTP setup rejects legacy plaintext pending secrets in sessions', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'totp_legacy_plaintext', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);
        assert(setup.json.secret);

        const sessions = await getStoredSessions(client.sessionStore);
        const pendingEntry = Object.entries(sessions)
            .find(([, storedSession]) => storedSession && storedSession.pendingTotpSetup);
        assert(pendingEntry, 'expected a pending TOTP setup session');

        const [sid, storedSession] = pendingEntry;
        storedSession.pendingTotpSetup = {
            user: storedSession.pendingTotpSetup.user,
            secret: setup.json.secret,
            startedAt: Date.now()
        };
        await setStoredSession(client.sessionStore, sid, storedSession);

        const legacyVerify = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(legacyVerify.response.status, 400);
        assert.equal(legacyVerify.json.error, 'TOTP setup was not started');

        const status = await client.request('GET', '/api/auth/totp/status');
        assert.equal(status.response.status, 200);
        assert.equal(status.json.status.enabled, false);
    } finally {
        await client.close();
    }
});

test('enabling TOTP revokes other active sessions for the same user', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'totp_enable_revokes', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const otherLogin = await otherSession.request('POST', '/api/auth/login', {
            username: 'totp_enable_revokes',
            password: 'StrongPass1'
        });
        assert.equal(otherLogin.response.status, 200);
        assert.equal(otherLogin.json.user.username, 'totp_enable_revokes');

        const otherBefore = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherBefore.response.status, 200);

        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);
        const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(verified.response.status, 200);
        assert.equal(verified.json.status.enabled, true);

        const currentAfter = await client.request('GET', '/api/auth/me');
        assert.equal(currentAfter.response.status, 200);
        const otherAfter = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfter.response.status, 401);
    } finally {
        await client.close();
    }
});

test('TOTP login requires a second factor before full session access', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_login', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_login',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);
        assert.equal(passwordOnly.json.user, undefined);

        const blocked = await client.request('GET', '/api/practice-records');
        assert.equal(blocked.response.status, 401);

        const bad = await client.request('POST', '/api/auth/totp/login', { token: '000000' });
        assert.equal(bad.response.status, 401);

        const login = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        }));
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'totp_login');

        const records = await client.request('GET', '/api/practice-records');
        assert.equal(records.response.status, 200);
    } finally {
        await client.close();
    }
});

test('TOTP login treats corrupted stored secrets as invalid codes', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'totp_corrupt_secret', 'StrongPass1');
        const userId = created.json.user.id;
        const { secret } = await enableTotpForCurrentSession(client);
        const setting = client.totpStore.settings.get(userId);
        assert(setting, 'expected enabled TOTP setting');
        setting.secret_encrypted = 'not-an-encrypted-secret';

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_corrupt_secret',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        const login = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        });
        assert.equal(login.response.status, 401);
        assert.equal(login.json.error, 'TOTP code is invalid');
        assert(!login.text.includes('Internal server error'));
    } finally {
        await client.close();
    }
});

test('invalid TOTP codes do not trigger recovery code bcrypt checks', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_recovery_guard', 'StrongPass1');
        await enableTotpForCurrentSession(client);

        let recoveryChecks = 0;
        const originalConsumeRecoveryCode = client.totpStore.consumeRecoveryCode.bind(client.totpStore);
        client.totpStore.consumeRecoveryCode = async (...args) => {
            recoveryChecks += 1;
            return originalConsumeRecoveryCode(...args);
        };

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery_guard',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.json.requiresTotp, true);

        const badTotp = await client.request('POST', '/api/auth/totp/login', { token: '000000' });
        assert.equal(badTotp.response.status, 401);
        assert.equal(recoveryChecks, 0);

        const recoveryShaped = await client.request('POST', '/api/auth/totp/login', {
            token: 'ABCD-EF12-3456-7890'
        });
        assert.equal(recoveryShaped.response.status, 401);
        assert.equal(recoveryChecks, 1);
    } finally {
        await client.close();
    }
});

test('TOTP setup code cannot be reused as a login code', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_setup_replay', 'StrongPass1');
        const { setupToken } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_setup_replay',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        const replay = await client.request('POST', '/api/auth/totp/login', {
            token: setupToken
        });
        assert.equal(replay.response.status, 401);
        assert.equal(replay.json.error, 'TOTP code is invalid');
    } finally {
        await client.close();
    }
});

test('TOTP login rejects replayed current time-step tokens', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_replay', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_replay',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        let token;
        const login = await withDateNowOffset(31_000, () => {
            token = generateTotpToken(secret);
            return client.request('POST', '/api/auth/totp/login', { token });
        });
        assert.equal(login.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_replay',
            password: 'StrongPass1'
        });
        const replay = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/login', { token }));
        assert.equal(replay.response.status, 401);
        assert.equal(replay.json.error, 'TOTP code is invalid');
    } finally {
        await client.close();
    }
});

test('TOTP pending setup and login expire before verification', async () => {
    const client = await createClient();
    const realNow = Date.now;
    try {
        await register(client, 'totp_expire', 'StrongPass1');
        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);

        Date.now = () => realNow() + 11 * 60 * 1000;
        const expiredSetup = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(expiredSetup.response.status, 401);
        assert.equal(expiredSetup.json.error, 'TOTP setup expired');
        Date.now = realNow;

        const freshSetup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(freshSetup.response.status, 200);
        const enabled = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(freshSetup.json.secret)
        });
        assert.equal(enabled.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_expire',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        Date.now = () => realNow() + 11 * 60 * 1000;
        const expiredLogin = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(freshSetup.json.secret)
        });
        assert.equal(expiredLogin.response.status, 401);
        assert.equal(expiredLogin.json.error, 'TOTP login expired');
    } finally {
        Date.now = realNow;
        await client.close();
    }
});

test('TOTP recovery codes are one-time and can be regenerated', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_recovery', 'StrongPass1');
        const { secret, recoveryCodes } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.json.requiresTotp, true);

        const recoveryLogin = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[0]
        });
        assert.equal(recoveryLogin.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        const reused = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[0]
        });
        assert.equal(reused.response.status, 401);

        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        const login = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[1]
        });
        assert.equal(login.response.status, 200);

        const missingToken = await client.request('POST', '/api/auth/totp/recovery-codes');
        assert.equal(missingToken.response.status, 401);

        const regenerated = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/recovery-codes', {
            token: generateTotpToken(secret)
        }));
        assert.equal(regenerated.response.status, 200);
        assert.equal(regenerated.json.recoveryCodes.length, 10);
        assert.equal(regenerated.json.status.recoveryCodesRemaining, 10);
    } finally {
        await client.close();
    }
});

test('Postgres TOTP recovery code consumption requires an unused row update', async () => {
    const calls = [];
    const makeDb = (updateRowCount) => ({
        markUsed: false,
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT id, code_hash')) {
                return { rows: [{ id: 'recovery-1', code_hash: 'stored-hash' }] };
            }
            if (sql.includes('UPDATE user_totp_recovery_codes')) {
                return { rowCount: updateRowCount };
            }
            if (sql.includes('UPDATE user_totp_settings')) {
                this.markUsed = true;
                return { rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    });
    const bcryptImpl = { compare: async () => true };

    const staleDb = makeDb(0);
    const staleStore = new PostgresTotpStore(staleDb);
    assert.equal(await staleStore.consumeRecoveryCode('user-id', 'AAAA-BBBB', bcryptImpl), false);
    assert.equal(calls.length, 0);
    assert.equal(await staleStore.consumeRecoveryCode('user-id', 'AAAA-BBBB-CCCC-DDDD', bcryptImpl), false);
    assert.equal(staleDb.markUsed, false);
    assert.match(
        calls.find((call) => call.sql.includes('UPDATE user_totp_recovery_codes')).sql,
        /used_at IS NULL/
    );

    calls.length = 0;
    const freshDb = makeDb(1);
    const freshStore = new PostgresTotpStore(freshDb);
    assert.equal(await freshStore.consumeRecoveryCode('user-id', 'AAAA-BBBB-CCCC-DDDD', bcryptImpl), true);
    assert.equal(freshDb.markUsed, true);
});

test('Postgres TOTP time-step consumption rejects stale updates', async () => {
    const calls = [];
    const makeDb = (updateRowCount) => ({
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('UPDATE user_totp_settings')) {
                return { rowCount: updateRowCount };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    });

    const staleStore = new PostgresTotpStore(makeDb(0));
    assert.equal(await staleStore.consumeTotpStep('user-id', 12345), false);
    assert.match(calls[0].sql, /last_totp_step IS NULL OR last_totp_step < \$2/);
    assert.deepEqual(calls[0].params, ['user-id', 12345]);

    calls.length = 0;
    const freshStore = new PostgresTotpStore(makeDb(1));
    assert.equal(await freshStore.consumeTotpStep('user-id', 12346), true);
});

test('ordinary users can disable TOTP with password and current code', async () => {
    const client = await createClient();
    try {
        const passwordAtLimit = `Aa1${'x'.repeat(69)}`;
        const extendedPassword = `${passwordAtLimit}Z`;
        assert.equal(Buffer.byteLength(passwordAtLimit, 'utf8'), 72);
        assert(Buffer.byteLength(extendedPassword, 'utf8') > 72);
        await register(client, 'totp_disable', passwordAtLimit);
        const { secret } = await enableTotpForCurrentSession(client);

        const wrongPassword = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: 'WrongPass1',
            token: generateTotpToken(secret)
        }));
        assert.equal(wrongPassword.response.status, 401);

        const extendedPasswordAttempt = await withDateNowOffset(61_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: extendedPassword,
            token: generateTotpToken(secret)
        }));
        assert.equal(extendedPasswordAttempt.response.status, 401);
        assert.equal(extendedPasswordAttempt.json.error, 'Password is incorrect');

        const disabled = await withDateNowOffset(91_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: passwordAtLimit,
            token: generateTotpToken(secret)
        }));
        assert.equal(disabled.response.status, 200);
        assert.equal(disabled.json.status.enabled, false);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'totp_disable',
            password: passwordAtLimit
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'totp_disable');
    } finally {
        await client.close();
    }
});

test('disabling TOTP revokes other active sessions for the same user', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_disable_revokes', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const passwordOnly = await otherSession.request('POST', '/api/auth/login', {
            username: 'totp_disable_revokes',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);
        const otherLogin = await withDateNowOffset(31_000, () => otherSession.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        }));
        assert.equal(otherLogin.response.status, 200);

        const otherBefore = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherBefore.response.status, 200);

        const disabled = await withDateNowOffset(62_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: 'StrongPass1',
            token: generateTotpToken(secret)
        }));
        assert.equal(disabled.response.status, 200);
        assert.equal(disabled.json.status.enabled, false);
        assert.equal(disabled.json.user.username, 'totp_disable_revokes');
        assert(disabled.json.csrfToken);

        const currentAfter = await client.request('GET', '/api/auth/me');
        assert.equal(currentAfter.response.status, 200);
        const otherAfter = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfter.response.status, 401);
    } finally {
        await client.close();
    }
});

test('removed passkey API returns 404', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const response = await client.request('POST', '/api/auth/passkeys/login/options', {});
        assert.equal(response.response.status, 404);
    } finally {
        await client.close();
    }
});

test('practice API requires authentication', async () => {
    const client = await createClient();
    try {
        const response = await client.request('GET', '/api/practice-records');
        assert.equal(response.response.status, 401);
    } finally {
        await client.close();
    }
});

test('practice import deduplicates by id and non-empty sessionId', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'import_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const imported = await client.request('POST', '/api/practice-records/import', {
            records: [
                { id: 'record-a', sessionId: 'session-1', type: 'reading', score: 70, date: '2026-01-01T00:00:00.000Z' },
                { id: 'record-a', sessionId: 'session-1', type: 'reading', score: 80, date: '2026-01-02T00:00:00.000Z' },
                { id: 'record-b', sessionId: 'session-1', type: 'reading', score: 90, date: '2026-01-03T00:00:00.000Z' },
                { id: 'record-c', sessionId: 'session-2', type: 'listening', score: 60, date: '2026-01-04T00:00:00.000Z' }
            ]
        });
        assert.equal(imported.response.status, 201);
        assert.equal(imported.json.records.length, 2);
        assert.deepEqual(
            imported.json.records.map((record) => record.sessionId).sort(),
            ['session-1', 'session-2']
        );

        const listed = await client.request('GET', '/api/practice-records');
        assert.equal(listed.json.records.length, 2);
    } finally {
        await client.close();
    }
});

test('PUT practice records replaces the list returned by GET', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'replace_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const records = [
            { id: 'first', sessionId: 's-first', type: 'reading', score: 55, date: '2026-02-01T00:00:00.000Z' },
            { id: 'second', sessionId: 's-second', type: 'listening', score: 75, date: '2026-02-02T00:00:00.000Z' }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);
        assert.deepEqual(replaced.json.records, records);

        const listed = await client.request('GET', '/api/practice-records');
        assert.deepEqual(listed.json.records, records);
    } finally {
        await client.close();
    }
});

test('PUT practice records deduplicates duplicate session ids before storing', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'replace_dedupe_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const replaced = await client.request('PUT', '/api/practice-records', {
            records: [
                { id: 'older-record', sessionId: 'same-session', score: 40, date: '2026-02-01T00:00:00.000Z' },
                { id: 'newer-record', sessionId: 'same-session', score: 85, date: '2026-02-02T00:00:00.000Z' },
                { id: 'moved-record', sessionId: 'old-session', score: 50, date: '2026-02-03T00:00:00.000Z' },
                { id: 'moved-record', sessionId: 'new-session', score: 60, date: '2026-02-04T00:00:00.000Z' },
                { id: 'separate-record', sessionId: 'old-session', score: 70, date: '2026-02-05T00:00:00.000Z' }
            ]
        });
        assert.equal(replaced.response.status, 200);
        assert.equal(replaced.json.records.length, 3);
        assert.deepEqual(
            replaced.json.records.map((record) => [record.id, record.sessionId, record.score]),
            [
                ['newer-record', 'same-session', 85],
                ['moved-record', 'new-session', 60],
                ['separate-record', 'old-session', 70]
            ]
        );

        const listed = await client.request('GET', '/api/practice-records');
        assert.equal(listed.json.records.length, 3);
        assert.deepEqual(
            listed.json.records.map((record) => [record.id, record.sessionId, record.score]),
            [
                ['newer-record', 'same-session', 85],
                ['moved-record', 'new-session', 60],
                ['separate-record', 'old-session', 70]
            ]
        );
    } finally {
        await client.close();
    }
});

test('admin API rejects anonymous and non-admin users', async () => {
    const client = await createClient();
    try {
        const anonymous = await client.request('GET', '/api/admin/summary');
        assert.equal(anonymous.response.status, 401);

        const anonymousExport = await client.request('GET', '/api/admin/export?dataset=users');
        assert.equal(anonymousExport.response.status, 401);

        const created = await register(client, 'ordinary_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        assert.equal(created.json.user.role, 'user');

        const forbidden = await client.request('GET', '/api/admin/summary');
        assert.equal(forbidden.response.status, 403);

        const forbiddenExport = await client.request('GET', '/api/admin/export?dataset=users');
        assert.equal(forbiddenExport.response.status, 403);

        const adminPage = await client.request('GET', '/admin');
        assert.equal(adminPage.response.status, 403);
    } finally {
        await client.close();
    }
});

test('admin dashboard redirects anonymous users through auth handoff', async () => {
    const client = await createClient();
    try {
        const dashboard = await client.request('GET', '/admin', undefined, { redirect: 'manual' });
        assert.equal(dashboard.response.status, 302);
        assertAuthStartRedirect(dashboard.response.headers.get('location'), 'admin', '/admin');

        const accountPage = await client.request('GET', '/admin/account?userId=11111111-1111-4111-8111-111111111111', undefined, { redirect: 'manual' });
        assert.equal(accountPage.response.status, 302);
        assertAuthStartRedirect(
            accountPage.response.headers.get('location'),
            'admin',
            '/admin/account?userId=11111111-1111-4111-8111-111111111111'
        );

        const legacyLoginPage = await client.request('GET', '/admin/login', undefined, { redirect: 'manual' });
        assert.equal(legacyLoginPage.response.status, 302);
        assertAuthStartRedirect(legacyLoginPage.response.headers.get('location'), 'admin', '/admin');

        const authLoginPage = await client.request('GET', '/auth/login');
        assert.equal(authLoginPage.response.status, 200);
        assert.match(authLoginPage.text, /IELTS Atlas Auth/);
        assert.match(authLoginPage.text, /id="auth-tabs"/);

        const businessLoginPage = await client.request('GET', '/auth/business/login');
        assert.equal(businessLoginPage.response.status, 200);
        const adminLoginPage = await client.request('GET', '/auth/admin/login');
        assert.equal(adminLoginPage.response.status, 200);
        assert.doesNotMatch(authLoginPage.text, /js\/bundles\//);

        const authLoginScript = await client.request('GET', '/auth/login.js');
        assert.equal(authLoginScript.response.status, 200);
        assert.match(authLoginScript.text, /\/api\/auth\/login/);

        const authLoginStyles = await client.request('GET', '/auth/login.css');
        assert.equal(authLoginStyles.response.status, 200);
        assert.match(authLoginStyles.text, /auth-shell/);

        const authAccountPage = await client.request('GET', '/auth/account', undefined, { redirect: 'manual' });
        assert.equal(authAccountPage.response.status, 401);

        const loginPage = await client.request('GET', '/admin/login.js');
        assert.equal(loginPage.response.status, 200);
        assert.doesNotMatch(loginPage.text, /js\/bundles\//);
        assert.doesNotMatch(loginPage.text, /account-view/);

        const api = await client.request('GET', '/api/admin/summary');
        assert.equal(api.response.status, 401);
    } finally {
        await client.close();
    }
});

test('admin shell and business account menu do not link back through the business home', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const adminScript = fs.readFileSync(path.join(repoRoot, 'backend', 'admin', 'admin.js'), 'utf8');
    const adminIndex = fs.readFileSync(path.join(repoRoot, 'backend', 'admin', 'index.html'), 'utf8');
    const adminAccountPage = fs.readFileSync(path.join(repoRoot, 'backend', 'admin', 'account.html'), 'utf8');
    const adminAccountScript = fs.readFileSync(path.join(repoRoot, 'backend', 'admin', 'account.js'), 'utf8');
    const adminProxyConfig = fs.readFileSync(path.join(repoRoot, 'backend', 'admin-proxy', 'nginx.conf'), 'utf8');
    const businessProxyConfig = fs.readFileSync(path.join(repoRoot, 'backend', 'business-proxy', 'nginx.conf'), 'utf8');
    const authProxyConfig = fs.readFileSync(path.join(repoRoot, 'backend', 'auth-proxy', 'nginx.conf'), 'utf8');
    const authOverlay = fs.readFileSync(path.join(repoRoot, 'js', 'data', 'authOverlay.js'), 'utf8');

    assert(adminScript.includes("window.location.href = '/auth/admin/start?return_to=/admin'"));
    assert(adminScript.includes("fetch('/api/auth/me'"));
    assert(adminScript.includes('/api/admin/summary'));
    assert(adminScript.includes('/api/admin/export?dataset='));
    assert(adminScript.includes('/admin/account?userId='));
    assert(adminScript.includes("headers['X-CSRF-Token']"));
    assert(adminIndex.includes('metric-registered-users'));
    assert(adminIndex.includes('data-export-dataset="practice-records"'));
    assert(adminIndex.includes('open-account-center'));
    assert(adminAccountPage.includes('/admin/account.js'));
    assert(adminAccountPage.includes('/admin/account.css'));
    assert.doesNotMatch(adminAccountPage, /js\/bundles\//);
    assert(adminAccountScript.includes('/api/admin/users/'));
    assert(adminAccountScript.includes('/practice-records?limit='));
    assert(adminAccountScript.includes('/auth/admin/start?return_to=/admin/account'));
    assert(adminProxyConfig.includes('location = /admin/account'));
    assert(adminProxyConfig.includes('location = /admin/account.js'));
    assert(adminProxyConfig.includes('location = /admin/account.css'));
    assert(adminProxyConfig.includes('location = /auth/admin/start'));
    assert(adminProxyConfig.includes('location = /auth/admin/callback'));
    assert(adminProxyConfig.includes('location = /auth/business/callback'));
    assert(adminProxyConfig.includes('proxy_set_header X-Ielts-Onion-Audience admin;'));
    assert(adminProxyConfig.includes('proxy_set_header Host admin.local;'));
    assert(adminProxyConfig.includes('proxy_set_header X-Forwarded-Host admin.local;'));
    assert(adminProxyConfig.includes('proxy_set_header X-Forwarded-Proto http;'));
    assert(!adminProxyConfig.includes('proxy_set_header Host $host;'));
    assert(!adminProxyConfig.includes('proxy_set_header X-Forwarded-Host $host;'));
    assert(!adminProxyConfig.includes('proxy_set_header X-Forwarded-Proto $scheme;'));
    assert(!adminProxyConfig.includes('location = /auth/business/start'));
    assert(!adminProxyConfig.includes('location = /api/auth/login'));
    assert(businessProxyConfig.includes('location = /auth/business/start'));
    assert(businessProxyConfig.includes('location = /auth/business/callback'));
    assert(businessProxyConfig.includes('location = /auth/admin/callback'));
    assert(businessProxyConfig.includes('proxy_set_header X-Ielts-Onion-Audience business;'));
    assert(businessProxyConfig.includes('proxy_set_header Host business.local;'));
    assert(businessProxyConfig.includes('proxy_set_header X-Forwarded-Host business.local;'));
    assert(businessProxyConfig.includes('proxy_set_header X-Forwarded-Proto http;'));
    assert(!businessProxyConfig.includes('proxy_set_header Host $host;'));
    assert(!businessProxyConfig.includes('proxy_set_header X-Forwarded-Host $host;'));
    assert(!businessProxyConfig.includes('proxy_set_header X-Forwarded-Proto $scheme;'));
    assert(!businessProxyConfig.includes('location = /auth/admin/start'));
    assert(businessProxyConfig.includes('location = /api/auth/login { return 404; }'));
    assert(businessProxyConfig.includes('location ^~ /api/auth/totp/ { return 404; }'));
    assert(authProxyConfig.includes('location = /auth/login'));
    assert(authProxyConfig.includes('location = /auth/business/login'));
    assert(authProxyConfig.includes('location = /auth/admin/login'));
    assert(authProxyConfig.includes('location = /auth/complete'));
    assert(authProxyConfig.includes('location ^~ /api/auth/'));
    assert(authProxyConfig.includes('location ^~ /api/admin/ { return 404; }'));
    assert(authProxyConfig.includes('location ^~ /api/practice-records { return 404; }'));
    assert(authProxyConfig.includes('proxy_set_header X-Ielts-Onion-Audience auth;'));
    assert(authProxyConfig.includes('proxy_set_header Host auth.local;'));
    assert(authProxyConfig.includes('proxy_set_header X-Forwarded-Host auth.local;'));
    assert(authProxyConfig.includes('proxy_set_header X-Forwarded-Proto http;'));
    assert(!authProxyConfig.includes('proxy_set_header Host $host;'));
    assert(!authProxyConfig.includes('proxy_set_header X-Forwarded-Host $host;'));
    assert(!authProxyConfig.includes('proxy_set_header X-Forwarded-Proto $scheme;'));
    assert.doesNotMatch(adminScript, /\/api\/auth\/user/);
    assert.doesNotMatch(adminScript, /window\.location\.href\s*=\s*['"]\/['"]/);
    assert.doesNotMatch(adminIndex, /href=["']\/["'][^>]*>\s*App\s*</);
    assert.doesNotMatch(authOverlay, /remote-auth-account__admin/);
    assert.doesNotMatch(authOverlay, /href\s*=\s*['"]\/admin['"]/);
});

test('auth handoff creates a one-time business session ticket', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=/practice/reading/p1-high-01', undefined, {
            redirect: 'manual',
            headers: {
                host: 'business.local',
                'x-forwarded-host': 'business.local',
                'x-forwarded-proto': 'http',
                'x-ielts-onion-audience': 'business'
            }
        });
        assert.equal(start.response.status, 302);
        assert.equal(parseRedirectLocation(start.response.headers.get('location')).pathname, '/auth/business/login');
        const state = getRedirectParam(start.response.headers.get('location'), 'state');
        assert(state);

        const created = await register(authSession, 'handoff_business', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));
        assert.equal(callbackUrl.pathname, '/auth/business/callback');
        assert(callbackUrl.searchParams.get('ticket'));

        const differentBrowser = client.createSession();
        const crossBrowser = await differentBrowser.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(crossBrowser.response.status, 403);

        const callback = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(callback.response.status, 302);
        assert.equal(callback.response.headers.get('location'), '/practice/reading/p1-high-01');

        const me = await targetSession.request('GET', '/api/auth/me');
        assert.equal(me.response.status, 200);
        assert.equal(me.json.user.username, 'handoff_business');

        const repeated = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(repeated.response.status, 403);
    } finally {
        await client.close();
    }
});

test('auth handoff ignores poisoned forwarded hosts and validates canonical start hosts', async () => {
    const client = await createClient({
        authPublicUrl: 'http://auth.example',
        businessPublicUrl: 'http://business.example',
        adminPublicUrl: 'http://admin.example'
    });
    try {
        const poisoned = await client.request('GET', '/auth/business/start?return_to=/', undefined, {
            redirect: 'manual',
            headers: {
                host: 'business.local',
                'x-forwarded-host': 'evil.example',
                'x-ielts-onion-audience': 'business'
            }
        });
        assert.equal(poisoned.response.status, 400);

        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=/practice/reading/p1-high-01', undefined, {
            redirect: 'manual',
            headers: {
                host: 'business.local',
                'x-forwarded-host': 'business.local',
                'x-forwarded-proto': 'http',
                'x-ielts-onion-audience': 'business'
            }
        });
        assert.equal(start.response.status, 302);
        assert.equal(parseRedirectLocation(start.response.headers.get('location')).origin, 'http://auth.example');
        const state = getRedirectParam(start.response.headers.get('location'), 'state');
        assert(state);

        await register(authSession, 'handoff_poison_guard', 'StrongPass1');
        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));
        assert.equal(callbackUrl.origin, 'http://business.example');
        assert.equal(callbackUrl.pathname, '/auth/business/callback');
    } finally {
        await client.close();
    }
});

test('auth handoff requires explicit public URLs in production', async () => {
    const client = await createClient({
        nodeEnv: 'production',
        sessionSecret: 'production-test-session-secret-1234567890',
        totpEncryptionKey: 'production-test-totp-key-1234567890'
    });
    try {
        const start = await client.request('GET', '/auth/business/start?return_to=/', undefined, {
            redirect: 'manual',
            headers: {
                host: 'business.local',
                'x-forwarded-host': 'business.local',
                'x-forwarded-proto': 'http',
                'x-ielts-onion-audience': 'business'
            }
        });
        assert.equal(start.response.status, 500);
        assert.match(start.text, /public URLs are not configured/);
    } finally {
        await client.close();
    }
});

test('auth login binds signed handoff state to an audience-specific entry', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const businessStart = await targetSession.request('GET', '/auth/business/start?return_to=/practice/reading/p1-high-01', undefined, { redirect: 'manual' });
        const businessState = getRedirectParam(businessStart.response.headers.get('location'), 'state');

        const genericBusiness = await targetSession.request('GET', `/auth/login?state=${encodeURIComponent(businessState)}`, undefined, { redirect: 'manual' });
        assert.equal(genericBusiness.response.status, 302);
        assert.equal(parseRedirectLocation(genericBusiness.response.headers.get('location')).pathname, '/auth/business/login');
        assert.equal(getRedirectParam(genericBusiness.response.headers.get('location'), 'state'), businessState);

        const anonymousComplete = await targetSession.request('GET', `/auth/complete?state=${encodeURIComponent(businessState)}`, undefined, { redirect: 'manual' });
        assert.equal(anonymousComplete.response.status, 302);
        assert.equal(parseRedirectLocation(anonymousComplete.response.headers.get('location')).pathname, '/auth/business/login');

        const adminStart = await targetSession.request('GET', '/auth/admin/start?return_to=/admin', undefined, { redirect: 'manual' });
        const adminState = getRedirectParam(adminStart.response.headers.get('location'), 'state');
        const genericAdmin = await targetSession.request('GET', `/auth/login?state=${encodeURIComponent(adminState)}`, undefined, { redirect: 'manual' });
        assert.equal(genericAdmin.response.status, 302);
        assert.equal(parseRedirectLocation(genericAdmin.response.headers.get('location')).pathname, '/auth/admin/login');
        assert.equal(getRedirectParam(genericAdmin.response.headers.get('location'), 'state'), adminState);

        const invalid = await targetSession.request('GET', '/auth/login?state=not-a-valid-state', undefined, { redirect: 'manual' });
        assert.equal(invalid.response.status, 400);
    } finally {
        await client.close();
    }
});

test('auth complete JSON mode returns redirect payloads and structured errors', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=/', undefined, { redirect: 'manual' });
        const state = getRedirectParam(start.response.headers.get('location'), 'state');

        await register(authSession, 'handoff_json', 'StrongPass1');
        const mismatch = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}&format=json&audience=admin`);
        assert.equal(mismatch.response.status, 400);
        assert.deepEqual(mismatch.json, { error: 'Auth handoff audience mismatch' });

        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}&format=json&audience=business`);
        assert.equal(complete.response.status, 200);
        assert.match(complete.json.redirectTo, /^\/auth\/business\/callback\?ticket=/);

        const nonAdminTarget = client.createSession();
        const nonAdminStart = await nonAdminTarget.request('GET', '/auth/admin/start?return_to=/admin', undefined, { redirect: 'manual' });
        const adminState = getRedirectParam(nonAdminStart.response.headers.get('location'), 'state');
        const wrongEntry = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(adminState)}&format=json&audience=business`);
        assert.equal(wrongEntry.response.status, 400);
        assert.deepEqual(wrongEntry.json, { error: 'Auth handoff audience mismatch' });

        const denied = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(adminState)}&format=json`);
        assert.equal(denied.response.status, 403);
        assert.deepEqual(denied.json, { error: 'Admin access required' });
    } finally {
        await client.close();
    }
});

test('auth handoff rejects unsafe return paths and audience mismatches', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=https%3A%2F%2Fevil.example%2Fadmin', undefined, { redirect: 'manual' });
        assert.equal(start.response.status, 302);
        const state = getRedirectParam(start.response.headers.get('location'), 'state');
        assert(state);

        const created = await register(authSession, 'handoff_guard', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));
        assert.equal(callbackUrl.pathname, '/auth/business/callback');

        const wrongAudience = await targetSession.request('GET', `/auth/admin/callback${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(wrongAudience.response.status, 403);

        const callback = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(callback.response.status, 302);
        assert.equal(callback.response.headers.get('location'), '/');
    } finally {
        await client.close();
    }
});

test('auth callback uses proxy audience headers to rescue misdirected tickets', async () => {
    const client = await createClient({
        authPublicUrl: 'http://auth.example',
        businessPublicUrl: 'http://business.example',
        adminPublicUrl: 'http://admin.example'
    });
    try {
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=/practice/reading/p1-high-01', undefined, {
            redirect: 'manual',
            headers: {
                host: 'business.local',
                'x-forwarded-host': 'business.local',
                'x-forwarded-proto': 'http',
                'x-ielts-onion-audience': 'business'
            }
        });
        const state = getRedirectParam(start.response.headers.get('location'), 'state');
        assert(state);

        await register(authSession, 'handoff_host_rescue', 'StrongPass1');
        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));
        assert.equal(callbackUrl.origin, 'http://business.example');
        assert.equal(callbackUrl.pathname, '/auth/business/callback');

        const misdirected = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, {
            redirect: 'manual',
            headers: {
                'x-ielts-onion-audience': 'admin'
            }
        });
        assert.equal(misdirected.response.status, 302);
        assert.equal(
            misdirected.response.headers.get('location'),
            `http://business.example${callbackUrl.pathname}${callbackUrl.search}`
        );

        const callback = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, {
            redirect: 'manual',
            headers: {
                'x-ielts-onion-audience': 'business'
            }
        });
        assert.equal(callback.response.status, 302);
        assert.equal(callback.response.headers.get('location'), '/practice/reading/p1-high-01');
    } finally {
        await client.close();
    }
});

test('auth handoff rejects expired tickets', async () => {
    const client = await createClient({ authHandoffTicketTtlMs: 10 });
    try {
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/business/start?return_to=/', undefined, { redirect: 'manual' });
        const state = getRedirectParam(start.response.headers.get('location'), 'state');

        await register(authSession, 'handoff_expired', 'StrongPass1');
        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));

        const expired = await withDateNowOffset(1000, () => targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' }));
        assert.equal(expired.response.status, 403);
    } finally {
        await client.close();
    }
});

test('admin auth handoff requires admin role and TOTP verification', async () => {
    const client = await createClient();
    try {
        const nonAdminTarget = client.createSession();
        const nonAdminAuth = client.createSession();
        const nonAdminStart = await nonAdminTarget.request('GET', '/auth/admin/start?return_to=/admin', undefined, { redirect: 'manual' });
        const nonAdminState = getRedirectParam(nonAdminStart.response.headers.get('location'), 'state');
        await register(nonAdminAuth, 'handoff_non_admin', 'StrongPass1');
        const nonAdminComplete = await nonAdminAuth.request('GET', `/auth/complete?state=${encodeURIComponent(nonAdminState)}`, undefined, { redirect: 'manual' });
        assert.equal(nonAdminComplete.response.status, 403);

        await seedAdmin(client, 'handoff_admin', 'StrongPass1');
        const targetSession = client.createSession();
        const authSession = client.createSession();
        const start = await targetSession.request('GET', '/auth/admin/start?return_to=/admin', undefined, { redirect: 'manual' });
        assert.equal(start.response.status, 302);
        assert.equal(parseRedirectLocation(start.response.headers.get('location')).pathname, '/auth/admin/login');
        const state = getRedirectParam(start.response.headers.get('location'), 'state');
        assert(state);

        await authSession.csrf();
        const passwordLogin = await authSession.request('POST', '/api/auth/login', {
            username: 'handoff_admin',
            password: 'StrongPass1'
        });
        assert.equal(passwordLogin.response.status, 200);
        assert.equal(passwordLogin.json.requiresTotpSetup, true);

        await enableTotpForCurrentSession(authSession);
        const complete = await authSession.request('GET', `/auth/complete?state=${encodeURIComponent(state)}`, undefined, { redirect: 'manual' });
        assert.equal(complete.response.status, 302);
        const callbackUrl = parseRedirectLocation(complete.response.headers.get('location'));
        assert.equal(callbackUrl.pathname, '/auth/admin/callback');

        const callback = await targetSession.request('GET', `${callbackUrl.pathname}${callbackUrl.search}`, undefined, { redirect: 'manual' });
        assert.equal(callback.response.status, 302);
        assert.equal(callback.response.headers.get('location'), '/admin');

        const adminPage = await targetSession.request('GET', '/admin');
        assert.equal(adminPage.response.status, 200);
    } finally {
        await client.close();
    }
});

test('practice API rejects unsafe record identifiers and oversized batches', async () => {
    const client = await createClient();
    try {
        await register(client, 'practice_bounds', 'StrongPass1');

        const longId = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'x'.repeat(513), title: 'Too long' }]
        });
        assert.equal(longId.response.status, 400);

        const longSession = await client.request('POST', '/api/practice-records/import', {
            records: [{ id: 'safe-id', sessionId: 's'.repeat(513) }]
        });
        assert.equal(longSession.response.status, 400);

        const controlId = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'record\nheader', title: 'Bad id' }]
        });
        assert.equal(controlId.response.status, 400);
        assert.equal(controlId.json.error, 'id contains unsafe control characters');
        assert.equal(controlId.json.details.field, 'id');

        const controlSession = await client.request('POST', '/api/practice-records/import', {
            records: [{ id: 'safe-control-id', sessionId: 'session\rvalue' }]
        });
        assert.equal(controlSession.response.status, 400);
        assert.equal(controlSession.json.error, 'sessionId contains unsafe control characters');
        assert.equal(controlSession.json.details.field, 'sessionId');

        const controlTitle = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'safe-title-id', title: 'Bad\ntitle' }]
        });
        assert.equal(controlTitle.response.status, 400);
        assert.equal(controlTitle.json.error, 'title contains unsafe control characters');
        assert.equal(controlTitle.json.details.field, 'title');

        const controlType = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'safe-type-id', type: 'reading\ttab' }]
        });
        assert.equal(controlType.response.status, 400);
        assert.equal(controlType.json.error, 'type contains unsafe control characters');
        assert.equal(controlType.json.details.field, 'type');

        const oversized = await client.request('PUT', '/api/practice-records', {
            records: Array.from({ length: 5001 }, (_, index) => ({ id: `record-${index}` }))
        });
        assert.equal(oversized.response.status, 413);

        const polluted = JSON.parse('{"id":"polluted-record","payload":{"nested":{"__proto__":{"admin":true}}}}');
        const unsafePayload = await client.request('PUT', '/api/practice-records', {
            records: [polluted]
        });
        assert.equal(unsafePayload.response.status, 400);
        assert.equal(unsafePayload.json.error, 'practice record contains an unsafe key');
        assert.equal(unsafePayload.json.details.field, 'record.payload.nested.__proto__');

        const nullCharacterPayload = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'null-character-record', title: 'bad\u0000title' }]
        });
        assert.equal(nullCharacterPayload.response.status, 400);
        assert.equal(nullCharacterPayload.json.error, 'practice record payload contains an unsupported null character');
        assert.equal(nullCharacterPayload.json.details.field, 'record.title');
    } finally {
        await client.close();
    }
});

test('practice record import cannot grow beyond the batch record cap', () => {
    const existing = Array.from({ length: 5000 }, (_, index) => ({ id: `existing-${index}` }));
    assert.throws(
        () => mergePracticeRecords(existing, [{ id: 'one-too-many' }]),
        (error) => {
            assert.match(error.message, /too many practice records/);
            assert.equal(error.status, 413);
            assert.equal(error.details.maxRecords, 5000);
            return true;
        }
    );
});

test('practice record normalization rejects circular payloads without overflowing the stack', () => {
    const record = { id: 'cycle-record', payload: { ok: true } };
    record.payload.self = record.payload;
    assert.throws(
        () => normalizePracticeRecord(record),
        /circular reference/
    );
});

test('practice record normalization and memory store do not expose mutable payload aliases', async () => {
    const original = {
        id: 'alias-record',
        payload: {
            answers: [
                { question: 1, value: 'A' }
            ]
        }
    };
    const normalized = normalizePracticeRecord(original);
    original.payload.answers[0].value = 'B';
    assert.equal(normalized.payload.answers[0].value, 'A');

    const store = new MemoryPracticeRecordStore();
    const saved = await store.replace('alias-user', [
        { id: 'store-record', payload: { nested: { value: 'initial' } } }
    ]);
    saved[0].payload.nested.value = 'mutated-return-value';

    const listed = await store.list('alias-user');
    assert.equal(listed[0].payload.nested.value, 'initial');
    listed[0].payload.nested.value = 'mutated-list-value';

    const listedAgain = await store.list('alias-user');
    assert.equal(listedAgain[0].payload.nested.value, 'initial');
});

test('practice record normalization rejects non-JSON payload values before serialization', () => {
    assert.throws(
        () => normalizePracticeRecord({ id: 'bigint-record', payload: { value: 10n } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains a non-JSON value');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'symbol-record', payload: { value: Symbol('bad') } }),
        /non-JSON value/
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'nan-record', payload: { value: Number.NaN } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains a non-finite number');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'null-record', payload: { value: 'bad\u0000value' } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains an unsupported null character');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'surrogate-record', payload: { value: 'bad\uD800value' } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains invalid Unicode');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
});

test('practice record normalization clamps numeric statistics', () => {
    const normalized = normalizePracticeRecord({
        id: 'numeric-record',
        score: 999,
        accuracy: -20,
        totalQuestions: 5.8,
        correctAnswers: 99,
        duration: -30
    });
    assert.equal(normalized.score, 100);
    assert.equal(normalized.accuracy, 0);
    assert.equal(normalized.totalQuestions, 5);
    assert.equal(normalized.correctAnswers, 5);
    assert.equal(normalized.duration, 0);

    const fallback = normalizePracticeRecord({
        id: 'score-info-record',
        scoreInfo: {
            percentage: -10,
            total: 20000,
            correct: 15000
        },
        duration: Number.MAX_VALUE
    });
    assert.equal(fallback.score, 0);
    assert.equal(fallback.totalQuestions, 10000);
    assert.equal(fallback.correctAnswers, 10000);
    assert.equal(fallback.duration, 365 * 24 * 60 * 60);

    assert.deepEqual(extractColumns(fallback), {
        sessionId: null,
        examId: null,
        type: null,
        title: null,
        score: 0,
        totalQuestions: 10000,
        correctAnswers: 10000,
        duration: 365 * 24 * 60 * 60
    });
});

test('practice record metadata truncation preserves valid Unicode', () => {
    const normalized = normalizePracticeRecord({
        id: 'unicode-metadata-record',
        title: `${'a'.repeat(499)}😀tail`,
        type: `${'b'.repeat(63)}😀tail`
    });

    assert.equal(normalized.title, 'a'.repeat(499));
    assert.equal(normalized.type, 'b'.repeat(63));
    assert.doesNotThrow(() => normalizePracticeRecord({
        id: 'unicode-metadata-record-2',
        title: `${'a'.repeat(498)}😀tail`
    }));
});

test('admin record serialization redacts sensitive payload fields', () => {
    const payload = JSON.parse(`{
        "sessionId": "visible-session",
        "title": "Visible Practice",
        "accessToken": "token-secret",
        "csrf_token": "csrf-secret",
        "apiKey": "api-key-secret",
        "xApiKey": "x-api-key-secret",
        "openai_api_key": "openai-api-key-secret",
        "accessKeyId": "access-key-secret",
        "payload": {
            "password": "password-secret",
            "recoveryCode": "recovery-secret",
            "nested": {
                "safe": "visible-value",
                "totpSecret": "totp-secret"
            }
        },
        "correctAnswers": { "q1": "A" },
        "answerKey": { "q1": "A" },
        "__proto__": { "polluted": true }
    }`);

    const serialized = serializeRecord({
        id: 'record-1',
        payload
    });
    const serializedJson = JSON.stringify(serialized);

    assert.equal(serialized.sessionId, 'visible-session');
    assert.equal(serialized.title, 'Visible Practice');
    assert.equal(serialized.payload.accessToken, '[redacted]');
    assert.equal(serialized.payload.csrf_token, '[redacted]');
    assert.equal(serialized.payload.apiKey, '[redacted]');
    assert.equal(serialized.payload.xApiKey, '[redacted]');
    assert.equal(serialized.payload.openai_api_key, '[redacted]');
    assert.equal(serialized.payload.accessKeyId, '[redacted]');
    assert.equal(serialized.payload.payload.password, '[redacted]');
    assert.equal(serialized.payload.payload.recoveryCode, '[redacted]');
    assert.equal(serialized.payload.payload.nested.totpSecret, '[redacted]');
    assert.equal(serialized.payload.payload.nested.safe, 'visible-value');
    assert.deepEqual(serialized.payload.correctAnswers, { q1: 'A' });
    assert.deepEqual(serialized.payload.answerKey, { q1: 'A' });
    assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, '__proto__'), false);
    assert.equal({}.polluted, undefined);
    assert.doesNotMatch(serializedJson, /token-secret|csrf-secret|api-key-secret|x-api-key-secret|openai-api-key-secret|access-key-secret|password-secret|recovery-secret|totp-secret/);
});

test('admin record serialization preserves shared references while still detecting cycles', () => {
    const shared = { label: 'shared context' };
    const circular = { id: 'cycle' };
    circular.self = circular;

    const serialized = serializeRecord({
        id: 'record-shared-reference',
        payload: {
            first: shared,
            second: shared,
            list: [shared],
            circular
        }
    });

    assert.deepEqual(serialized.payload.first, { label: 'shared context' });
    assert.deepEqual(serialized.payload.second, { label: 'shared context' });
    assert.deepEqual(serialized.payload.list[0], { label: 'shared context' });
    assert.equal(serialized.payload.circular.self, '[circular]');
});

test('admin record serialization caps display payload text and normalizes scalar fields', () => {
    const longKey = 'k'.repeat(180);
    const serialized = serializeRecord({
        id: 'record-display-limits',
        session_id: 's'.repeat(700),
        score: 'not-a-score',
        total_questions: '12.9',
        correct_answers: '7.9',
        duration: '30.5',
        payload: {
            title: 't'.repeat(700),
            createdAt: '2026-01-01T00:00:00Z'.repeat(20),
            longText: `${'x'.repeat(4095)}\uD83Dtail`,
            [longKey]: 'long key value'
        }
    });

    const payloadKeys = Object.keys(serialized.payload);
    const cappedKey = payloadKeys.find((key) => key.startsWith('k'));

    assert.equal(serialized.score, null);
    assert.equal(serialized.totalQuestions, 12);
    assert.equal(serialized.correctAnswers, 7);
    assert.equal(serialized.duration, 30.5);
    assert.equal(serialized.sessionId.length, 512);
    assert.equal(serialized.title.length, 512);
    assert.equal(serialized.createdAt.length, 128);
    assert(serialized.payload.longText.endsWith('... [truncated]'));
    assert(!serialized.payload.longText.includes('\uD83D'), 'payload string truncation must not leave an unmatched surrogate half');
    assert.equal(cappedKey.length, 120);
    assert.equal(serialized.payload[cappedKey], 'long key value');
});

test('admin can list users, inspect records, and delete one record', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'admin_user', 'StrongPass1');
        const created = await register(client, 'managed_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const managedUserId = created.json.user.id;

        const records = [
            {
                id: 'managed-record',
                sessionId: 'managed-session',
                type: 'reading',
                title: 'Managed Reading',
                score: 82,
                accessToken: 'api-token-secret',
                payload: {
                    password: 'stored-password-secret',
                    nested: {
                        safe: 'visible-managed-value',
                        csrfToken: 'stored-csrf-secret'
                    }
                }
            }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'admin_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);

        const adminRecordsBeforeTotp = await client.request('GET', '/api/admin/summary');
        assert.equal(adminRecordsBeforeTotp.response.status, 401);

        const enabledAdminTotp = await enableTotpForCurrentSession(client);
        assert.equal(enabledAdminTotp.user.role, 'admin');

        const adminPage = await client.request('GET', '/admin');
        assert.equal(adminPage.response.status, 200);
        assert.match(adminPage.text, /open-account-center/);

        const accountPage = await client.request('GET', `/admin/account?userId=${managedUserId}`);
        assert.equal(accountPage.response.status, 200);
        assert.match(accountPage.text, /Admin Account Center/);
        assert.match(accountPage.text, /\/admin\/account\.js/);
        assert.doesNotMatch(accountPage.text, /js\/bundles\//);

        const accountScript = await client.request('GET', '/admin/account.js');
        assert.equal(accountScript.response.status, 200);
        assert.match(accountScript.text, /\/api\/admin\/users\//);
        assert.match(accountScript.text, /practice-records\?limit=/);

        const accountStyles = await client.request('GET', '/admin/account.css');
        assert.equal(accountStyles.response.status, 200);
        assert.match(accountStyles.text, /account-shell/);

        const summary = await client.request('GET', '/api/admin/summary');
        assert.equal(summary.response.status, 200);
        assert.equal(summary.json.userCount, 2);
        assert.equal(summary.json.adminCount, 1);
        assert.equal(summary.json.practiceRecordCount, 1);

        const users = await client.request('GET', '/api/admin/users?q=managed');
        assert.equal(users.response.status, 200);
        assert.equal(users.json.users.length, 1);
        assert.equal(users.json.users[0].id, managedUserId);

        const pagedUsers = await client.request('GET', '/api/admin/users?limit=1&offset=1');
        assert.equal(pagedUsers.response.status, 200);
        assert.equal(pagedUsers.json.limit, 1);
        assert.equal(pagedUsers.json.offset, 1);

        const listed = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(listed.response.status, 200);
        assert.equal(listed.json.records[0].id, 'managed-record');
        assert.equal(listed.json.records[0].payload.accessToken, '[redacted]');
        assert.equal(listed.json.records[0].payload.payload.password, '[redacted]');
        assert.equal(listed.json.records[0].payload.payload.nested.csrfToken, '[redacted]');
        assert.equal(listed.json.records[0].payload.payload.nested.safe, 'visible-managed-value');
        assert.doesNotMatch(
            JSON.stringify(listed.json.records[0]),
            /api-token-secret|stored-password-secret|stored-csrf-secret/
        );

        const missingUserId = '11111111-1111-4111-8111-111111111111';
        const missingUserRecords = await client.request('GET', `/api/admin/users/${missingUserId}/practice-records`);
        assert.equal(missingUserRecords.response.status, 404);
        assert.equal(missingUserRecords.json.error, 'User not found');

        const blockedDelete = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`, undefined, {
            csrf: false
        });
        assert.equal(blockedDelete.response.status, 403);

        const missingUserDelete = await client.request('DELETE', `/api/admin/users/${missingUserId}/practice-records/managed-record`);
        assert.equal(missingUserDelete.response.status, 404);
        assert.equal(missingUserDelete.json.error, 'User not found');

        const missingRecordDelete = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/missing-record`);
        assert.equal(missingRecordDelete.response.status, 404);
        assert.equal(missingRecordDelete.json.error, 'Record not found');

        const removed = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`);
        assert.equal(removed.response.status, 200);
        assert.equal(removed.json.removed, 1);

        const afterDelete = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(afterDelete.json.records.length, 0);
    } finally {
        await client.close();
    }
});

test('admin sensitive mutations are rate limited', async () => {
    const client = await createClient({
        adminRateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        await seedAdmin(client, 'limited_admin', 'StrongPass1');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'limited_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(client);

        const created = await client.request('POST', '/api/admin/users', {
            username: 'limited_admin_target',
            password: 'StrongPass1',
            role: 'user'
        });
        assert.equal(created.response.status, 201);

        const limited = await client.request('PATCH', `/api/admin/users/${created.json.user.id}`, {
            password: 'StrongerPass2'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');

        const readOnly = await client.request('GET', '/api/admin/users?q=limited_admin_target');
        assert.equal(readOnly.response.status, 200);
        assert.equal(readOnly.json.users.length, 1);
    } finally {
        await client.close();
    }
});

test('admin API does not expose internal error messages', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'safe_error_admin', 'StrongPass1');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'safe_error_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        await enableTotpForCurrentSession(client);

        const originalCreateUser = client.adminStore.createUser.bind(client.adminStore);
        client.adminStore.createUser = async () => {
            const error = new Error('database failed: SECRET_TOKEN_12345 <script>alert(1)</script>');
            error.status = 500;
            error.details = { secret: 'SECRET_TOKEN_12345' };
            throw error;
        };
        const response = await client.request('POST', '/api/admin/users', {
            username: 'internal_error_user',
            password: 'StrongPass1',
            role: 'user'
        });
        client.adminStore.createUser = originalCreateUser;

        assert.equal(response.response.status, 500);
        assert.deepEqual(response.json, { error: 'Request failed' });
        assert(!JSON.stringify(response.json).includes('SECRET_TOKEN_12345'));
        assert(!JSON.stringify(response.json).includes('<script>'));
    } finally {
        await client.close();
    }
});

test('admin routes require TOTP verification in the current session', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'stale_admin_session', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const userId = created.json.user.id;
        const storedUser = client.authStore.users.get('stale_admin_session');
        storedUser.role = 'admin';
        await client.totpStore.saveEnabled(userId, 'not-needed-for-status-check', [], null);

        const blockedSummary = await client.request('GET', '/api/admin/summary');
        assert.equal(blockedSummary.response.status, 403);
        assert.equal(blockedSummary.json.error, 'Admin TOTP verification required');

        const blockedAdminPage = await client.request('GET', '/admin', undefined, { redirect: 'manual' });
        assert.equal(blockedAdminPage.response.status, 302);
        assertAuthStartRedirect(blockedAdminPage.response.headers.get('location'), 'admin', '/admin');

        const blockedAccountPage = await client.request('GET', `/admin/account?userId=${userId}`, undefined, { redirect: 'manual' });
        assert.equal(blockedAccountPage.response.status, 302);
        assertAuthStartRedirect(blockedAccountPage.response.headers.get('location'), 'admin', `/admin/account?userId=${userId}`);
    } finally {
        await client.close();
    }
});

test('admin TOTP verification expires and can be renewed in-session', async () => {
    const client = await createClient({ totpVerificationMaxAgeMs: 1000 });
    try {
        await seedAdmin(client, 'expiring_admin', 'StrongPass1');
        await client.csrf();
        const passwordLogin = await client.request('POST', '/api/auth/login', {
            username: 'expiring_admin',
            password: 'StrongPass1'
        });
        assert.equal(passwordLogin.response.status, 200);
        assert.equal(passwordLogin.json.requiresTotpSetup, true);

        const { secret } = await enableTotpForCurrentSession(client);
        const initialSummary = await client.request('GET', '/api/admin/summary');
        assert.equal(initialSummary.response.status, 200);
        const initialAdminPage = await client.request('GET', '/admin');
        assert.equal(initialAdminPage.response.status, 200);

        const expiredSummary = await withDateNowOffset(2000, () => client.request('GET', '/api/admin/summary'));
        assert.equal(expiredSummary.response.status, 403);
        assert.equal(expiredSummary.json.error, 'Admin TOTP verification required');
        const expiredAdminPage = await withDateNowOffset(2000, () => client.request('GET', '/admin', undefined, { redirect: 'manual' }));
        assert.equal(expiredAdminPage.response.status, 302);
        assertAuthStartRedirect(expiredAdminPage.response.headers.get('location'), 'admin', '/admin');

        await withDateNowOffset(31_000, async () => {
            const renewed = await client.request('POST', '/api/auth/totp/verify', {
                token: generateTotpToken(secret)
            });
            assert.equal(renewed.response.status, 200);
            assert.equal(renewed.json.status.enabled, true);

            const renewedSummary = await client.request('GET', '/api/admin/summary');
            assert.equal(renewedSummary.response.status, 200);
            const renewedAdminPage = await client.request('GET', '/admin');
            assert.equal(renewedAdminPage.response.status, 200);
        });
    } finally {
        await client.close();
    }
});

test('admin can manage users and inspect learning and traffic stats', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'admin_user', 'StrongPass1');
        const created = await register(client, 'stats_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const managedUserId = created.json.user.id;

        const recentRecordAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const latestRecordAt = new Date().toISOString();
        const records = [
            {
                id: 'stats-record-1',
                sessionId: 'stats-session-1',
                type: 'reading',
                title: 'Stats Reading',
                score: 80,
                duration: 12,
                correctAnswers: 8,
                totalQuestions: 10,
                updatedAt: recentRecordAt
            },
            {
                id: 'stats-record-2',
                sessionId: 'stats-session-2',
                type: 'listening',
                title: 'Stats Listening',
                score: 60,
                duration: 8,
                correctAnswers: 6,
                totalQuestions: 10,
                updatedAt: latestRecordAt
            }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'admin_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(client);

        const weak = await client.request('POST', '/api/admin/users', {
            username: 'weak_created',
            password: 'weak',
            role: 'user'
        });
        assert.equal(weak.response.status, 400);

        const longPassword = `Aa1${'x'.repeat(70)}`;
        assert(Buffer.byteLength(longPassword, 'utf8') > 72);
        const tooLongCreated = await client.request('POST', '/api/admin/users', {
            username: 'long_created',
            password: longPassword,
            role: 'user'
        });
        assert.equal(tooLongCreated.response.status, 400);
        assert.equal(tooLongCreated.json.error, 'Password strength is insufficient');
        assert(tooLongCreated.json.details.includes('Password must not exceed 72 UTF-8 bytes'));

        const added = await client.request('POST', '/api/admin/users', {
            username: 'created_user',
            password: 'StrongPass1',
            role: 'user'
        });
        assert.equal(added.response.status, 201);
        assert.equal(added.json.user.role, 'user');

        const patched = await client.request('PATCH', `/api/admin/users/${added.json.user.id}`, {
            role: 'admin',
            password: 'StrongerPass2'
        });
        assert.equal(patched.response.status, 200);
        assert.equal(patched.json.user.role, 'admin');

        const tooLongPatched = await client.request('PATCH', `/api/admin/users/${added.json.user.id}`, {
            password: longPassword
        });
        assert.equal(tooLongPatched.response.status, 400);
        assert.equal(tooLongPatched.json.error, 'Password strength is insufficient');
        assert(tooLongPatched.json.details.includes('Password must not exceed 72 UTF-8 bytes'));

        const adminUsers = await client.request('GET', '/api/admin/users?role=admin&limit=20&offset=0');
        assert.equal(adminUsers.response.status, 200);
        assert(adminUsers.json.users.length >= 2);
        assert(adminUsers.json.users.every((user) => user.role === 'admin'));
        assert(adminUsers.json.users.some((user) => user.id === patched.json.user.id));

        const regularUsers = await client.request('GET', '/api/admin/users?role=user&limit=20&offset=0');
        assert.equal(regularUsers.response.status, 200);
        assert(regularUsers.json.users.every((user) => user.role === 'user'));
        assert(regularUsers.json.users.some((user) => user.id === managedUserId));

        const selfDelete = await client.request('DELETE', `/api/admin/users/${login.json.user.id}`);
        assert.equal(selfDelete.response.status, 400);

        const userStats = await client.request('GET', `/api/admin/users/${managedUserId}/stats`);
        assert.equal(userStats.response.status, 200);
        assert.equal(userStats.json.recordCount, 2);
        assert.equal(userStats.json.averageScore, 70);
        assert.equal(userStats.json.totalStudyMinutes, 20);
        assert.equal(userStats.json.byType.length, 2);

        const globalStats = await client.request('GET', '/api/admin/stats');
        assert.equal(globalStats.response.status, 200);
        assert.equal(globalStats.json.practiceRecordCount, 2);
        assert.equal(globalStats.json.averageScore, 70);

        const analytics = await client.request('GET', '/api/admin/analytics?days=30&limit=5');
        assert.equal(analytics.response.status, 200);
        assert(analytics.json.dailyLearning.some((item) => item.records >= 1));
        assert(analytics.json.topUsers.some((user) => user.id === managedUserId));
        assert(analytics.json.scoreBuckets.some((item) => item.bucket === '60-79'));
        assert(analytics.json.scoreBuckets.some((item) => item.bucket === '80-100'));

        await client.request('GET', '/');
        await new Promise((resolve) => setTimeout(resolve, 20));
        const traffic = await client.request('GET', '/api/admin/traffic?days=7&limit=5');
        assert.equal(traffic.response.status, 200);
        assert(traffic.json.requests >= 1);
        assert(traffic.json.topPaths.length >= 1);
        assert(traffic.json.routeGroups.length >= 1);
        assert(traffic.json.statusCodes.length >= 1);
        assert(traffic.json.auth.loginSuccesses >= 1);
        assert(traffic.json.auth.registerSuccesses >= 1);

        const summaryWithAuth = await client.request('GET', '/api/admin/summary');
        assert.equal(summaryWithAuth.response.status, 200);
        assert(summaryWithAuth.json.traffic.registeredUsers >= 3);
        assert(summaryWithAuth.json.traffic.loginSuccesses >= 1);
        assert(summaryWithAuth.json.traffic.registerSuccesses >= 1);

        const practiceExport = await client.request('GET', '/api/admin/export?dataset=practice-records&format=json&limit=10');
        assert.equal(practiceExport.response.status, 200);
        assert.equal(practiceExport.json.dataset, 'practice-records');
        const exportedRecord = practiceExport.json.rows.find((row) => row.recordId === 'stats-record-1');
        assert(exportedRecord);
        assert.equal(exportedRecord.username, 'stats_user');
        assert.equal(exportedRecord.title, 'Stats Reading');
        assert.equal(exportedRecord.duration, 12);
        assert.equal(exportedRecord.accuracy, 80);

        const usersCsv = await client.request('GET', '/api/admin/export?dataset=users&format=csv&limit=10');
        assert.equal(usersCsv.response.status, 200);
        assert.match(usersCsv.response.headers.get('content-type'), /text\/csv/);
        assert.match(usersCsv.response.headers.get('content-disposition'), /ielts-users-/);
        assert.match(usersCsv.text, /^id,username,role,createdAt/m);
        assert.match(usersCsv.text, /stats_user/);

        const invalidExportQuery = await client.request('GET', '/api/admin/export?dataset=secrets');
        assert.equal(invalidExportQuery.response.status, 400);
        assert.equal(invalidExportQuery.json.error, 'Invalid export query');

        const invalidUsersQuery = await client.request('GET', '/api/admin/users?limit=0');
        assert.equal(invalidUsersQuery.response.status, 400);
        assert.equal(invalidUsersQuery.json.error, 'Invalid list query');
        assert(invalidUsersQuery.json.details.fieldErrors.limit.length >= 1);

        const longUsersQuery = await client.request('GET', `/api/admin/users?q=${'x'.repeat(81)}`);
        assert.equal(longUsersQuery.response.status, 400);
        assert.equal(longUsersQuery.json.error, 'Invalid list query');
        assert(longUsersQuery.json.details.fieldErrors.q.length >= 1);

        const wildcardUsersQuery = await client.request('GET', '/api/admin/users?q=%25');
        assert.equal(wildcardUsersQuery.response.status, 200);
        assert.equal(wildcardUsersQuery.json.total, 0);
        assert.equal(wildcardUsersQuery.json.users.length, 0);

        const invalidRecordsQuery = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records?offset=-1`);
        assert.equal(invalidRecordsQuery.response.status, 400);
        assert.equal(invalidRecordsQuery.json.error, 'Invalid list query');
        assert(invalidRecordsQuery.json.details.fieldErrors.offset.length >= 1);

        const invalidTrafficQuery = await client.request('GET', '/api/admin/traffic?days=0');
        assert.equal(invalidTrafficQuery.response.status, 400);
        assert.equal(invalidTrafficQuery.json.error, 'Invalid traffic query');
        assert(invalidTrafficQuery.json.details.fieldErrors.days.length >= 1);

        const invalidAnalyticsQuery = await client.request('GET', '/api/admin/analytics?limit=many');
        assert.equal(invalidAnalyticsQuery.response.status, 400);
        assert.equal(invalidAnalyticsQuery.json.error, 'Invalid analytics query');
        assert(invalidAnalyticsQuery.json.details.fieldErrors.limit.length >= 1);

        const invalidUserId = await client.request('GET', '/api/admin/users/not-a-uuid/stats');
        assert.equal(invalidUserId.response.status, 400);
        assert.equal(invalidUserId.json.error, 'Invalid user id');

        const invalidRecordId = await client.request(
            'DELETE',
            `/api/admin/users/${managedUserId}/practice-records/${'x'.repeat(600)}`
        );
        assert.equal(invalidRecordId.response.status, 400);
        assert.equal(invalidRecordId.json.error, 'Invalid record id');

        const realUpdateUser = client.adminStore.updateUser.bind(client.adminStore);
        client.adminStore.updateUser = async () => null;
        const stalePatch = await client.request('PATCH', `/api/admin/users/${added.json.user.id}`, {
            password: 'StrongerPass3'
        });
        assert.equal(stalePatch.response.status, 404);
        assert.equal(stalePatch.json.error, 'User not found');
        client.adminStore.updateUser = realUpdateUser;

        const realDeleteUser = client.adminStore.deleteUser.bind(client.adminStore);
        client.adminStore.deleteUser = async () => null;
        const staleDelete = await client.request('DELETE', `/api/admin/users/${added.json.user.id}`);
        assert.equal(staleDelete.response.status, 404);
        assert.equal(staleDelete.json.error, 'User not found');
        client.adminStore.deleteUser = realDeleteUser;

        const deleted = await client.request('DELETE', `/api/admin/users/${added.json.user.id}`);
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);
    } finally {
        await client.close();
    }
});

test('PostgresAdminStore refuses last-admin demotion inside a locked transaction', async () => {
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE') {
                return { rows: [], rowCount: 0 };
            }
            if (text === 'SELECT id, role FROM users WHERE id = $1 FOR UPDATE') {
                return { rows: [{ id: 'admin-id', role: 'admin' }], rowCount: 1 };
            }
            if (text === 'SELECT count(*)::int AS total FROM users WHERE role = $1') {
                return { rows: [{ total: 1 }], rowCount: 1 };
            }
            if (text.startsWith('UPDATE users')) {
                throw new Error('unexpected update');
            }
            return { rows: [], rowCount: 0 };
        }
    };
    const db = {
        async withTransaction(handler) {
            queries.push({ text: 'BEGIN', params: [] });
            try {
                const result = await handler(client);
                queries.push({ text: 'COMMIT', params: [] });
                return result;
            } catch (error) {
                queries.push({ text: 'ROLLBACK', params: [] });
                throw error;
            }
        }
    };
    const store = new PostgresAdminStore(db);

    await assert.rejects(
        () => store.updateUser('admin-id', { role: 'user' }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'Cannot demote the last admin');
            return true;
        }
    );

    const texts = queries.map((item) => item.text);
    assert.deepEqual(texts, [
        'BEGIN',
        'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
        'SELECT id, role FROM users WHERE id = $1 FOR UPDATE',
        'SELECT count(*)::int AS total FROM users WHERE role = $1',
        'ROLLBACK'
    ]);
});

test('MemoryAdminStore refuses direct last-admin demotion and deletion', async () => {
    const adminUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        username: 'memory_admin',
        username_lower: 'memory_admin',
        password_hash: 'hash',
        role: 'admin'
    };
    const authStore = { users: new Map([[adminUser.username_lower, adminUser]]) };
    const store = new MemoryAdminStore({
        authStore,
        practiceStore: {},
        totpStore: {}
    });

    await assert.rejects(
        () => store.updateUser(adminUser.id, { role: 'user' }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'Cannot demote the last admin');
            return true;
        }
    );
    assert.equal(authStore.users.get(adminUser.username_lower).role, 'admin');

    await assert.rejects(
        () => store.deleteUser(adminUser.id),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'Cannot delete the last admin');
            return true;
        }
    );
    assert.equal(authStore.users.has(adminUser.username_lower), true);
});

test('PostgresAdminStore deletes sessions and users inside a locked transaction', async () => {
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE') {
                return { rows: [], rowCount: 0 };
            }
            if (text === 'SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE') {
                return { rows: [{ id: 'admin-id', username: 'admin_user', role: 'admin' }], rowCount: 1 };
            }
            if (text === 'SELECT count(*)::int AS total FROM users WHERE role = $1') {
                return { rows: [{ total: 2 }], rowCount: 1 };
            }
            if (text.startsWith('DELETE FROM "session"')) {
                assert.deepEqual(params, ['admin-id', null]);
                return { rows: [], rowCount: 2 };
            }
            if (text === 'DELETE FROM users WHERE id = $1 RETURNING id, username, role') {
                assert.deepEqual(params, ['admin-id']);
                return { rows: [{ id: 'admin-id', username: 'admin_user', role: 'admin' }], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };
    const db = {
        async withTransaction(handler) {
            queries.push({ text: 'BEGIN', params: [] });
            const result = await handler(client);
            queries.push({ text: 'COMMIT', params: [] });
            return result;
        }
    };
    const store = new PostgresAdminStore(db);

    const deleted = await store.deleteUser('admin-id');

    assert.equal(deleted.id, 'admin-id');
    assert.equal(deleted.username, 'admin_user');
    assert.equal(deleted.role, 'admin');
    const texts = queries.map((item) => item.text);
    assert.deepEqual(texts, [
        'BEGIN',
        'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
        'SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE',
        'SELECT count(*)::int AS total FROM users WHERE role = $1',
        `DELETE FROM "session" WHERE ( sess::jsonb #>> '{user,id}' = $1 OR sess::jsonb #>> '{pendingTotpLogin,user,id}' = $1 OR sess::jsonb #>> '{pendingTotpSetup,user,id}' = $1 ) AND ($2::text IS NULL OR sid <> $2::text)`,
        'DELETE FROM users WHERE id = $1 RETURNING id, username, role',
        'COMMIT'
    ]);
});

test('admin user deletion clears target TOTP state in memory store', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const createdTarget = await register(targetSession, 'delete_totp_user', 'StrongPass1');
        assert.equal(createdTarget.response.status, 201);
        const targetUserId = createdTarget.json.user.id;
        await enableTotpForCurrentSession(targetSession);
        const beforeDelete = await client.totpStore.getStatus(targetUserId);
        assert.equal(beforeDelete.enabled, true);
        assert.equal(beforeDelete.recoveryCodesRemaining, 10);

        await targetSession.request('POST', '/api/auth/logout');

        await seedAdmin(client, 'delete_totp_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'delete_totp_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const deleted = await adminSession.request('DELETE', `/api/admin/users/${targetUserId}`);
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);

        const afterDelete = await client.totpStore.getStatus(targetUserId);
        assert.equal(afterDelete.enabled, false);
        assert.equal(afterDelete.recoveryCodesRemaining, 0);
    } finally {
        await client.close();
    }
});

test('memory admin session deletion skips oversized serialized sessions', async () => {
    const destroyed = [];
    const sessionStore = {
        sessions: {
            valid: JSON.stringify({ user: { id: 'target-user' } }),
            oversized: '{"user":{"id":"target-user"},"padding":"' + 'x'.repeat(256 * 1024 + 1) + '"}',
            other: JSON.stringify({ user: { id: 'other-user' } })
        },
        destroy(sid, callback) {
            destroyed.push(sid);
            callback();
        }
    };
    const store = new MemoryAdminStore({
        authStore: { users: new Map() },
        practiceStore: {},
        totpStore: {},
        sessionStore
    });

    await store.deleteSessionsForUser('target-user');

    assert.deepEqual(destroyed, ['valid']);
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin.js'), 'utf8');
    assert(adminSource.includes('MAX_MEMORY_SESSION_JSON_LENGTH = 256 * 1024'));
    assert(adminSource.includes('function parseMemorySessionValue(raw)'));
    assert(adminSource.includes('raw.length > MAX_MEMORY_SESSION_JSON_LENGTH'));
});

test('memory auth session deletion skips oversized serialized sessions', async () => {
    const destroyed = [];
    const sessionStore = {
        sessions: {
            valid: JSON.stringify({ pendingTotpLogin: { user: { id: 'target-user' } } }),
            oversized: '{"pendingTotpLogin":{"user":{"id":"target-user"}},"padding":"' + 'x'.repeat(256 * 1024 + 1) + '"}',
            other: JSON.stringify({ user: { id: 'other-user' } })
        },
        destroy(sid, callback) {
            destroyed.push(sid);
            callback();
        }
    };
    const store = new MemoryAuthStore({ sessionStore });

    await store.deleteSessionsForUser('target-user');

    assert.deepEqual(destroyed, ['valid']);
    const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');
    assert(authSource.includes('MAX_MEMORY_SESSION_JSON_LENGTH = 256 * 1024'));
    assert(authSource.includes('function parseMemorySessionValue(raw)'));
    assert(authSource.includes('raw.length > MAX_MEMORY_SESSION_JSON_LENGTH'));
});

test('admin search query normalization preserves valid Unicode', () => {
    const splitSurrogate = normalizeAdminSearchQuery(`${'A'.repeat(79)}😀tail`);
    assert.equal(splitSurrogate, 'a'.repeat(79));
    assert(!/[\uD800-\uDFFF]/.test(splitSurrogate));

    assert.equal(
        normalizeAdminSearchQuery('  Alice_%!\n\tBob  '),
        'alice_%! bob'
    );
});

test('traffic middleware minimizes untrusted request metadata', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const longPath = `/${'x'.repeat(1000)}?token=secret#fragment`;
        const longHeader = 'h'.repeat(1000);
        const response = await client.request('GET', longPath, undefined, {
            headers: {
                'user-agent': longHeader,
                referer: `https://example.test/${longHeader}?token=secret#fragment`
            }
        });
        assert.equal(response.response.status, 404);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const event = client.adminStore.trafficEvents.find((entry) => entry.path.startsWith('/xxx'));
        assert(event);
        assert.equal(event.path.length, 300);
        assert.equal(event.method, 'GET');
        assert.equal(event.routeGroup, 'page');
        assert.match(event.sessionId, /^[a-f0-9]{64}$/);
        assert.equal(event.userAgent, 'other');
        assert.equal(event.referrer, 'https://example.test');
        assert(!event.path.includes('token=secret'));
        assert(!event.userAgent.includes(longHeader.slice(0, 20)));
        assert(!event.referrer.includes('token=secret'));
        assert(!event.referrer.includes(longHeader.slice(0, 20)));

        const normalized = normalizeTrafficEvent({
            method: 'po\nst',
            path: '/admin/\u0000users\r\nlist?token=secret',
            routeGroup: 'pa\tge',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 SecretToken',
            referrer: 'not a url\r\nwith controls'
        });
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.method));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.path));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.routeGroup));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.userAgent));
        assert.equal(normalized.userAgent, 'chromium');
        assert(!normalized.userAgent.includes('SecretToken'));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.referrer));
        assert.equal(normalized.referrer, '/');

        assert.equal(normalizeTrafficEvent({ path: 'admin/users?token=secret' }).path, '/admin/users');
        assert.equal(normalizeTrafficEvent({ path: 'javascript:alert(1)' }).path, '/');
        assert.equal(normalizeTrafficEvent({ path: 'data:text/html,<script>alert(1)</script>' }).path, '/');
        assert.equal(normalizeTrafficEvent({ path: 'https://example.test/admin?token=secret' }).path, '/admin');
        assert.equal(normalizeTrafficEvent({ path: '\r\n' }).path, '/');
        assert.equal(normalizeTrafficEvent({ sessionId: 'raw-session-id' }).sessionId, null);
        assert.equal(
            normalizeTrafficEvent({ sessionId: 'A'.repeat(64) }).sessionId,
            'a'.repeat(64)
        );
        assert.equal(normalizeTrafficEvent({ userId: 'not-a-user-id\r\nsecret' }).userId, null);
        assert.equal(
            normalizeTrafficEvent({ userId: '123E4567-E89B-12D3-A456-426614174000' }).userId,
            '123e4567-e89b-12d3-a456-426614174000'
        );
        const surrogateBoundary = normalizeTrafficEvent({
            routeGroup: `${'r'.repeat(31)}😀tail`
        });
        assert.equal(surrogateBoundary.routeGroup, 'r'.repeat(31));
        assert(!/[\uD800-\uDFFF]/.test(surrogateBoundary.routeGroup));
    } finally {
        await client.close();
    }
});

test('traffic visitor hashing ignores raw user-agent entropy', async () => {
    const client = await createClient();
    try {
        await client.request('GET', '/visitor-a', undefined, {
            headers: {
                'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0 SecretTokenA',
                'accept-language': 'en-US,en;q=0.9'
            }
        });
        await client.request('GET', '/visitor-b', undefined, {
            headers: {
                'user-agent': 'Mozilla/5.0 Chrome/121.9.8.7 SecretTokenB',
                'accept-language': 'en-GB,en;q=0.7'
            }
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        const events = client.adminStore.trafficEvents.filter((entry) => entry.path.startsWith('/visitor-'));
        assert.equal(events.length, 2);
        assert.match(events[0].ipHash, /^[a-f0-9]{64}$/);
        assert.equal(events[0].ipHash, events[1].ipHash);
    } finally {
        await client.close();
    }
});

test('traffic middleware rejects weak hashing secrets in production', () => {
    const store = { recordTraffic() {} };
    assert.throws(
        () => createTrafficMiddleware({
            store,
            enabled: true,
            nodeEnv: 'production',
            secret: 'traffic-development-secret'
        }),
        /TRAFFIC_SECRET or SESSION_SECRET/
    );
    assert.doesNotThrow(() => createTrafficMiddleware({
        store,
        enabled: true,
        nodeEnv: 'production',
        secret: 'x'.repeat(32)
    }));
});

test('Postgres traffic recent events respect the selected day window', async () => {
    const queries = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            return { rows: [] };
        }
    };
    const store = new PostgresAdminStore(db);

    const traffic = await store.trafficSummary({ days: 3, limit: 7 });

    assert.equal(traffic.days, 3);
    const recent = queries.find((entry) => entry.text.startsWith('SELECT occurred_at, method, path'));
    assert(recent, 'recent traffic query was not executed');
    assert(recent.text.includes("WHERE occurred_at >= now() - ($1::int * interval '1 day')"));
    assert(recent.text.includes('LIMIT $2'));
    assert.deepEqual(recent.params, [3, 7]);
});

test('memory traffic store caps retained events', async () => {
    const client = await createClient();
    client.adminStore.maxTrafficEvents = 3;
    try {
        for (let index = 0; index < 5; index += 1) {
            await client.adminStore.recordTraffic({
                method: 'GET',
                path: `/event-${index}`,
                statusCode: 200,
                durationMs: 1
            });
        }
        assert.equal(client.adminStore.trafficEvents.length, 3);
        assert.deepEqual(
            client.adminStore.trafficEvents.map((event) => event.path),
            ['/event-2', '/event-3', '/event-4']
        );
    } finally {
        await client.close();
    }
});

test('admin user changes invalidate target sessions and stale admin roles', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'owner_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const ownerLogin = await adminSession.request('POST', '/api/auth/login', {
            username: 'owner_admin',
            password: 'StrongPass1'
        });
        assert.equal(ownerLogin.response.status, 200);
        assert.equal(ownerLogin.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const userSession = client.createSession();
        const createdUser = await register(userSession, 'reset_target', 'StrongPass1');
        assert.equal(createdUser.response.status, 201);
        const userRecords = await userSession.request('GET', '/api/practice-records');
        assert.equal(userRecords.response.status, 200);

        const resetPassword = await adminSession.request('PATCH', `/api/admin/users/${createdUser.json.user.id}`, {
            password: 'StrongerPass2'
        });
        assert.equal(resetPassword.response.status, 200);

        const staleUserSession = await userSession.request('GET', '/api/practice-records');
        assert.equal(staleUserSession.response.status, 401);

        const createdAdmin = await adminSession.request('POST', '/api/admin/users', {
            username: 'target_admin',
            password: 'StrongPass1',
            role: 'admin'
        });
        assert.equal(createdAdmin.response.status, 201);

        const targetAdminSession = client.createSession();
        await targetAdminSession.csrf();
        const targetLogin = await targetAdminSession.request('POST', '/api/auth/login', {
            username: 'target_admin',
            password: 'StrongPass1'
        });
        assert.equal(targetLogin.response.status, 200);
        assert.equal(targetLogin.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(targetAdminSession);

        const targetSummary = await targetAdminSession.request('GET', '/api/admin/summary');
        assert.equal(targetSummary.response.status, 200);

        const demoted = await adminSession.request('PATCH', `/api/admin/users/${createdAdmin.json.user.id}`, {
            role: 'user'
        });
        assert.equal(demoted.response.status, 200);
        assert.equal(demoted.json.user.role, 'user');

        const staleAdminSession = await targetAdminSession.request('GET', '/api/admin/summary');
        assert.equal(staleAdminSession.response.status, 401);
    } finally {
        await client.close();
    }
});

test('admin self password update rotates the current session', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'self_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        const enabled = await enableTotpForCurrentSession(adminSession);
        assert(enabled.sessionCookie);
        assert(enabled.csrfToken);

        const selfUpdate = await adminSession.request('PATCH', `/api/admin/users/${enabled.user.id}`, {
            password: 'StrongerPass2'
        });
        assert.equal(selfUpdate.response.status, 200);
        assert.equal(selfUpdate.json.user.id, enabled.user.id);
        assert.equal(selfUpdate.json.user.role, 'admin');
        assert(selfUpdate.json.csrfToken);
        assert.notEqual(selfUpdate.json.csrfToken, enabled.csrfToken);
        const rotatedCookie = getResponseSessionCookie(selfUpdate);
        assert(rotatedCookie);
        assert.notEqual(rotatedCookie, enabled.sessionCookie);

        const currentSummary = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(currentSummary.response.status, 200);

        const oldPasswordSession = client.createSession();
        await oldPasswordSession.csrf();
        const oldPasswordLogin = await oldPasswordSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongPass1'
        });
        assert.equal(oldPasswordLogin.response.status, 401);

        const newPasswordSession = client.createSession();
        await newPasswordSession.csrf();
        const newPasswordLogin = await newPasswordSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongerPass2'
        });
        assert.equal(newPasswordLogin.response.status, 200);
        assert.equal(newPasswordLogin.json.requiresTotp, true);
    } finally {
        await client.close();
    }
});

test('admin account settings updates preserve current TOTP verification', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'account_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'account_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const beforeUpdate = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(beforeUpdate.response.status, 200);

        const rename = await adminSession.request('PATCH', '/api/auth/account/username', {
            username: 'account_admin_renamed',
            password: 'StrongPass1'
        });
        assert.equal(rename.response.status, 200);
        assert.equal(rename.json.user.username, 'account_admin_renamed');

        const afterRename = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(afterRename.response.status, 200);

        const passwordUpdate = await adminSession.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordUpdate.response.status, 200);
        assert.equal(passwordUpdate.json.user.role, 'admin');

        const afterPasswordUpdate = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(afterPasswordUpdate.response.status, 200);
    } finally {
        await client.close();
    }
});

test('migration runner serializes migrations with a PostgreSQL advisory lock', async () => {
    const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-migrations-'));
    fs.writeFileSync(path.join(migrationsDir, '001_first.sql'), 'SELECT 1;', 'utf8');
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text.includes('SELECT filename FROM schema_migrations')) {
                return { rows: [] };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const db = {
        async withClient(handler) {
            return handler(client);
        }
    };

    const result = await runMigrations(db, { migrationsDir });

    assert.deepEqual(result.applied, ['001_first.sql']);
    assert.equal(result.total, 1);
    const texts = queries.map((item) => item.text);
    const lockIndex = texts.findIndex((text) => text.includes('pg_advisory_lock'));
    const unlockIndex = texts.findIndex((text) => text.includes('pg_advisory_unlock'));
    const beginIndex = texts.indexOf('BEGIN');
    const migrationIndex = texts.indexOf('SELECT 1;');
    const commitIndex = texts.indexOf('COMMIT');

    assert(lockIndex >= 0, 'migration lock was not acquired');
    assert(unlockIndex > lockIndex, 'migration lock was not released after acquisition');
    assert(beginIndex > lockIndex, 'migration transaction started before advisory lock');
    assert(migrationIndex > beginIndex, 'migration SQL did not run inside the transaction');
    assert(commitIndex > migrationIndex && commitIndex < unlockIndex);
});

test('migration runner releases the advisory lock after migration failure', async () => {
    const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-migrations-'));
    fs.writeFileSync(path.join(migrationsDir, '001_fail.sql'), 'SELECT fail;', 'utf8');
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text.includes('SELECT filename FROM schema_migrations')) {
                return { rows: [] };
            }
            if (text === 'SELECT fail;') {
                throw new Error('migration failure');
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const db = {
        async withClient(handler) {
            return handler(client);
        }
    };

    await assert.rejects(
        () => runMigrations(db, { migrationsDir }),
        /migration failure/
    );

    const texts = queries.map((item) => item.text);
    const rollbackIndex = texts.indexOf('ROLLBACK');
    const unlockIndex = texts.findIndex((text) => text.includes('pg_advisory_unlock'));
    assert(rollbackIndex >= 0, 'failed migration did not roll back');
    assert(unlockIndex > rollbackIndex, 'migration lock was not released after rollback');
    assert.equal(texts.includes('COMMIT'), false);
});

test('bootstrap admin creates and updates an admin user', async () => {
    const users = new Map();
    let totpDeletes = 0;
    let sessionDeletes = 0;
    const db = {
        async query(sql, params = []) {
            if (sql.includes('SELECT id, password_hash, role FROM users')) {
                const user = users.get(params[0]);
                return { rows: user ? [{ id: user.id, password_hash: user.password_hash, role: user.role }] : [] };
            }
            if (sql.includes('UPDATE users')) {
                const [username, passwordHash, usernameLower] = params;
                const user = users.get(usernameLower);
                user.username = username;
                user.password_hash = passwordHash;
                user.role = 'admin';
                return { rows: [{ id: user.id, username: user.username, role: user.role }] };
            }
            if (sql.includes('INSERT INTO users')) {
                const [username, usernameLower, passwordHash] = params;
                const user = {
                    id: `user-${users.size + 1}`,
                    username,
                    username_lower: usernameLower,
                    password_hash: passwordHash,
                    role: 'admin'
                };
                users.set(usernameLower, user);
                return { rows: [{ id: user.id, username: user.username, role: user.role }] };
            }
            if (sql.includes('DELETE FROM user_totp_recovery_codes') || sql.includes('DELETE FROM user_totp_settings')) {
                totpDeletes += 1;
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('DELETE FROM "session"')) {
                sessionDeletes += 1;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${sql}`);
        }
    };
    const bcryptStub = {
        async hash(password) {
            return `hash:${password}`;
        },
        async compare(password, hash) {
            return hash === `hash:${password}`;
        }
    };

    const created = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongPass1',
        bcrypt: bcryptStub
    });
    assert.equal(created.created, true);
    assert.equal(created.user.role, 'admin');

    const updated = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongerPass2',
        bcrypt: bcryptStub
    });
    assert.equal(updated.created, false);
    assert.equal(users.get('adminuser').password_hash, 'hash:StrongerPass2');
    assert.equal(updated.sessionsDeleted, 1);

    const unchanged = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongerPass2',
        bcrypt: bcryptStub
    });
    assert.equal(unchanged.created, false);
    assert.equal(unchanged.sessionsDeleted, 0);
    assert.equal(sessionDeletes, 1);

    const reset = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongestPass3',
        bcrypt: bcryptStub,
        resetTotp: true
    });
    assert.equal(reset.totpReset, true);
    assert.equal(totpDeletes, 2);
    assert.equal(reset.sessionsDeleted, 1);
    assert.equal(sessionDeletes, 2);
});

test('static hosting serves index and denies dotfiles with security headers', async (t) => {
    const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-static-'));
    const outsideSecretPath = path.join(os.tmpdir(), `ielts-outside-secret-${path.basename(staticRoot)}.txt`);
    fs.mkdirSync(path.join(staticRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'assets', 'generated', 'listening-exams'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'assets', 'generated', 'reading-explanations'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'assets', 'generated', 'reading-exams'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'backend', 'src'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'js', 'bundles'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'templates'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'templates', 'ci-practice-fixtures'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'ListeningPractice', 'P1'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'ListeningPractice', 'vip special', 'ListeningPractice', 'P2', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>IELTS Atlas</title>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'backend', 'src', 'app.js'), 'function createApp() {}\n', 'utf8');
    fs.writeFileSync(outsideSecretPath, 'outside secret\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'js', 'bundles', 'core-foundation.bundle.js'), 'Generated by scripts/build-bundles.mjs\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'assets', 'generated', 'reading-exams', 'reading-practice-unified.html'), '<!doctype html><title>Unified Reading</title>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'assets', 'generated', 'reading-exams', 'p1-high-01.js'), 'window.__READING_EXAM_DATA__ = true;\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'assets', 'generated', 'reading-explanations', 'p1-high-01.js'), 'window.__READING_EXPLANATION_DATA__ = true;\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'assets', 'generated', 'listening-exams', 'manifest.js'), [
        '(function registerListeningExamManifest(global) {',
        '  global.__LISTENING_EXAM_MANIFEST__ = {',
        '    "listening-p1-sample": {',
        '      "examId": "listening-p1-sample",',
        '      "path": "P1/",',
        '      "filename": "sample.html",',
        '      "hasHtml": true,',
        '      "type": "listening"',
        '    },',
        '    "listening-p2-nested": {',
        '      "examId": "listening-p2-nested",',
        '      "path": "P2/nested/",',
        '      "filename": "nested.html",',
        '      "hasHtml": true,',
        '      "type": "listening"',
        '    }',
        '  };',
        '})(typeof window !== "undefined" ? window : globalThis);',
        ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'templates', 'legacy.html'), '<!doctype html><script>window.ok=true</script>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'templates', 'ci-practice-fixtures', 'debug.html'), '<!doctype html><script>window.debugPracticeEnhancer=true</script>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'ListeningPractice', 'P1', 'sample.html'), '<!doctype html><title>Listening Sample</title>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'ListeningPractice', 'vip special', 'ListeningPractice', 'P2', 'nested', 'nested.html'), '<!doctype html><title>Nested Listening</title>', 'utf8');

    const client = await createClient({ staticRoot });
    try {
        const home = await client.request('GET', '/');
        assert.equal(home.response.status, 200);
        assert.match(home.text, /<title>IELTS Atlas<\/title>/);
        assert.equal(home.response.headers.get('x-content-type-options'), 'nosniff');
        const homeCsp = home.response.headers.get('content-security-policy') || '';
        assert.match(homeCsp, /default-src 'self'/);
        assert.match(homeCsp, /script-src 'self'(?:;|$)/);
        assert.match(homeCsp, /script-src-attr 'none'/);
        assert.match(homeCsp, /object-src 'none'/);
        assert.match(homeCsp, /frame-ancestors 'none'/);
        assert.doesNotMatch(homeCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(home.response.headers.get('permissions-policy') || '', /camera=\(\)/);

        const dotfile = await client.request('GET', '/.git/config');
        assert.notEqual(dotfile.response.status, 200);
        assert.doesNotMatch(dotfile.text, /\[core\]/);

        const backendSource = await client.request('GET', '/backend/src/app.js');
        assert.notEqual(backendSource.response.status, 200);
        assert.doesNotMatch(backendSource.text, /createApp/);

        const encodedTraversal = await client.request('GET', '/assets/%2e%2e/backend/src/app.js');
        assert.notEqual(encodedTraversal.response.status, 200);
        assert.doesNotMatch(encodedTraversal.text, /createApp/);

        const encodedSlashTraversal = await client.request('GET', '/assets/%2e%2e%2fbackend/src/app.js');
        assert.notEqual(encodedSlashTraversal.response.status, 200);
        assert.doesNotMatch(encodedSlashTraversal.text, /createApp/);

        const encodedBackslashTraversal = await client.request('GET', '/assets/%2e%2e%5cbackend/src/app.js');
        assert.notEqual(encodedBackslashTraversal.response.status, 200);
        assert.doesNotMatch(encodedBackslashTraversal.text, /createApp/);

        let symlinkCreated = false;
        try {
            fs.symlinkSync(outsideSecretPath, path.join(staticRoot, 'assets', 'linked-secret.txt'));
            symlinkCreated = true;
        } catch (error) {
            t.diagnostic(`skipping symlink boundary assertion: ${error.message}`);
        }
        if (symlinkCreated) {
            const linkedSecret = await client.request('GET', '/assets/linked-secret.txt');
            assert.equal(linkedSecret.response.status, 403);
            assert.doesNotMatch(linkedSecret.text, /outside secret/);
        }

        const bundle = await client.request('GET', '/js/bundles/core-foundation.bundle.js');
        assert.equal(bundle.response.status, 200);
        assert.match(bundle.text, /Generated by scripts\/build-bundles\.mjs/);

        for (const protectedPath of [
            '/practice/reading/p1-high-01',
            '/practice/reading/p1-high-01/memorize',
            '/practice/listening/listening-p1-sample',
            '/assets/generated/reading-exams/reading-practice-unified.html',
            '/assets/generated/reading-exams/p1-high-01.js',
            '/assets/generated/reading-explanations/p1-high-01.js',
            '/assets/generated/listening-exams/manifest.js',
            '/ListeningPractice/P1/sample.html',
            '/listeningpractice/P1/sample.html',
            '/templates/legacy.html',
            '/Templates/legacy.html'
        ]) {
            const anonymous = await client.request('GET', protectedPath);
            const loginUrl = `/auth/business/start?return_to=${encodeURIComponent(protectedPath)}`;
            assert.equal(anonymous.response.status, 401, `${protectedPath} should require login`);
            assert.match(anonymous.response.headers.get('content-type') || '', /text\/html/);
            assert.equal(anonymous.response.headers.get('refresh'), `3; url=${loginUrl}`);
            assert.match(anonymous.text, /401 Unauthorized/);
            assert(anonymous.text.includes(`http-equiv="refresh" content="3; url=${loginUrl}"`));
            assert.match(anonymous.text, /立即前往登录/);
            assert.doesNotMatch(anonymous.text, /Unified Reading|Listening Sample|window\.ok|__READING_/);
        }

        const created = await register(client, 'static_content_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const listening = await client.request('GET', '/ListeningPractice/P1/sample.html');
        assert.equal(listening.response.status, 200);
        assert.match(listening.text, /Listening Sample/);
        const listeningCsp = listening.response.headers.get('content-security-policy') || '';
        assert.match(listeningCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(listeningCsp, /connect-src 'none'/);
        assert.match(listeningCsp, /form-action 'none'/);
        assert.match(listeningCsp, /base-uri 'self'/);
        assert.match(listeningCsp, /frame-src 'none'/);
        assert.match(listeningCsp, /child-src 'none'/);
        assert.match(listeningCsp, /sandbox allow-scripts allow-downloads allow-same-origin/);

        const lowerCaseListening = await client.request('GET', '/listeningpractice/P1/sample.html');
        assert.equal(lowerCaseListening.response.status, 200);
        const lowerCaseListeningCsp = lowerCaseListening.response.headers.get('content-security-policy') || '';
        assert.match(lowerCaseListeningCsp, /connect-src 'none'/);
        assert.match(lowerCaseListeningCsp, /form-action 'none'/);
        assert.match(lowerCaseListeningCsp, /base-uri 'self'/);
        assert.match(lowerCaseListeningCsp, /sandbox allow-scripts allow-downloads allow-same-origin/);

        const prettyReading = await client.request('GET', '/practice/reading/p1-high-01');
        assert.equal(prettyReading.response.status, 200);
        assert.match(prettyReading.text, /Unified Reading/);
        assert.match(prettyReading.text, /<base href="\/assets\/generated\/reading-exams\/">/);
        const prettyReadingCsp = prettyReading.response.headers.get('content-security-policy') || '';
        assert.match(prettyReadingCsp, /script-src 'self'(?:;|$)/);
        assert.doesNotMatch(prettyReadingCsp, /sandbox/);

        const prettyReadingMemorize = await client.request('GET', '/practice/reading/p1-high-01/memorize');
        assert.equal(prettyReadingMemorize.response.status, 200);
        assert.match(prettyReadingMemorize.text, /<base href="\/assets\/generated\/reading-exams\/">/);

        const readingData = await client.request('GET', '/assets/generated/reading-exams/p1-high-01.js');
        assert.equal(readingData.response.status, 200);
        assert.match(readingData.text, /__READING_EXAM_DATA__/);

        const readingExplanationData = await client.request('GET', '/assets/generated/reading-explanations/p1-high-01.js');
        assert.equal(readingExplanationData.response.status, 200);
        assert.match(readingExplanationData.text, /__READING_EXPLANATION_DATA__/);

        const listeningManifest = await client.request('GET', '/assets/generated/listening-exams/manifest.js');
        assert.equal(listeningManifest.response.status, 200);
        assert.match(listeningManifest.text, /__LISTENING_EXAM_MANIFEST__/);

        const prettyListening = await client.request('GET', '/practice/listening/listening-p1-sample');
        assert.equal(prettyListening.response.status, 200);
        assert.match(prettyListening.text, /Listening Sample/);
        assert.match(prettyListening.text, /<base href="\/ListeningPractice\/P1\/">/);
        const prettyListeningCsp = prettyListening.response.headers.get('content-security-policy') || '';
        assert.match(prettyListeningCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(prettyListeningCsp, /connect-src 'none'/);
        assert.match(prettyListeningCsp, /form-action 'none'/);
        assert.match(prettyListeningCsp, /base-uri 'self'/);
        assert.match(prettyListeningCsp, /sandbox allow-scripts allow-downloads allow-same-origin/);

        const nestedPrettyListening = await client.request('GET', '/practice/listening/listening-p2-nested');
        assert.equal(nestedPrettyListening.response.status, 200);
        assert.match(nestedPrettyListening.text, /Nested Listening/);
        assert.match(nestedPrettyListening.text, /<base href="\/ListeningPractice\/vip%20special\/ListeningPractice\/P2\/nested\/">/);

        const missingPrettyListening = await client.request('GET', '/practice/listening/not-in-manifest');
        assert.equal(missingPrettyListening.response.status, 404);

        const unsafePrettyListening = await client.request('GET', '/practice/listening/%2e%2e%2fsecret');
        assert.equal(unsafePrettyListening.response.status, 404);

        const legacyTemplate = await client.request('GET', '/templates/legacy.html');
        assert.equal(legacyTemplate.response.status, 200);
        const templateCsp = legacyTemplate.response.headers.get('content-security-policy') || '';
        assert.match(templateCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(templateCsp, /connect-src 'self'/);
        assert.doesNotMatch(templateCsp, /sandbox/);

        const mixedCaseTemplate = await client.request('GET', '/Templates/legacy.html');
        assert.equal(mixedCaseTemplate.response.status, 200);
        const mixedCaseTemplateCsp = mixedCaseTemplate.response.headers.get('content-security-policy') || '';
        assert.match(mixedCaseTemplateCsp, /script-src 'self' 'unsafe-inline'/);
        assert.doesNotMatch(mixedCaseTemplateCsp, /sandbox/);

        const ciFixture = await client.request('GET', '/templates/ci-practice-fixtures/debug.html');
        assert.equal(ciFixture.response.status, 404);
        assert.doesNotMatch(ciFixture.text, /debugPracticeEnhancer/);

        const encodedCiFixture = await client.request('GET', '/templates/%63i-practice-fixtures/debug.html');
        assert.equal(encodedCiFixture.response.status, 404);
        assert.doesNotMatch(encodedCiFixture.text, /debugPracticeEnhancer/);

        const encodedSlashCiFixture = await client.request('GET', '/templates/%63i-practice-fixtures%2Fdebug.html');
        assert.equal(encodedSlashCiFixture.response.status, 404);
        assert.doesNotMatch(encodedSlashCiFixture.text, /debugPracticeEnhancer/);
    } finally {
        await client.close();
        fs.rmSync(staticRoot, { recursive: true, force: true });
        fs.rmSync(outsideSecretPath, { force: true });
    }
});

test('static boundary rechecks optional roots created after an initial miss', async (t) => {
    const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-late-static-'));
    const outsideSecretPath = path.join(os.tmpdir(), `ielts-late-secret-${path.basename(staticRoot)}.txt`);
    fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>Late Static</title>', 'utf8');
    fs.writeFileSync(outsideSecretPath, 'late outside secret\n', 'utf8');

    const client = await createClient({ staticRoot });
    try {
        const beforeRootExists = await client.request('GET', '/ListeningPractice/linked-secret.txt');
        assert.equal(beforeRootExists.response.status, 401);
        assert.equal(beforeRootExists.response.headers.get('refresh'), `3; url=/auth/business/start?return_to=${encodeURIComponent('/ListeningPractice/linked-secret.txt')}`);
        assert.doesNotMatch(beforeRootExists.text, /late outside secret/);

        const created = await register(client, 'late_static_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const listeningRoot = path.join(staticRoot, 'ListeningPractice');
        fs.mkdirSync(listeningRoot, { recursive: true });
        let symlinkCreated = false;
        try {
            fs.symlinkSync(outsideSecretPath, path.join(listeningRoot, 'linked-secret.txt'));
            symlinkCreated = true;
        } catch (error) {
            t.diagnostic(`skipping late symlink boundary assertion: ${error.message}`);
        }

        if (symlinkCreated) {
            const linkedSecret = await client.request('GET', '/ListeningPractice/linked-secret.txt');
            assert.equal(linkedSecret.response.status, 403);
            assert.doesNotMatch(linkedSecret.text, /late outside secret/);
        }
    } finally {
        await client.close();
        fs.rmSync(staticRoot, { recursive: true, force: true });
        fs.rmSync(outsideSecretPath, { force: true });
    }
});
