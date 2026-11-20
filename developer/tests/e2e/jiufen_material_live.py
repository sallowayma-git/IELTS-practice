"""Explicit live-account verification. Creates one reading and one listening test attempt.

The report retains attempt IDs before submission so a rerun uses the frozen request.
"""
import argparse
import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from packaged_tauri_flow import (
    Driver, ROOT, pick_ports, require, select_native_driver, stage_test_runtime,
    start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)


def invoke(driver, command, arguments=None):
    return driver.script('return window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])', [command, arguments or {}])


def main(binary):
    report_path = ROOT / 'developer/tests/e2e/reports/jiufen-material-live.json'
    report = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {}

    def save():
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    staged, runtime, _ = stage_test_runtime(binary)
    with staged, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as webview, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports,
                                  {**os.environ, 'WEBVIEW2_USER_DATA_FOLDER': webview}, log)
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            driver.call('POST', f'/session/{driver.sid}/timeouts', {'script': 120000})
            require(invoke(driver, 'jiufen_restore'), 'Atlas session unavailable')
            invoke(driver, 'jiufen_library', {'refresh': False})
            for channel, unit_id in [('reading', '2017137445860642818'), ('listening', '2021830170447020033')]:
                if channel not in report:
                    asset = invoke(driver, 'jiufen_open_unit', {'unitId': unit_id, 'channel': channel})
                    require(isinstance(asset, str) and asset.startswith('jiufen-native-'), 'invalid native asset')
                    report[channel] = {'assetId': asset, 'attemptId': str(uuid.uuid4())}
                    save()
                case = report[channel]
                driver.script('location.hash = arguments[0]', [f'#/{channel}/{case["assetId"]}'])
                wait_for_value(driver, "return document.querySelectorAll('#question-groups [name]').length > 0", 60)
                case['practiceControls'] = driver.script("return document.querySelectorAll('#question-groups [name]').length")
                require(not driver.script("return Boolean(document.querySelector('[data-study-transcript]'))"), 'review materials visible during exam')
                answers = dict(zip([f'q{n}' for n in range(1, 14)],
                                   ['A', 'A', 'A', 'C', 'B', 'populations', 'records', 'salt', 'glass', 'texture', 'lightweight', 'chisel', ''])) if channel == 'reading' else {'q1': 'test'}
                if 'score' not in case:
                    result = invoke(driver, 'jiufen_submit', {'cmd': {'assetId': case['assetId'], 'attemptId': case['attemptId'],
                        'channel': channel, 'answers': answers, 'markedQuestions': [], 'questionTimeline': [], 'durationMs': 10000}})
                    require(isinstance(result, dict) and 'score' in result, 'submission failed')
                    case['score'] = result['score']
                    save()
                driver.script('location.hash = arguments[0]', [f'#/{channel}/{case["assetId"]}/review/{case["attemptId"]}'])
                wait_for_value(driver, "return Boolean(document.querySelector('[data-locate-answer=q1]'))", 90, label=f'{channel} official analysis and material')
                material = invoke(driver, 'jiufen_study_material', {'assetId': case['assetId'], 'channel': channel, 'attemptId': case['attemptId']})
                case['questionMaterials'] = len(material['questions'])
                require(case['questionMaterials'] == (13 if channel == 'reading' else 10), 'incomplete question analyses')
                if channel == 'reading':
                    driver.script("document.querySelector('[data-study-transcript]').open = true")
                    case['translations'] = driver.script("return document.querySelectorAll('.study-translation').length")
                else:
                    driver.script("document.querySelector('[data-study-transcript] input[type=checkbox]').click()")
                    case['translations'] = driver.script("return document.querySelectorAll('.listening-transcript__translation').length")
                driver.script("document.querySelector('[data-locate-answer=q1]').click()")
                case['locatedSentences'] = wait_for_value(driver, "return document.querySelectorAll('[data-study-sentence].is-located, [data-translated-sentence].is-located').length", 10)
                if channel == 'listening':
                    sentences = [s for part in material['parts'] for para in part['paragraphs'] for s in para['sentences']]
                    sentence = next(s for s in sentences if s['id'] in material['questions']['q1']['sentenceIds'])
                    wait_for_value(driver, "return document.querySelector('audio')?.readyState >= 1", 60)
                    require(not driver.script("return document.querySelector('[data-listening-audio]').innerText.includes('暂无录音')"), 'loaded player shows missing audio')
                    driver.script("document.querySelector('audio').muted=true; document.querySelector('[data-play-sentence=\"'+arguments[0]+'\"]').click()", [sentence['id']])
                    case['playbackStarted'] = wait_for_value(driver, "const a=document.querySelector('audio'); return !a.paused && a.currentTime >= arguments[0] ? a.currentTime : null", 10, args=[sentence['startSeconds']])
                    case['playbackStopped'] = wait_for_value(driver, "const a=document.querySelector('audio'); return a.paused && a.currentTime >= arguments[0] ? a.currentTime : null", 15, args=[sentence['endSeconds']])
                    case['expectedEnd'] = sentence['endSeconds']
                    case['expectedStart'] = sentence['startSeconds']
                    require(case['playbackStopped'] - sentence['endSeconds'] < 0.3, 'sentence playback did not stop at boundary')
                    driver.call('POST', f'/session/{driver.sid}/window/rect', {'width': 720, 'height': 900})
                    require(driver.script("return document.documentElement.scrollWidth <= window.innerWidth + 1"), 'transcript overflows narrow window')
                    driver.screenshot(report_path.parent / 'jiufen-listening-material-narrow.png')
                    driver.call('POST', f'/session/{driver.sid}/window/rect', {'width': 1400, 'height': 1000})
                require(case['translations'] == (37 if channel == 'reading' else 51), 'missing sentence translations')
                driver.screenshot(report_path.parent / f'jiufen-{channel}-material.png')
                save()
            driver.close()
            driver.sid = None
            driver.create(str(runtime))
            wait_for_vue(driver)
            require(invoke(driver, 'jiufen_restore'), 'session not restored on restart')
            for channel in ['reading', 'listening']:
                case = report[channel]
                driver.script('location.hash = arguments[0]', [f'#/{channel}/{case["assetId"]}/review/{case["attemptId"]}'])
                wait_for_value(driver, "return Boolean(document.querySelector('[data-locate-answer=q1]'))", 60)
                case['restartReview'] = 'passed'
            save()
            print(json.dumps({key: {k:v for k,v in value.items() if k not in ('assetId','attemptId')} for key,value in report.items()}, ensure_ascii=True))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--live-account-submit', action='store_true', required=True)
    main(parser.parse_args().binary.resolve())
