// Isolated rendering fixture: no user storage or external services.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = new URL('../../../', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    await page.setContent(`<style>${fs.readFileSync(new URL('css/heroui-bridge.css', root), 'utf8')}
    * { box-sizing: border-box; }
    .hero-nav { border: 0; position: relative; display: flex; width: 400px; padding: 0; }
    .hero-nav__btn { height: 48px; flex: 1; border: 0; padding: 0; }
    </style><nav class="hero-nav"><button class="hero-nav__btn active">Overview</button><button class="hero-nav__btn">Practice</button></nav>`);
    await page.evaluate(() => {
        window.AppData = { ready: Promise.resolve(), preferences: { getConsent: async () => ({ hasSeenGplLicense: true }) } };
        window.__navGeometryReads = 0;
        const nav = document.querySelector('.hero-nav');
        const original = nav.getBoundingClientRect.bind(nav);
        nav.getBoundingClientRect = () => { window.__navGeometryReads++; return original(); };
        nav.addEventListener('click', event => {
            nav.querySelectorAll('button').forEach(button => button.classList.toggle('active', button === event.target));
        });
    });
    await page.addScriptTag({ content: fs.readFileSync(new URL('js/presentation/indexInteractions.js', root), 'utf8') });
    await page.waitForTimeout(100);
    const initialReads = await page.evaluate(() => window.__navGeometryReads);
    assert(initialReads <= 3, 'indicator must settle without observing its own readiness class repeatedly');
    await page.locator('button').nth(1).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const rect = await page.evaluate(() => {
        const indicator = document.querySelector('.hero-nav__liquid-indicator');
        const button = document.querySelector('.hero-nav__btn.active');
        const a = indicator.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        return { dx: a.left - b.left, dy: a.top - b.top,
            width: a.width, buttonWidth: b.width,
            transition: getComputedStyle(indicator).transitionProperty,
            reads: window.__navGeometryReads };
    });
    assert(Math.abs(rect.dx - 3) < 1 && Math.abs(rect.dy - 3) < 1);
    assert(Math.abs(rect.width - (rect.buttonWidth - 6)) < 1);
    assert.equal(rect.transition, 'transform, opacity');
    assert(rect.reads <= initialReads + 2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('button').nth(0).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    assert.equal(await page.locator('.hero-nav__liquid-indicator').evaluate(node => getComputedStyle(node).transitionProperty), 'none');
    await page.addScriptTag({ content: fs.readFileSync(new URL('js/presentation/emojiIconizer.js', root), 'utf8') });
    await page.evaluate(() => {
        const root = document.createElement('section');
        root.id = 'emoji-fixture';
        root.innerHTML = '<span>📚 Book</span><code>📚 Code</code><div contenteditable="true">📚 Editor</div><svg><text>📚 SVG</text></svg>';
        document.body.appendChild(root);
        root.querySelector('span').append(document.createTextNode(' 📊 Chart'));
    });
    await page.waitForFunction(() => document.querySelectorAll('#emoji-fixture .ui-emoji-icon').length === 2);
    assert.equal(await page.locator('#emoji-fixture code').textContent(), '📚 Code');
    assert.equal(await page.locator('#emoji-fixture [contenteditable]').textContent(), '📚 Editor');
    assert.equal(await page.locator('#emoji-fixture svg text').textContent(), '📚 SVG');
    console.log(JSON.stringify({ status: 'pass', keyboardIndicatorGeometry: rect, emojiIcons: 2 }));
} finally {
    await browser.close();
}
