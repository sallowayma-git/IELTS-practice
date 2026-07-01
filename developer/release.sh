#!/bin/bash
# =============================================================================
# IELTS Practice App — Release Script
# 路径: developer/release.sh
#
# 用法:
#   bash developer/release.sh            # 生成 dist/ielts-practice-{version}.zip
#   bash developer/release.sh 1.0.0      # 指定版本号
#
# 功能:
#   1. 运行 node scripts/build-bundles.mjs 生成 js/bundles/*.bundle.js
#   2. 打包为 zip（仅包含运行所需文件，排除源码和开发工具）
#   3. 输出文件: dist/ielts-practice-{version}.zip
#
# 用户拿到 zip 后解压双击 index.html 即可使用，无需 Node.js 或任何构建环境。
# =============================================================================

set -euo pipefail

# 切换到项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 版本号：参数指定 或 从 git tag 读取 或 默认 snapshot
if [ $# -ge 1 ]; then
    VERSION="$1"
elif command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null; then
    VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo 'snapshot')"
else
    VERSION="snapshot"
fi
VERSION="$(printf '%s' "${VERSION}" | sed 's#[^A-Za-z0-9._-]#-#g')"

DIST_DIR="dist"
ZIP_NAME="ielts-practice-${VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is required to build release bundles."
    exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
    echo "ERROR: zip is required to create the release archive."
    exit 1
fi

if ! command -v zipinfo >/dev/null 2>&1; then
    echo "ERROR: zipinfo is required to verify the release archive."
    exit 1
fi

echo "============================================"
echo " IELTS Practice App — Release Builder"
echo " Version : ${VERSION}"
echo " Output  : ${ZIP_PATH}"
echo "============================================"

# ---- 步骤 1：生成 bundle  ----
echo ""
echo "[1/2] Building bundles..."
if [ -f "scripts/build-bundles.mjs" ]; then
    node scripts/build-bundles.mjs
    echo "       Bundles generated: js/bundles/"
else
    echo "       ERROR: scripts/build-bundles.mjs not found!"
    exit 1
fi

# ---- 步骤 2：打包 zip ----
echo ""
echo "[2/2] Creating distribution zip..."

# 清理旧的 dist 目录
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

LISTENING_ZIP_INPUTS=()
LISTENING_EXCLUDE_PATTERNS=("assets/generated/listening-exams/" "assets/generated/listening-exams/*" "ListeningPractice/" "ListeningPractice/*")
if [ "${INCLUDE_LOCAL_LISTENING:-0}" = "1" ]; then
    if [ ! -f "assets/generated/listening-exams/manifest.js" ] || [ ! -f "assets/generated/listening-exams/listening-index.compat.js" ]; then
        echo "ERROR: INCLUDE_LOCAL_LISTENING=1 requires both assets/generated/listening-exams/manifest.js and listening-index.compat.js"
        exit 1
    fi
    LISTENING_EXCLUDE_PATTERNS=()
    for part in P1 P2 P3 P4; do
        if [ -d "ListeningPractice/${part}" ]; then
            LISTENING_ZIP_INPUTS+=("ListeningPractice/${part}/")
        fi
    done
fi

