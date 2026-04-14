#!/bin/bash
set -e

APP_PATH="/Applications/IELTS Practice.app"

echo "=================================================="
echo "IELTS Practice 首次打开修复"
echo "=================================================="
echo ""
echo "此工具将执行："
echo "1) 移除系统隔离标记（quarantine）"
echo "2) 尝试本地自签（ad-hoc）"
echo "3) 自动打开应用"
echo ""

if [ ! -d "$APP_PATH" ]; then
  echo "未找到应用：$APP_PATH"
  echo "请先把 IELTS Practice.app 拖到 Applications 后再运行。"
  exit 1
fi

echo "正在移除隔离标记..."
xattr -dr com.apple.quarantine "$APP_PATH"

echo "正在尝试本地自签（失败可忽略）..."
codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true

echo "正在启动应用..."
open "$APP_PATH"

echo ""
echo "完成。若仍被阻止，请在 Finder 中右键应用并选择“打开”。"
