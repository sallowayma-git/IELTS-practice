#!/usr/bin/env python3
"""
服务器端路径完整性检查器
解决浏览器CORS限制，从服务器端检查文件存在性
"""

import os
import sys
import re
from pathlib import Path
from urllib.parse import urljoin

class ServerPathIntegrityChecker:
    def __init__(self, base_dir="."):
        self.base_dir = Path(base_dir).resolve()
        self.results = []

    def check_html_file(self, html_path):
        """检查单个HTML文件中的脚本引用"""
        print(f"\n🔍 检查文件: {html_path}")

        full_path = self.base_dir / html_path
        if not full_path.exists():
            print(f"  ❌ 文件不存在: {html_path}")
            return {
                'fileName': html_path,
                'exists': False,
                'totalScripts': 0,
                'validScripts': 0,
                'invalidScripts': 0,
                'scripts': []
            }

        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"  ❌ 无法读取文件: {e}")
            return {
                'fileName': html_path,
                'exists': True,
                'readError': str(e),
                'totalScripts': 0,
                'validScripts': 0,
                'invalidScripts': 0,
                'scripts': []
            }

        # 查找所有script标签
        script_pattern = r'<script[^>]+src="([^"]+)"[^>]*>'
        scripts = re.findall(script_pattern, content, re.IGNORECASE)

        if not scripts:
            print(f"  ℹ️  未发现脚本引用")
            return {
                'fileName': html_path,
                'exists': True,
                'totalScripts': 0,
                'validScripts': 0,
                'invalidScripts': 0,
                'scripts': []
            }

        print(f"  📊 发现 {len(scripts)} 个脚本引用")

        valid_count = 0
        invalid_count = 0
        script_results = []

        for script_src in scripts:
            # 解析相对路径
            script_path = self.resolve_script_path(html_path, script_src)
            is_accessible = self.check_file_exists(script_path)

            status = '✅ PASS' if is_accessible else '❌ FAIL'
            print(f"  {status} {script_src}")

            script_results.append({
                'src': script_src,
                'resolvedPath': str(script_path),
                'accessible': is_accessible
            })

            if is_accessible:
                valid_count += 1
            else:
                invalid_count += 1

        # 输出摘要
        if scripts:
            pass_rate = (valid_count / len(scripts)) * 100
            status = '✅ PASS' if invalid_count == 0 else '❌ FAIL'
            print(f"  📋 摘要: {valid_count}/{len(scripts)} 可访问 ({pass_rate:.1f}%) {status}")

        return {
            'fileName': html_path,
            'exists': True,
            'totalScripts': len(scripts),
            'validScripts': valid_count,
            'invalidScripts': invalid_count,
            'scripts': script_results
        }

    def resolve_script_path(self, html_path, script_src):
        """解析脚本相对路径"""
        html_dir = Path(html_path).parent

        # 处理相对路径
        if script_src.startswith('../'):
            script_path = (html_dir / script_src).resolve()
        elif script_src.startswith('./'):
            script_path = (html_dir / script_src[2:]).resolve()
        elif script_src.startswith('/'):
            script_path = self.base_dir / script_src[1:]
        else:
            script_path = (html_dir / script_src).resolve()

        # 转换为相对于base_dir的路径
        try:
            return script_path.relative_to(self.base_dir)
        except ValueError:
            return script_path

    def check_file_exists(self, file_path):
        """检查文件是否存在"""
        # 转换为Path对象
        if isinstance(file_path, str):
            file_path = Path(file_path)

        full_path = self.base_dir / file_path
        return full_path.exists() and full_path.is_file()

    def generate_report(self, results):
        """生成完整性报告"""
        print('\n' + '=' * 60)
        print('📋 服务器端路径完整性检查报告')
        print('=' * 60)

        total_files = len(results)
        total_scripts = 0
        total_valid = 0
        total_invalid = 0

        for result in results:
            if not result.get('exists', True):
                print(f"\n📄 {result['fileName']}")
                print(f"   状态: ❌ 文件不存在")
                continue

            if 'readError' in result:
                print(f"\n📄 {result['fileName']}")
                print(f"   状态: ❌ 读取错误 ({result['readError']})")
                continue

            total_scripts += result['totalScripts']
            total_valid += result['validScripts']
            total_invalid += result['invalidScripts']

            print(f"\n📄 {result['fileName']}")
            print(f"   脚本数量: {result['totalScripts']}")
            print(f"   有效: {result['validScripts']} ✅")
            print(f"   无效: {result['invalidScripts']} ❌")

            if result['invalidScripts'] > 0:
                print('   无效脚本:')
                for script in result['scripts']:
                    if not script['accessible']:
                        print(f"     - {script['src']} → {script['resolvedPath']}")

        # 总体统计
        overall_pass_rate = (total_valid / total_scripts * 100) if total_scripts > 0 else 100
        overall_status = '✅ PASS' if total_invalid == 0 else '❌ FAIL'

        print('\n' + '-' * 60)
        print('📊 总体统计:')
        print(f'   检查文件数: {total_files}')
        print(f'   总脚本数: {total_scripts}')
        print(f'   有效脚本: {total_valid} ✅')
        print(f'   无效脚本: {total_invalid} ❌')
        print(f'   整体通过率: {overall_pass_rate:.1f}%')
        print(f'   总体状态: {overall_status}')
        print('=' * 60)

        return {
            'totalFiles': total_files,
            'totalScripts': total_scripts,
            'validScripts': total_valid,
            'invalidScripts': total_invalid,
            'passRate': overall_pass_rate,
            'status': overall_status,
            'details': results
        }

    def check_files(self, file_list):
        """检查文件列表"""
        print(f"🚀 开始检查 {len(file_list)} 个文件...")

        results = []
        for file_path in file_list:
            result = self.check_html_file(file_path)
            results.append(result)

        return self.generate_report(results)


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法: python test_server_path_check.py <file1.html> [file2.html] ...")
        print("示例: python test_server_path_check.py index.html test_file_protocol.html")
        sys.exit(1)

    file_list = sys.argv[1:]
    checker = ServerPathIntegrityChecker()

    try:
        report = checker.check_files(file_list)

        # 根据结果设置退出代码
        if report['status'] == '✅ PASS':
            sys.exit(0)
        else:
            sys.exit(1)

    except Exception as e:
        print(f"❌ 检查过程中发生错误: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()