# 打包：只包含用户运行时需要的文件
# js/bundles/ 包含了所有 JS 逻辑，js/app/ js/core/ 等源文件不进入分发包
ZIP_INPUTS=(
    index.html
    css/
    js/bundles/
    assets/
    ReadingPractice/
)
if [ ${#LISTENING_ZIP_INPUTS[@]} -gt 0 ]; then
    ZIP_INPUTS+=("${LISTENING_ZIP_INPUTS[@]}")
fi

zip -r "${ZIP_PATH}" \
    "${ZIP_INPUTS[@]}" \
    -x "*.DS_Store" \
       '~$*' \
       "*.MOV" \
       "*.mov" \
       "*.MP4" \
       "*.mp4" \
       "*.md" \
       "*.py" \
       "assets/developer/*" \
       ".git/*" \
       ".gitignore" \
       ".claude/*" \
       "node_modules/*" \
       "${LISTENING_EXCLUDE_PATTERNS[@]}"

ZIP_LIST="$(mktemp)"
zipinfo -1 "${ZIP_PATH}" > "${ZIP_LIST}"

require_entry() {
    local entry="$1"
    if ! grep -Fxq "${entry}" "${ZIP_LIST}"; then
        echo "ERROR: release zip missing required entry: ${entry}"
        rm -f "${ZIP_LIST}"
        exit 1
    fi
}

reject_entry_prefix() {
    local prefix="$1"
    if grep -q "^${prefix}" "${ZIP_LIST}"; then
        echo "ERROR: release zip contains forbidden path prefix: ${prefix}"
        grep "^${prefix}" "${ZIP_LIST}" | head -20
        rm -f "${ZIP_LIST}"
        exit 1
    fi
}

reject_entry_pattern() {
    local pattern="$1"
    if grep -Eq "${pattern}" "${ZIP_LIST}"; then
        echo "ERROR: release zip contains forbidden entries matching: ${pattern}"
        grep -E "${pattern}" "${ZIP_LIST}" | head -20
        rm -f "${ZIP_LIST}"
        exit 1
    fi
}

require_entry "index.html"
require_entry "css/main.css"
require_entry "css/heroui-bridge.css"
require_entry "css/onboarding.css"
require_entry "assets/vendor/three.min.js"
require_entry "assets/generated/reading-exams/manifest.js"
require_entry "assets/generated/reading-exams/reading-practice-unified.html"
require_entry "js/bundles/runtime-entry.bundle.js"
require_entry "js/bundles/core-foundation.bundle.js"
require_entry "js/bundles/ui-shell.bundle.js"
require_entry "js/bundles/legacy-app.bundle.js"
require_entry "js/bundles/browse.bundle.js"
require_entry "js/bundles/practice.bundle.js"
require_entry "js/bundles/session.bundle.js"
require_entry "js/bundles/settings.bundle.js"
require_entry "js/bundles/diagnostics.bundle.js"
require_entry "js/bundles/more.bundle.js"
require_entry "js/bundles/theme.bundle.js"
require_entry "js/bundles/reading-page.bundle.js"
require_entry "js/bundles/practice-page-enhancer.bundle.js"
require_entry "js/bundles/listening-record-bridge.bundle.js"

if [ "${INCLUDE_LOCAL_LISTENING:-0}" = "1" ] && [ -f "assets/generated/listening-exams/manifest.js" ]; then
    require_entry "assets/generated/listening-exams/manifest.js"
    require_entry "assets/generated/listening-exams/listening-index.compat.js"
else
    reject_entry_prefix "assets/generated/listening-exams/"
fi

if [ "${INCLUDE_LOCAL_LISTENING:-0}" = "1" ] && [ -d "ListeningPractice" ]; then
    for part in P1 P2 P3 P4; do
        if [ -d "ListeningPractice/${part}" ]; then
            require_entry "ListeningPractice/${part}/"
        fi
    done
fi

reject_entry_prefix "templates/"
reject_entry_prefix "ListeningPractice/vip/"
reject_entry_pattern '(^|/)~\$[^/]*$'
reject_entry_pattern '^ListeningPractice/.*\.(MOV|mov|MP4|mp4)$'
reject_entry_pattern '^assets/scripts/.*\.py$'
reject_entry_pattern '^js/(app|core|data|runtime|services|utils|components|presentation|views)/'

rm -f "${ZIP_LIST}"

echo ""
echo "============================================"
echo " Done: ${ZIP_PATH}"
echo " Size : $(du -h "${ZIP_PATH}" | cut -f1)"
echo ""
echo " 用户解压后双击 index.html 即可使用。"
echo " 无需 Node.js，无需构建。"
echo "============================================"
