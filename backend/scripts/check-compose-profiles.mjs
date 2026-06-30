import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(backendRoot, '..');
const composeEnv = {
  ...process.env,
  AUTH_PUBLIC_URL: process.env.AUTH_PUBLIC_URL || 'http://auth.local',
  BUSINESS_PUBLIC_URL: process.env.BUSINESS_PUBLIC_URL || 'http://business.local',
  ADMIN_PUBLIC_URL: process.env.ADMIN_PUBLIC_URL || 'http://admin.local'
};

function runComposeServices(extraArgs = []) {
  const output = execFileSync('docker', [
    'compose',
    ...extraArgs,
    '--env-file',
    path.join('backend', '.env'),
    '-f',
    path.join('backend', 'docker-compose.yml'),
    'config',
    '--services'
  ], {
    cwd: repoRoot,
    env: composeEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return output
    .split(/\r?\n/)
    .map((service) => service.trim())
    .filter(Boolean);
}

function assertServiceState(services, service, expected, label) {
  const present = services.includes(service);
  if (present !== expected) {
    throw new Error(`${label}: expected ${service} ${expected ? 'present' : 'absent'}, got ${present ? 'present' : 'absent'}`);
  }
}

const defaultServices = runComposeServices();
assertServiceState(defaultServices, 'postgres', true, 'default compose graph');
assertServiceState(defaultServices, 'app', true, 'default compose graph');
assertServiceState(defaultServices, 'tor', false, 'default compose graph');

const legacyServices = runComposeServices(['--profile', 'legacy-onion']);
assertServiceState(legacyServices, 'postgres', true, 'legacy-onion compose graph');
assertServiceState(legacyServices, 'app', true, 'legacy-onion compose graph');
assertServiceState(legacyServices, 'tor', true, 'legacy-onion compose graph');

console.log('compose profile check passed');
