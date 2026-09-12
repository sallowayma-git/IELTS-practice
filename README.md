# IELTS Atlas

IELTS Atlas 是基于 **Tauri 2 + Rust + Vue + SQLite** 的本地优先 IELTS 学习桌面应用。当前 shipping 产品入口是 `apps/writing-vue`，由 `src-tauri` 承载，业务数据由 `crates/ielts-db` 持久化。

## 开发前置

clean clone 和 GitHub source ZIP 都需要先冻结 Python agent runtime sidecar，再编译 Tauri。源码不包含可直接使用的 sidecar 可执行文件；已有的 Windows `.sha256` 文件也不能代替本机构建。

先安装以下工具，并确保当前终端能找到 `python`、`node`、`npm`、`cargo` 和原生编译器：

- Python **3.12**，解释器架构与下表目标一致；CI 使用同一 Python 次版本。
- Node.js **20 或更新的受支持版本**及 npm；CI 使用 Node.js 20。
- Rust stable 与 Cargo，使用宿主平台对应的 toolchain。
- [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)：Windows 需要 Visual Studio C++ Build Tools（Desktop development with C++、Windows SDK）和 WebView2 Runtime；macOS 需要 Xcode Command Line Tools；Linux 需要 WebKitGTK 4.1 等开发库。
- Git（clone 路径需要；解压后的源码构建不依赖 `.git`）。

| 原生构建环境 | Python 架构 | Rust / sidecar target |
| --- | --- | --- |
| Windows x64 | x64 | `x86_64-pc-windows-msvc` |
| macOS Apple Silicon | arm64 | `aarch64-apple-darwin` |
| Linux x64（发布 CI：Ubuntu 22.04） | x64 | `x86_64-unknown-linux-gnu` |

Ubuntu 22.04 的依赖准备命令如下；其他发行版按 Tauri 官方说明安装对应包：

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file pkg-config libssl-dev libxdo-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### 获取源码

clone 当前开发分支：

```bash
git clone --branch IELTS-WRITING-FEAT --single-branch https://github.com/sallowayma-git/IELTS-practice.git
cd IELTS-practice
git rev-parse HEAD
```

