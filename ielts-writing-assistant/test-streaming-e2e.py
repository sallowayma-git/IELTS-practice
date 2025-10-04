#!/usr/bin/env python3
"""
Phase 1 流式评估端到端测试
验证完整的评估流程和数据传递
"""

import subprocess
import sys
import os
import time
import json
import requests
from urllib.parse import urlparse

def test_server_health():
    """测试服务器健康状态"""
    print("🔍 测试服务器健康状态...")
    try:
        response = requests.get('http://localhost:3001/api/health', timeout=5)
        if response.status_code == 200:
            print("  ✓ 服务器运行正常")
            return True
        else:
            print(f"  ✗ 服务器响应异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"  ✗ 服务器连接失败: {e}")
        return False

def test_ai_providers():
    """测试AI提供商接口"""
    print("\n🤖 测试AI提供商接口...")
    try:
        response = requests.get('http://localhost:3001/api/assessment/providers')
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print(f"  ✓ 支持的提供商: {[p.get('label') for p in data.get('data', [])]}")
                return True
        print(f"  ✗ 获取提供商列表失败: {response.text}")
        return False
    except Exception as e:
        print(f"  ✗ AI提供商接口测试失败: {e}")
        return False

def test_writing_topics():
    """测试写作题目接口"""
    print("\n📝 测试写作题目接口...")
    try:
        response = requests.get('http://localhost:3001/api/writing/topics/random')
        if response.status_code == 200:
            data = response.json()
            if data.get('success') and data.get('data'):
                topic = data['data']
                print(f"  ✓ 获取到题目: {topic.get('title', 'Unknown')[:50]}...")
                return topic.get('id')
        print(f"  ✗ 获取题目失败: {response.text}")
        return None
    except Exception as e:
        print(f"  ✗ 写作题目接口测试失败: {e}")
        return None

def test_streaming_assessment(topic_id):
    """测试流式评估接口"""
    print(f"\n🚀 测试流式评估接口 (Topic ID: {topic_id})...")

    # 创建测试写作内容
    test_content = """
    The rapid advancement of technology has fundamentally transformed modern society in numerous ways.
    From communication to commerce, education to entertainment, technological innovations have reshaped
    how we live, work, and interact with one another. This essay will explore the profound impact of
    technology on contemporary life, examining both its benefits and potential drawbacks.

    Firstly, technology has revolutionized communication, breaking down geographical barriers and
    enabling instant global connectivity. Social media platforms, video conferencing tools, and
    messaging applications have made it possible for people to maintain relationships across vast
    distances, collaborate on projects remotely, and share information in real-time. This unprecedented
    level of connectivity has transformed personal relationships, business operations, and even
    international diplomacy.

    Furthermore, technology has dramatically improved access to information and education. The internet
    has become a vast repository of knowledge, with countless educational resources, online courses,
    and digital libraries available at our fingertips. This democratization of information has empowered
    individuals to pursue self-directed learning, acquire new skills, and stay informed about global
    events. Educational institutions have also embraced technology, incorporating digital tools and
    online learning platforms into their curricula.

    In the realm of commerce and economy, technology has created new opportunities and business models.
    E-commerce platforms have transformed retail, allowing consumers to shop from anywhere and businesses
    to reach global markets. Automation and artificial intelligence have increased productivity and
    efficiency in various industries, while creating new job categories in technology sectors. The
    digital economy has become a significant driver of economic growth and innovation.

    However, it is important to acknowledge that technological advancement also presents challenges.
    Concerns about privacy, digital security, and the potential for technology to create social isolation
    are valid and require careful consideration. The rapid pace of technological change can also create
    skill gaps and workforce displacement in certain sectors. Additionally, the digital divide remains
    a significant issue, with unequal access to technology and digital literacy across different
    socioeconomic groups.

    In conclusion, technology has profoundly impacted modern society, bringing numerous benefits
    while also presenting challenges that must be addressed. The key lies in harnessing technology's
    potential while mitigating its risks through responsible development and implementation. As we
    continue to innovate and integrate technology into our lives, it is essential to prioritize
    ethical considerations, digital inclusion, and sustainable progress. The future of technology
    holds great promise, and its thoughtful application will continue to shape the trajectory of
    human development.
    """

    try:
        # 发送流式评估请求
        response = requests.post(
            'http://localhost:3001/api/assessment/submit',
            json={
                'content': test_content,
                'topic': {
                    'id': topic_id,
                    'title': 'Test Topic',
                    'type': 'Essay',
                    'min_words': 250
                },
                'streaming': True
            },
            stream=True,
            timeout=30
        )

        if response.status_code == 200:
            print("  ✓ 流式评估连接成功")
            events_received = []
            result_id = None

            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        try:
                            event_data = json.loads(line_str[6:])
                            events_received.append(event_data)

                            if event_data.get('type') == 'complete':
                                result_id = event_data.get('content', {}).get('id')
                                print(f"  ✓ 评估完成，获得结果ID: {result_id}")
                                break
                            elif event_data.get('type') == 'progress':
                                progress = event_data.get('message', '')
                                print(f"  ⏳ 进度: {progress}")
                            elif event_data.get('type') == 'error':
                                print(f"  ✗ 评估错误: {event_data.get('message')}")
                                return None
                        except json.JSONDecodeError:
                            continue

            if events_received:
                print(f"  ✓ 接收到 {len(events_received)} 个事件")
                return result_id
            else:
                print("  ✗ 未接收到任何事件")
                return None
        else:
            print(f"  ✗ 流式评估请求失败: {response.status_code}")
            print(f"    响应内容: {response.text[:200]}...")
            return None
    except Exception as e:
        print(f"  ✗ 流式评估测试失败: {e}")
        return None

def test_assessment_result(result_id):
    """测试评估结果获取"""
    if not result_id:
        print("\n❌ 无法测试结果获取，缺少结果ID")
        return False

    print(f"\n📊 测试评估结果获取 (ID: {result_id})...")
    try:
        response = requests.get(f'http://localhost:3001/api/assessment/results/{result_id}')
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                result = data.get('data')
                print(f"  ✓ 成功获取评估结果")
                print(f"    总体评分: {result.get('overall_score')}")
                print(f"    等级: {result.get('level')}")
                print(f"    词汇评分: {result.get('vocabulary_score')}")
                print(f"    语法评分: {result.get('grammar_score')}")
                return True
        print(f"  ✗ 获取评估结果失败: {response.text}")
        return False
    except Exception as e:
        print(f"  ✗ 评估结果获取测试失败: {e}")
        return False

def main():
    """主测试流程"""
    print("🧪 Phase 1 流式评估端到端测试开始...\n")

    # 测试步骤
    tests = [
        ("服务器健康检查", test_server_health),
        ("AI提供商接口", test_ai_providers),
        ("写作题目获取", test_writing_topics),
    ]

    topic_id = None

    # 执行基础测试
    for test_name, test_func in tests:
        try:
            result = test_func()
            if test_name == "写作题目获取":
                topic_id = result
        except Exception as e:
            print(f"  ✗ {test_name}执行异常: {e}")
            print("\n❌ 测试终止：基础功能测试失败")
            return False

    if not topic_id:
        print("\n❌ 测试终止：无法获取写作题目")
        return False

    # 流式评估测试
    result_id = test_streaming_assessment(topic_id)

    # 评估结果获取测试
    if result_id:
        success = test_assessment_result(result_id)
        if success:
            print("\n🎉 Phase 1 流式评估端到端测试全部通过！")
            return True

    print("\n❌ 测试失败：流式评估流程存在问题")
    return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)