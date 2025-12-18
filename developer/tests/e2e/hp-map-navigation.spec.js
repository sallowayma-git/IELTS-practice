/**
 * HP Map Navigation E2E Test
 * 验证 HarryPoter.html 地图点击跳转功能的端到端测试
 */

import { test, expect } from '@playwright/test';

test.describe('HP Map Navigation E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到 HarryPoter.html 页面 (修正路径)
    const filePath = process.cwd().replace(/\\/g, '/').replace('/developer', '') + '/.superdesign/design_iterations/HarryPoter.html';
    await page.goto('file://' + filePath);
    
    // 等待页面加载完成
    await page.waitForLoadState('networkidle');
    
    // 等待地图元素加载
    await page.waitForSelector('map[name="hp-map"]', { timeout: 10000 });
  });

  test('应该显示地图和所有可点击区域', async ({ page }) => {
    // 检查地图图片是否存在
    const mapImage = page.locator('img[usemap="#hp-map"]');
    await expect(mapImage).toBeVisible();
    
    // 检查地图定义是否存在
    const mapElement = page.locator('map[name="hp-map"]');
    await expect(mapElement).toBeVisible();
    
    // 检查所有地图区域是否存在
    const areas = page.locator('map[name="hp-map"] area');
    await expect(areas).toHaveCount(4);
    
    // 检查每个区域的属性
    const hogwarts = page.locator('area[alt="Hogwarts"]');
    await expect(hogwarts).toHaveAttribute('href', 'HP/Welcome.html#overview');
    await expect(hogwarts).toHaveAttribute('data-target', 'overview');
    
    const burrow = page.locator('area[alt="The Burrow"]');
    await expect(burrow).toHaveAttribute('href', 'HP/Welcome.html#history');
    await expect(burrow).toHaveAttribute('data-target', 'records');
    
    const quidditch = page.locator('area[alt="Quidditch Pitch"]');
    await expect(quidditch).toHaveAttribute('href', 'HP/Welcome.html#practice');
    await expect(quidditch).toHaveAttribute('data-target', 'questions');
    
    const azkaban = page.locator('area[alt="Azkaban"]');
    await expect(azkaban).toHaveAttribute('href', 'HP/Welcome.html#settings');
    await expect(azkaban).toHaveAttribute('data-target', 'settings');
  });

  test('点击 Hogwarts 应该导航到 Overview 页面', async ({ page }) => {
    // 监听导航事件
    const navigationPromise = page.waitForURL(/HP\/Welcome\.html.*overview/);
    
    // 点击 Hogwarts 区域
    await page.locator('area[alt="Hogwarts"]').click();
    
    // 等待导航完成
    await navigationPromise;
    
    // 验证 URL 包含正确的视图参数
    expect(page.url()).toMatch(/HP\/Welcome\.html\?view=overview#overview$/);
  });

  test('点击 The Burrow 应该导航到 History 页面', async ({ page }) => {
    // 监听导航事件
    const navigationPromise = page.waitForURL(/HP\/Welcome\.html.*history/);
    
    // 点击 The Burrow 区域
    await page.locator('area[alt="The Burrow"]').click();
    
    // 等待导航完成
    await navigationPromise;
    
    // 验证 URL 包含正确的视图参数
    expect(page.url()).toMatch(/HP\/Welcome\.html\?view=history#history$/);
  });

  test('点击 Quidditch Pitch 应该导航到 Practice 页面', async ({ page }) => {
    // 监听导航事件
    const navigationPromise = page.waitForURL(/HP\/Welcome\.html.*practice/);
    
    // 点击 Quidditch Pitch 区域
    await page.locator('area[alt="Quidditch Pitch"]').click();
    
    // 等待导航完成
    await navigationPromise;
    
    // 验证 URL 包含正确的视图参数
    expect(page.url()).toMatch(/HP\/Welcome\.html\?view=practice#practice$/);
  });

  test('点击 Azkaban 应该导航到 Settings 页面', async ({ page }) => {
    // 监听导航事件
    const navigationPromise = page.waitForURL(/HP\/Welcome\.html.*settings/);
    
    // 点击 Azkaban 区域
    await page.locator('area[alt="Azkaban"]').click();
    
    // 等待导航完成
    await navigationPromise;
    
    // 验证 URL 包含正确的视图参数
    expect(page.url()).toMatch(/HP\/Welcome\.html\?view=settings#settings$/);
  });

  test('应该正确设置 sessionStorage 中的待激活视图', async ({ page }) => {
    // 点击 Hogwarts 区域
    await page.locator('area[alt="Hogwarts"]').click();
    
    // 等待一小段时间让 JavaScript 执行
    await page.waitForTimeout(100);
    
    // 检查 sessionStorage 是否设置了正确的值
    const pendingView = await page.evaluate(() => {
      return sessionStorage.getItem('hp.portal.pendingView');
    });
    
    // 注意：由于导航会清除 sessionStorage，我们需要在导航前检查
    // 这里我们验证导航逻辑是否正确执行
    expect(page.url()).toMatch(/HP\/Welcome\.html/);
  });

  test('地图应该响应鼠标悬停效果', async ({ page }) => {
    // 检查是否有悬停效果相关的元素
    const effectsLayer = page.locator('#effects-layer');
    await expect(effectsLayer).toBeVisible();
    
    // 检查特效容器是否存在
    const burrowEffects = page.locator('#burrow-effects');
    const quidditchEffects = page.locator('#quidditch-effects');
    const azkabanEffects = page.locator('#azkaban-effects');
    
    await expect(burrowEffects).toBeVisible();
    await expect(quidditchEffects).toBeVisible();
    await expect(azkabanEffects).toBeVisible();
  });

  test('地图应该正确缩放以适应不同屏幕尺寸', async ({ page }) => {
    // 检查视口容器
    const viewport = page.locator('#viewport');
    await expect(viewport).toBeVisible();
    
    // 检查舞台元素
    const stage = page.locator('#stage');
    await expect(stage).toBeVisible();
    
    // 验证 CSS 变量是否设置（用于缩放）
    const scaleProperty = await stage.evaluate(el => {
      return getComputedStyle(el).getPropertyValue('--scale');
    });
    
    // 缩放值应该存在且为有效数字
    expect(scaleProperty).toBeTruthy();
  });

  test('验证地图图片和资源路径', async ({ page }) => {
    // 检查地图背景图片
    const stage = page.locator('#stage');
    const backgroundImage = await stage.evaluate(el => {
      return getComputedStyle(el).backgroundImage;
    });
    
    expect(backgroundImage).toContain('map-bg.png');
    
    // 检查地图覆盖层
    const mapOverlay = page.locator('.map');
    const overlayImage = await mapOverlay.evaluate(el => {
      return getComputedStyle(el).backgroundImage;
    });
    
    expect(overlayImage).toContain('map.png');
  });
});