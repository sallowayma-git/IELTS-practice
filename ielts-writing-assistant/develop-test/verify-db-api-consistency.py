#!/usr/bin/env python3
"""
数据库与API接口一致性验证
检查数据库schema与API路由的字段映射是否正确
"""

import sqlite3
import os
import re
import sys

def extract_sql_columns_from_schema():
    """从schema.sql中提取表结构"""
    schema_path = "server/database/schema.sql"
    if not os.path.exists(schema_path):
        print(f"❌ 找不到schema文件: {schema_path}")
        return {}

    tables = {}
    current_table = None

    with open(schema_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 匹配CREATE TABLE语句
    table_pattern = r'CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\);'
    matches = re.findall(table_pattern, content, re.DOTALL)

    for table_name, table_def in matches:
        columns = []
        # 匹配列定义
        lines = table_def.strip().split('\n')
        for line in lines:
            line = line.strip()
            if line and not line.startswith('--') and not line.startswith('FOREIGN KEY'):
                # 提取列名
                col_match = re.match(r'(\w+)\s+', line)
                if col_match:
                    columns.append(col_match.group(1))

        tables[table_name] = columns

    return tables

def extract_api_fields():
    """从API路由文件中提取字段"""
    api_files = [
        "server/routes/assessment-new.js",
        "server/routes/writing.js",
        "server/routes/history.js",
        "server/routes/settings.js"
    ]

    api_fields = {}

    for file_path in api_files:
        if not os.path.exists(file_path):
            continue

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 提取INSERT语句中的字段
        insert_pattern = r'INSERT INTO (\w+)\s*\(\s*([^)]+)\s*\)'
        matches = re.findall(insert_pattern, content)

        for table_name, fields in matches:
            if table_name not in api_fields:
                api_fields[table_name] = set()

            # 提取字段名
            field_list = [f.strip() for f in fields.split(',')]
            for field in field_list:
                api_fields[table_name].add(field)

        # 提取SELECT语句中的字段
        select_pattern = r'SELECT\s+(.*?)\s+FROM\s+(\w+)'
        matches = re.findall(select_pattern, content, re.IGNORECASE | re.DOTALL)

        for fields, table_name in matches:
            if table_name not in api_fields:
                api_fields[table_name] = set()

            if fields != '*':
                field_list = [f.strip() for f in fields.split(',')]
                for field in field_list:
                    # 移除别名
                    if ' as ' in field.lower():
                        field = field.lower().split(' as ')[0].strip()
                    api_fields[table_name].add(field)

    return api_fields

def check_database_connectivity():
    """检查数据库连接和数据完整性"""
    db_path = "data/ielts-writing.db"

    if not os.path.exists(db_path):
        print("❌ 数据库文件不存在，需要先初始化数据库")
        return False

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 检查表是否存在
        cursor.execute("""
            SELECT name FROM sqlite_master
            WHERE type='table' AND name IN ('users', 'topics', 'writing_records', 'assessment_results', 'settings')
        """)
        tables = cursor.fetchall()

        expected_tables = ['users', 'topics', 'writing_records', 'assessment_results', 'settings']
        missing_tables = [t for t in expected_tables if t not in [table[0] for table in tables]]

        if missing_tables:
            print(f"❌ 缺少数据表: {missing_tables}")
            return False

        # 检查是否有数据
        table_status = {}
        for table_name, in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            table_status[table_name] = count

        print("📊 数据库状态:")
        for table, count in table_status.items():
            print(f"  {table}: {count} 条记录")

        conn.close()
        return True

    except Exception as e:
        print(f"❌ 数据库连接失败: {e}")
        return False

def verify_api_route_files():
    """验证API路由文件的存在和语法"""
    required_files = [
        "server/routes/assessment-new.js",
        "server/routes/writing.js",
        "server/routes/history.js",
        "server/routes/settings.js"
    ]

    print("📁 API路由文件检查:")
    all_good = True

    for file_path in required_files:
        if os.path.exists(file_path):
            print(f"  ✓ {file_path}")

            # 简单的语法检查
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # 检查基本语法模式
                if 'router' in content and 'express' in content:
                    print(f"    ✅ 包含Express路由定义")
                else:
                    print(f"    ⚠️  可能缺少Express路由定义")
                    all_good = False

            except Exception as e:
                print(f"    ❌ 读取文件失败: {e}")
                all_good = False
        else:
            print(f"  ❌ {file_path} - 文件不存在")
            all_good = False

    return all_good

def main():
    """主验证流程"""
    print("🧪 数据库与API接口一致性验证")
    print("=" * 40)

    # 1. 检查数据库连接
    print("\n1️⃣ 检查数据库连接...")
    db_ok = check_database_connectivity()

    # 2. 检查API路由文件
    print("\n2️⃣ 检查API路由文件...")
    api_files_ok = verify_api_route_files()

    # 3. 提取数据库schema字段
    print("\n3️⃣ 提取数据库schema...")
    db_tables = extract_sql_columns_from_schema()

    print("📋 数据库表结构:")
    for table, columns in db_tables.items():
        print(f"  {table}: {len(columns)} 个字段")
        if len(columns) <= 8:  # 只显示较小的表的字段
            print(f"    字段: {', '.join(columns)}")

    # 4. 提取API字段
    print("\n4️⃣ 提取API字段...")
    api_tables = extract_api_fields()

    print("📡 API接口字段:")
    for table, fields in api_tables.items():
        print(f"  {table}: {len(fields)} 个字段")
        if len(fields) <= 8:
            print(f"    字段: {', '.join(fields)}")

    # 5. 一致性检查
    print("\n5️⃣ 一致性检查...")
    issues = []

    for table_name in db_tables:
        db_columns = set(db_tables[table_name])
        api_columns = api_tables.get(table_name, set())

        if api_columns:
            # 检查API使用的字段是否都在数据库中存在
            missing_in_db = api_columns - db_columns
            if missing_in_db:
                issues.append(f"表 {table_name}: API使用了数据库中不存在的字段 {missing_in_db}")

            # 检查重要字段是否在API中被使用
            important_fields = {'id', 'created_at', 'updated_at'}
            unused_important = important_fields - api_columns
            if unused_important and len(db_columns) > 3:
                issues.append(f"表 {table_name}: 重要字段 {unused_important} 可能在API中未被充分利用")

    if issues:
        print("⚠️  发现一致性问题:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("✅ 未发现明显的字段不一致问题")

    # 总结
    print("\n" + "=" * 40)
    print("📊 验证总结:")
    print(f"  数据库连接: {'✅ 正常' if db_ok else '❌ 异常'}")
    print(f"  API文件: {'✅ 完整' if api_files_ok else '❌ 缺失'}")
    print(f"  字段一致性: {'✅ 通过' if not issues else '⚠️  有问题'}")

    if db_ok and api_files_ok and not issues:
        print("\n🎉 数据库与API接口一致性验证通过！")
        return True
    else:
        print("\n❌ 验证发现问题，请查看上述报告")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)