也可以下载 [IELTS-WRITING-FEAT source ZIP](https://github.com/sallowayma-git/IELTS-practice/archive/refs/heads/IELTS-WRITING-FEAT.zip)，解压后进入含有 `Cargo.toml`、`package.json`、`agent-runtime-python/` 的目录。复现指定版本时，clone 后执行 `git checkout <完整提交 SHA>`；ZIP 使用 `https://github.com/sallowayma-git/IELTS-practice/archive/<完整提交 SHA>.zip`，记录该 SHA 和下载文件的 SHA-256。ZIP 无需执行 `git init`。

以下命令全部在源码根目录执行。两个来源使用相同的依赖、冻结和构建步骤；不要复制其他工作区的 `target/`、`dist/` 或 sidecar。

### 安装依赖并冻结 sidecar

创建独立 Python 3.12 环境。Windows PowerShell：

```powershell
python -m venv .tmp/venv
$env:PATH = (Join-Path $PWD '.tmp/venv/Scripts') + ';' + $env:PATH
$env:PYTHONUTF8 = '1'
python --version
```

macOS / Linux shell：

```bash
python3.12 -m venv .tmp/venv
. .tmp/venv/bin/activate
python --version
```

然后在同一终端按顺序执行，任一步失败都应先解决再继续：

```bash
npm --prefix apps/writing-vue ci --no-fund --no-audit
npm install --global @tauri-apps/cli@2.11.4 --no-fund --no-audit
python -m pip install --disable-pip-version-check -r agent-runtime-python/requirements-build.lock -r agent-runtime-python/requirements.lock
python developer/tests/ci/build_agent_runtime_sidecar.py
```

`tauri` 是上面安装的 npm CLI，版本与发布 workflow 一致；npm 的全局可执行目录也需要在 `PATH` 中。若使用已有的 `cargo tauri` 或根目录 `npm run dev` / `npm run build`，另需安装 Cargo CLI：`cargo install tauri-cli --version 2.11.4 --locked`。

冻结脚本自动识别表中的原生宿主。也可以显式指定匹配目标，例如在 Apple Silicon 上运行 `python developer/tests/ci/build_agent_runtime_sidecar.py --target aarch64-apple-darwin`；`--target` 不提供交叉编译，Python 架构、Rust target 和宿主必须匹配。

脚本执行干净的 PyInstaller freeze 和完整协议 smoke，通过后才发布 `src-tauri/binaries/ielts-agent-runtime-<target>[.exe]` 及 `ielts-agent-runtime-<target>.sha256`。指标写入 `developer/tests/benchmarks/reports/m3_sidecar_release.json`。`src-tauri/build.rs` 在每次相关编译时验证可执行文件与 SHA-256 manifest；不要手工填入 hash、跳过 smoke 或复用其他目标的文件。修改 runtime 源码或依赖锁后重新冻结。

两个 Python lock 文件安装第三方依赖。当前冻结入口配置了 `agent-runtime-python/src`，smoke 使用独立的六项能力合同，不导入源码包，因此这条构建路径无需额外 `pip install -e` 或设置 `PYTHONPATH`。

## 开发与本地构建

完成上述准备后启动原生开发窗口：

```bash
tauri dev
```

构建本机 release 可执行程序（与 release shipping gate 使用同一路径）：

```bash
tauri build --ci --no-bundle
```

Tauri CLI 会运行 Vue 的 `beforeBuildCommand`。默认产物位于 `target/release/`，Windows 主程序为 `ielts-practice-tauri.exe`。需要本地安装包时执行 `tauri build --ci`，产物位于 `target/release/bundle/`；正式签名、updater 和发布流程见[发布运行手册](developer/docs/phase10-release-runbook.md)。

直接运行 Cargo workspace 检查和测试时，还需先生成 Vue `frontendDist`：

```bash
npm --prefix apps/writing-vue run build
cargo check --workspace --locked
cargo test --workspace --locked
```

sidecar 准备必须早于 `tauri dev/build`、`cargo tauri dev/build`、上述 workspace 命令，以及会编译 Tauri 的静态门禁。

### Windows 必需回归

当前静态 suite 使用 `npm.cmd`，原生练习流程使用 Windows WebView2/EdgeDriver；这对回归命令在 Windows 上执行，不能作为 macOS/Linux 本地回归成功的依据。

先完成 sidecar 和 `tauri build --ci --no-bundle`，再准备原生驱动。以下 PowerShell 命令通过仓库脚本下载与已安装 WebView2 精确匹配、且 Authenticode 校验通过的 EdgeDriver：

```powershell
cargo install tauri-driver --version 2.0.6 --locked
./developer/tests/ci/install_edge_webdriver.ps1 -Destination .tmp/edgedriver
$env:TAURI_DRIVER = (Get-Command tauri-driver).Source
$env:TAURI_NATIVE_DRIVER = (Resolve-Path .tmp/edgedriver/msedgedriver.exe).Path
$env:TAURI_APP_BINARY = (Resolve-Path target/release/ielts-practice-tauri.exe).Path
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

两条回归命令必须按此顺序执行。报告为 `developer/tests/e2e/reports/static-ci-report.json` 和 `suite-practice-flow-report.json`，截图也在该目录。原生流程会实际启动 Tauri；这里不需要 Playwright。CI 独立的浏览器视觉门禁及其 Playwright 依赖由 workflow 准备。

## 目录

- `apps/writing-vue/`：阅读、写作和 Agent 工作台 Vue 界面。
- `src-tauri/`：Tauri commands、AI runtime、权限和桌面宿主。
- `crates/ielts-domain/`：领域合同和序列化类型。
- `crates/ielts-db/`：SQLite schema、迁移、业务查询和学习事件账本。
- `assets/resource-pack/`：运行时题目资源包。
- `developer/tests/ci/`、`developer/tests/e2e/`：当前静态门禁和打包 E2E。

## 文档

- [Agent 自进化总任务书](developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md)
- [Tauri Phase 10 发布运行手册](developer/docs/phase10-release-runbook.md)
- [架构 ADR](docs/architecture/)
- [M0 评估](docs/evaluations/agent-m0-baseline-eval.md)
- [Tauri cutover 迁移记录](docs/rewrite/phase10-cutover.md)

总任务书是 Agent 自进化路线的唯一权威计划。`docs/rewrite/` 中的 Phase 文档仅作为迁移历史和数据合同记录，不代表当前开发状态。

## 产品边界

Electron、Fastify、根目录静态 HTML 和旧 `js/` 运行时已经从 shipping 树移除。当前前端通过 Tauri invoke 调用 Rust commands；SQLite 是练习、历史、评估、Coach 和 Agent 运行数据的持久化真相源。

## 许可证

代码采用 GNU GPL v3，详见 [LICENSE](LICENSE)。题库内容仅供学习使用，版权归原作者所有。
