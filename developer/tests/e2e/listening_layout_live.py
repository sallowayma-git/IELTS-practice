"""Read-only UI verification against an existing Jiufen listening attempt."""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

from packaged_tauri_flow import (
    Driver, ROOT, pick_ports, require, select_native_driver, stage_test_runtime,
    start_tauri_driver, stop_process, wait_for_value, wait_for_vue,
)
from jiufen_material_live import invoke


def main(binary):
    reports = ROOT / 'developer/tests/e2e/reports'
    case = json.loads((reports / 'jiufen-material-live.json').read_text(encoding='utf-8'))['listening']
    require('score' in case, 'An already submitted listening attempt is required')
    report = {}
    staged, runtime, _ = stage_test_runtime(binary)
    with staged, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as webview, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports,
                                  {**os.environ, 'WEBVIEW2_USER_DATA_FOLDER': webview}, log)
        try:
            driver.create(str(runtime))
            wait_for_vue(driver)
            driver.call('POST', f'/session/{driver.sid}/window/rect', {'width': 1400, 'height': 1000})
            driver.call('POST', f'/session/{driver.sid}/timeouts', {'script': 120000})
            require(invoke(driver, 'jiufen_restore'), 'Atlas session unavailable')
            reading = json.loads((reports / 'jiufen-material-live.json').read_text(encoding='utf-8'))['reading']
            driver.script('location.hash=arguments[0]', [f'#/reading/{reading["assetId"]}/review/{reading["attemptId"]}'])
            wait_for_value(driver, "return Boolean(document.querySelector('[data-locate-answer=q1]'))", 90)
            driver.script('location.hash=arguments[0]', [f'#/listening/{case["assetId"]}'])
            wait_for_value(driver, "return document.querySelectorAll('#question-groups [name]').length > 0", 60)
            require(not driver.script("return Boolean(document.querySelector('[data-study-transcript]'))"), 'practice exposes review material')
            wait_for_value(driver, "return document.querySelector('audio')?.readyState >= 1", 60)
            driver.script("document.querySelector('audio').muted=true; document.querySelector('.listening-audio__play').click()")
            wait_for_value(driver, "return !document.querySelector('audio').paused", 10)
            driver.script("document.querySelector('.listening-audio__play').click()")
            wait_for_value(driver, "return document.querySelector('audio').paused", 10)
            driver.script("const seek=document.querySelector('.listening-audio__seek'); seek.value=20; seek.dispatchEvent(new Event('input',{bubbles:true}))")
            wait_for_value(driver, "return Math.abs(document.querySelector('audio').currentTime-20) < 1", 10)
            driver.script("const volume=document.querySelector('[aria-label=音量]'); volume.value=0.25; volume.dispatchEvent(new Event('input',{bubbles:true}))")
            require(driver.script("return document.querySelector('audio').volume === 0.25"), 'volume control failed')
            driver.screenshot(reports / 'listening-layout-practice.png')
            report['transport'] = 'play, pause, seek, volume passed'

            driver.script('location.hash=arguments[0]', [f'#/listening/{case["assetId"]}/review/{case["attemptId"]}'])
            wait_for_value(driver, "return Boolean(document.querySelector('[data-locate-answer=q1]'))", 90)
            require(driver.script("return document.querySelectorAll('[data-review-question-id]').length === 10"), 'missing review rows')
            driver.script("document.querySelector('[data-study-transcript] input[type=checkbox]').click()")
            report['translations'] = driver.script("return document.querySelectorAll('.listening-transcript__translation').length")
            require(report['translations'] == 51, 'missing translations')
            driver.script("document.querySelector('[data-locate-answer=q1]').click()")
            wait_for_value(driver, "return document.querySelectorAll('[data-study-sentence].is-located').length > 0", 10)
            wait_for_value(driver, """
                const body=document.querySelector('#left .listening-exam__pane-body').getBoundingClientRect();
                const sentence=document.querySelector('[data-study-sentence].is-located').getBoundingClientRect();
                return sentence.top >= body.top && sentence.bottom <= body.bottom;
            """, 10)
            report['answerLocation'] = 'visible in transcript pane'
            material = invoke(driver, 'jiufen_study_material', {'assetId': case['assetId'], 'channel': 'listening', 'attemptId': case['attemptId']})
            sentences = [s for part in material['parts'] for paragraph in part['paragraphs'] for s in paragraph['sentences']]
            sentence = next(s for s in sentences if s['id'] in material['questions']['q1']['sentenceIds'])
            wait_for_value(driver, "return document.querySelector('audio')?.readyState >= 1", 60)
            driver.script("document.querySelector('audio').muted=true; document.querySelector('[data-play-sentence=\"'+arguments[0]+'\"]').click()", [sentence['id']])
            wait_for_value(driver, "return !document.querySelector('audio').paused && Boolean(document.querySelector('.listening-transcript__sentence.is-playing'))", 10)
            report['sentenceStop'] = wait_for_value(driver, "const a=document.querySelector('audio'); return a.paused && a.currentTime >= arguments[0] ? a.currentTime : null", 15, args=[sentence['endSeconds']])
            require(report['sentenceStop'] - sentence['endSeconds'] < 0.3, 'sentence boundary exceeded')
            require(not driver.script("return Boolean(document.querySelector('.listening-transcript__sentence.is-playing'))"), 'paused sentence still marked playing')

            before = driver.script("return document.querySelector('#left').getBoundingClientRect().width")
            driver.script("document.querySelector('#divider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))")
            after = driver.script("return document.querySelector('#left').getBoundingClientRect().width")
            require(after > before, 'keyboard splitter failed')
            report['splitter'] = {'before': before, 'after': after}
            handle = driver.script("const r=document.querySelector('#divider').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}")
            driver.call('POST', f'/session/{driver.sid}/actions', {'actions': [{
                'type': 'pointer', 'id': 'splitter-mouse', 'parameters': {'pointerType': 'mouse'},
                'actions': [
                    {'type': 'pointerMove', 'duration': 0, 'x': handle['x'], 'y': handle['y']},
                    {'type': 'pointerDown', 'button': 0},
                    {'type': 'pointerMove', 'duration': 200, 'x': handle['x'] - 40, 'y': handle['y']},
                    {'type': 'pointerUp', 'button': 0},
                ],
            }]})
            require(driver.script("return document.querySelector('#left').getBoundingClientRect().width") < after,
                    'pointer splitter failed')
            report['pointerSplitter'] = 'passed'
            padding = driver.script("return parseFloat(getComputedStyle(document.querySelector('#right .listening-exam__pane-body')).paddingLeft)")
            require(padding >= 16, 'shared exam reset removed listening pane padding')
            driver.script("document.querySelector('[data-review-question-id=q1] .listening-review__question').click()")
            wait_for_value(driver, "return document.querySelector('#listening-question-content').getBoundingClientRect().height > 0", 10)
            require(driver.script("return [...document.querySelectorAll('#question-groups input')].every(i => i.disabled || i.readOnly)"), 'review answer controls are editable')
            driver.screenshot(reports / 'listening-layout-review-questions.png')
            driver.script("document.querySelector('[aria-controls=listening-answer-content]').click()")
            driver.script("document.querySelectorAll('.q-item')[1].click()")
            wait_for_value(driver, "return document.querySelector('[data-review-question-id=q2]').classList.contains('is-active')", 10)
            driver.script("document.querySelectorAll('.q-item')[0].click()")
            wait_for_value(driver, "return document.querySelector('[data-review-question-id=q1]').classList.contains('is-active')", 10)
            driver.script("document.querySelector('#right .listening-exam__pane-body').scrollTo({top:0,behavior:'instant'})")
            driver.screenshot(reports / 'listening-layout-review.png')
            for width in (900, 640):
                driver.call('POST', f'/session/{driver.sid}/window/rect', {'width': width, 'height': 900})
                geometry = driver.script("""
                    const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
                    return {left:rect('left'),right:rect('right'),width:innerWidth,overflow:document.documentElement.scrollWidth > innerWidth+1};
                """)
                require(not geometry['overflow'], f'horizontal overflow at {width}: {geometry}')
                require(geometry['left']['h'] > 100 and geometry['right']['h'] > 100, f'collapsed panes: {geometry}')
                if geometry['width'] <= 700:
                    require(geometry['right']['y'] > geometry['left']['y'], 'compact panes must stack')
                else:
                    require(geometry['right']['x'] > geometry['left']['x'], 'desktop panes must sit side by side')
                    require(geometry['left']['w'] >= 280 and geometry['right']['w'] >= 300,
                            f'desktop pane widths must remain usable: {geometry}')
                require(geometry['right']['x'] + geometry['right']['w'] <= geometry['width'] + 1,
                        f'right pane exceeds viewport: {geometry}')
                report[f'window{width}'] = geometry
                driver.screenshot(reports / f'listening-layout-{width}.png')
            (reports / 'listening-layout-live.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    main(parser.parse_args().binary.resolve())
