#!/bin/bash

# 创建不同平台的图标文件
# 注意：这些是占位符文件，生产环境需要使用真实的图标

echo "Creating platform-specific icons..."

# 创建一个简单的PNG图标作为基础
if [ ! -f "icon-base.png" ]; then
    echo "Creating base PNG icon..."
    # 使用ImageMagick创建图标（如果可用）
    if command -v convert &> /dev/null; then
        convert -size 256x256 xc:#667eea \
                -font Arial -pointsize 32 -fill white -gravity center \
                -annotate +0+0 "IELTS" \
                icon-base.png
    else
        echo "ImageMagick not found. Please create icon files manually."
        exit 1
    fi
fi

# 复制PNG作为Linux图标
cp icon-base.png icon.png

# 创建Windows ICO文件（需要ImageMagick）
if command -v convert &> /dev/null; then
    convert icon-base.png -resize 16x16 icon-16.png
    convert icon-base.png -resize 32x32 icon-32.png
    convert icon-base.png -resize 48x48 icon-48.png
    convert icon-base.png -resize 256x256 icon-256.png
    convert icon-16.png icon-32.png icon-48.png icon-256.png icon.ico
    rm icon-16.png icon-32.png icon-48.png icon-256.png
fi

# 创建macOS ICNS文件（需要iconutil或ImageMagick）
if command -v iconutil &> /dev/null; then
    mkdir -p icon.iconset
    sips -z 16 16 icon-base.png --out icon.iconset/icon_16x16.png
    sips -z 32 32 icon-base.png --out icon.iconset/icon_16x16@2x.png
    sips -z 32 32 icon-base.png --out icon.iconset/icon_32x32.png
    sips -z 64 64 icon-base.png --out icon.iconset/icon_32x32@2x.png
    sips -z 128 128 icon-base.png --out icon.iconset/icon_128x128.png
    sips -z 256 256 icon-base.png --out icon.iconset/icon_128x128@2x.png
    sips -z 256 256 icon-base.png --out icon.iconset/icon_256x256.png
    sips -z 512 512 icon-base.png --out icon.iconset/icon_256x256@2x.png
    sips -z 512 512 icon-base.png --out icon.iconset/icon_512x512.png
    sips -z 1024 1024 icon-base.png --out icon.iconset/icon_512x512@2x.png
    iconutil -c icns icon.iconset
    rm -rf icon.iconset
fi

echo "Icon creation complete!"
echo "Generated files:"
ls -la icon.*