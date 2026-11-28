"""Existing official records, native review, Coach and restart with an Atlas login."""
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


def main(binary, ask_coach):
    reports = ROOT / 'developer/tests/e2e/reports'
    cases = json.loads((reports / 'jiufen-material-live.json').read_text(encoding='utf-8'))
    report = {}
    staged, runtime, _ = stage_test_runtime(binary)
    with staged, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as webview, tempfile.TemporaryFile(mode='w+') as log:
        ports = pick_ports(None)
        driver = Driver(f'http://127.0.0.1:{ports[0]}')
        proc = start_tauri_driver(driver, shutil.which('tauri-driver'), str(select_native_driver().path), ports,
                                  {**os.environ, 'WEBVIEW2_USER_DATA_FOLDER': webview}, log)
        try:
            for restart in (False, True):
                driver.create(str(runtime))
                wait_for_vue(driver)
                driver.call('POST', f'/session/{driver.sid}/timeouts', {'script': 120000})
                require(invoke(driver, 'jiufen_restore'), 'Atlas session unavailable')
                for activity in ('reading', 'listening'):
                    case = cases[activity]
                    driver.script('location.hash=arguments[0]', [f'#/{activity}/{case["assetId"]}/review/{case["attemptId"]}'])
                    wait_for_value(driver, "return Boolean(document.querySelector('[data-locate-answer=q1]'))", 90,
                                   label=f'{activity} remote review after restart={restart}')
                    review = invoke(driver, 'jiufen_review', {'assetId': case['assetId'], 'attemptId': case['attemptId']})
                    require(len(review['answerKey']) == (13 if activity == 'reading' else 10), 'missing answer key')
                    material = invoke(driver, 'jiufen_study_material', {'assetId': case['assetId'], 'channel': activity,
                                                                       'attemptId': case['attemptId']})
                    require(len(material['questions']) == len(review['answerKey']), 'missing analysis material')
                    report.setdefault(activity, {})['restart' if restart else 'review'] = 'passed'
                    if ask_coach and not restart:
                        wait_for_value(driver, "return Boolean(document.querySelector('[data-reading-coach-fab]'))", 15)
                        driver.script("document.querySelector('[data-reading-coach-fab]').click()")
                        query = ('请只根据本次官方复盘，说明第1题与第13题的标准答案、我的作答及解析依据，200字以内。'
                                 if activity == 'reading' else '请根据官方解析说明第31题的标准答案和我的作答，引用对应原文及音频时间，150字以内。')
                        before = driver.script("return document.querySelectorAll('[data-reading-coach-message=assistant]').length")
                        driver.script("const e=document.querySelector('#reading-coach-input'); e.value=arguments[0]; e.dispatchEvent(new Event('input',{bubbles:true}))", [query])
                        wait_for_value(driver, "return !document.querySelector('#reading-coach-send').disabled", 10)
                        driver.script("document.querySelector('#reading-coach-send').click()")
                        answer = wait_for_value(driver, """
                            const status=document.querySelector('#reading-coach-status');
                            if (status?.classList.contains('is-error')) return {error:document.querySelector('[data-reading-coach-message].error')?.textContent || status.textContent};
                            const messages=[...document.querySelectorAll('[data-reading-coach-message=assistant]')];
                            return messages.length>arguments[0] && !status?.classList.contains('is-loading')
                                ? {answer:messages.at(-1).innerText} : null;
                        """, 150, args=[before], label=f'{activity} Coach response')
                        if 'error' in answer:
                            require('API Key' in answer['error'], str(answer))
                            report[activity]['coachGeneration'] = 'blocked by missing local API Key'
                        else:
                            require(len(answer['answer']) > 20, 'empty Coach response')
                            report[activity]['coachAnswer'] = answer['answer']
                        driver.screenshot(reports / f'jiufen-{activity}-coach.png')
                        driver.script("document.querySelector('#reading-coach-close').click()")
                        require(not driver.script("return document.querySelector('#reading-coach-panel').classList.contains('is-open')"), 'Coach panel failed to close')
                    if activity == 'listening':
                        wait_for_value(driver, "return document.querySelector('audio')?.readyState >= 1", 60)
                        driver.script("document.querySelector('audio').muted=true; document.querySelector('[data-play-sentence]').click()")
                        wait_for_value(driver, "return !document.querySelector('audio').paused", 10)
                        driver.script("document.querySelector('audio').pause()")
                        report[activity]['audio'] = 'passed'
                driver.close()
                driver.sid = None
            (reports / 'jiufen-localization-flow.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=True))
        finally:
            driver.close()
            stop_process(proc)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--ask-coach', action='store_true')
    args = parser.parse_args()
    main(args.binary.resolve(), args.ask_coach)
