# Multi-device CI

`Multi-device CI` is defined in `.github/workflows/ci-multi-device.yml` and runs
only for pull requests targeting `feature/multi-device-easy-deploy`. It handles
opening, new commits, reopening, becoming ready for review, and edits. Edits
include changing the base branch, title, or description. Draft and documentation-only
PRs run the same checks. The workflow has no push, schedule, dispatch, or closed
event. The existing `opensource` workflow is independent.

Checkout uses the PR merge commit, so checks exercise the proposed merged result.
A newer run cancels an older run for the same PR. All jobs use read-only repository
permissions and do not require repository secrets.

| Job | Runtime | Checks |
| --- | --- | --- |
| `md-quality` | Node.js 22, Python 3.12, Chromium | Bundle drift, JavaScript/IndexedDB tests, Python tests, reading data integrity |
| `md-backend` | Node.js 24 | Existing backend API and static-resource tests |
| `md-e2e` | Node.js 22, Python 3.12, Chromium | Unified browser suite, including file-based practice flows |
| `md-deploy-smoke` | Node.js 24, Docker Compose | Images, PostgreSQL, migrations, authentication, sessions, records, restart |
| `md-ci` | Aggregate | Requires all four validation jobs to report `success` |

E2E and deployment diagnostics are uploaded as separate artifacts and retained for
14 days. Failed, cancelled, and skipped prerequisites do not satisfy `md-ci`.

## Run checks locally

Run these commands from the repository root, using the runtimes in the table:

On Windows, first set `$env:PYTHONUTF8 = '1'` and
`$env:PYTHONIOENCODING = 'utf-8'` in PowerShell so Python subprocesses use the same
encoding as their parent. The workflow sets both variables for its jobs.

```sh
npm ci --prefix developer
node developer/node_modules/playwright/cli.js install --with-deps chromium --only-shell
node scripts/build-bundles.mjs --check
npm test --prefix developer
python -X utf8 -m unittest discover -s developer/tests/py -p 'test_*.py'
python -X utf8 developer/tests/ci/check_reading_data_integrity.py

npm ci --prefix backend
npm test --prefix backend

python -m pip install playwright==1.56.0
python -m playwright install --with-deps chromium
python -X utf8 developer/tests/e2e/e2e_runner.py
```

## Reproduce the deployment smoke test

Use Node.js 24 and a running Linux Docker engine with Docker Compose 2.24.4 or
newer. The script uses only Node built-ins, so it does not require `npm ci`.

```sh
node backend/scripts/ci-smoke.mjs
```

The script validates both Compose profiles and builds both deployment images.
It starts only PostgreSQL and the application, using the production Dockerfile and
startup migration command. The CI override removes fixed container names and the
published database port, and assigns an available loopback port to the application.
Each run has a random project name, isolated database volume, and temporary
credentials. `backend/Dockerfile.dockerignore` excludes local environment files,
dependency directories, and test artifacts from the repository-root build context.

The HTTP checks verify:

- Current homepage, bundle, stylesheet, practice page, and template contents.
- First-user registration, blocked subsequent registration, authenticated reads,
  and CSRF-protected writes.
- Two independent device sessions reading and updating full practice records,
  including answers, highlights, notes, and nested suite entries.
- Two migration reruns with no newly applied migrations.
- Existing sessions, account login, CSRF tokens, and records after application
  restart, including a further write through an existing session.

The optional Tor image is built but public Tor connectivity is not exercised.
Actual onion access remains part of manual deployment verification.

The script writes its report and container diagnostics to
`developer/tests/e2e/reports/multi-device-deploy/` and tears down its own containers,
network, and volumes in a `finally` block. Credentials and cleanup state stay in the
temporary state directory printed at startup, outside the report artifacts.

If the process is forcibly interrupted, set `MD_SMOKE_STATE_DIR` to that printed
directory and run cleanup. For example, in PowerShell:

```powershell
$env:MD_SMOKE_STATE_DIR = '<state directory printed by the interrupted run>'
node backend/scripts/ci-smoke.mjs --cleanup
Remove-Item Env:MD_SMOKE_STATE_DIR
```

In CI the state directory is fixed for the job, and a separate `always()` cleanup
step retries teardown after an interrupted smoke step. Cleanup retains its state
when Docker teardown fails so it can be retried. Never upload the temporary state
directory or its environment file as an artifact.

## Optional required check

After the first successful PR run, a maintainer can require the GitHub Actions
check `md-ci` in a branch rule matching exactly
`feature/multi-device-easy-deploy`. Apply this requirement only to that branch:
other branches do not trigger this workflow. This change does not configure branch
protection or a merge queue. A merge queue would require a separately designed
`merge_group` trigger.

## Trigger acceptance

Confirm that a PR to the deployment branch runs all jobs and that new commits
supersede older runs. Opening, reopening, marking ready, or retargeting a PR to
this branch should trigger a run. PRs to other branches, direct pushes without a
corresponding PR update, and PR closure or merge should not start this workflow.
PRs with merge conflicts must resolve the conflict before GitHub can run the
`pull_request` workflow.
