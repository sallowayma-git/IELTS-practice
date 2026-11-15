import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkout } from './helpers/readingQualification.mjs';

const baseline = 'b5ffd429f9225b047be98c4c855340a67c737983';
const syncRevision = 'c23a113da27fd961effa1811950a8d56f5a4b088';
const integrated = execFileSync('git', ['rev-parse', process.argv[2] || 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
const directory = fs.mkdtempSync(path.join(checkout, 'developer/tests/e2e/reports/issue-296-artifacts-'));
const git = args => execFileSync('git', args, { cwd: checkout, maxBuffer: 128 * 1024 * 1024 });
const evidence = { baseline, syncRevision, integrated, artifacts: {} };
for (const [name, revision] of [['baseline', baseline], ['sync-baseline', syncRevision], ['compatibility', integrated]]) {
    const target = path.join(directory, name);
    fs.mkdirSync(target);
    const archive = git(['archive', '--format=tar', revision]);
    const archivePath = path.join(directory, name + '.tar');
    fs.writeFileSync(archivePath, archive);
    execFileSync(process.env.PYTHON || 'python', ['-c',
        'import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter="data")', archivePath, target]);
    evidence.artifacts[name] = { directory: target, sourceRevision: revision,
        archiveSha256: createHash('sha256').update(archive).digest('hex') };
}
// Apply only #284's source delta onto the integrated repair. Generated bundles
// and diagnostic stamps are rebuilt from this combined source, never copied.
const paths = ['js', 'css', 'index.html', 'scripts', 'developer/tests/js/folderSyncModel.test.js',
    'developer/tests/js/folderSyncPersistence.test.js', 'developer/tests/js/folderSyncRelease.test.js',
    ':!js/bundles'];
// One context line avoids the adjacent getPracticeCommitState method added by
// #294. Its transaction fences remain intact. Ignore generated inline stamps;
// the combined diagnostic build regenerates them below.
const patch = Buffer.from(git(['diff', '--binary', '--unified=1', baseline, syncRevision, '--', ...paths]).toString('utf8')
    .split(/(?=^diff --git )/m).map(file => file.startsWith('diff --git a/index.html ')
        ? file.split(/(?=^@@ )/m).filter(hunk => !hunk.startsWith('@@') || !/^[-+]globalThis\.AppDiagnostic/m.test(hunk)).join('') : file).join(''));
const patchPath = path.join(directory, 'pinned-284.patch');
fs.writeFileSync(patchPath, patch);
const compatibility = evidence.artifacts.compatibility;
execFileSync('git', ['init', '--quiet'], { cwd: compatibility.directory });
execFileSync('git', ['apply', '--check', patchPath], { cwd: compatibility.directory });
execFileSync('git', ['apply', patchPath], { cwd: compatibility.directory });
compatibility.patchSha256 = createHash('sha256').update(patch).digest('hex');
compatibility.recipe = 'Integrated source plus the pinned #284 source delta from b5ffd429; generated bundles rebuilt';
for (const artifact of Object.values(evidence.artifacts)) {
    if (artifact === compatibility) execFileSync(process.execPath, ['scripts/build-bundles.mjs'], { cwd: artifact.directory, stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/build-bundles.mjs', '--check'], { cwd: artifact.directory, stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/verify-diagnostic-release.mjs'], { cwd: artifact.directory, stdio: 'inherit' });
    artifact.buildId = JSON.parse(fs.readFileSync(path.join(artifact.directory, 'assets/generated/diagnostics/build-manifest.json'))).buildId;
    artifact.fileJournal = fs.existsSync(path.join(artifact.directory, 'js/data/v2/fileJournal.js'));
}
fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Qualification artifacts: ${path.join(directory, 'provenance.json')}`);
