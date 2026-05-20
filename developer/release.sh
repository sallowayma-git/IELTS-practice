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

DIST_DIR="dist"
ZIP_NAME="ielts-practice-${VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

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

# 打包：只包含用户运行时需要的文件
# js/bundles/ 包含了所有 JS 逻辑，js/app/ js/core/ 等源文件不进入分发包
zip -r "${ZIP_PATH}" \
    index.html \
    css/ \
    js/bundles/ \
    assets/ \
    ReadingPractice/ \
    -x "*.DS_Store" \
       "*.md" \
       "assets/developer/*" \
       ".git/*" \
       ".gitignore" \
       ".claude/*" \
       "node_modules/*"

echo ""
echo "============================================"
echo " Done: ${ZIP_PATH}"
echo " Size : $(du -h "${ZIP_PATH}" | cut -f1)"
echo ""
echo " 用户解压后双击 index.html 即可使用。"
echo " 无需 Node.js，无需构建。"
echo "============================================"
