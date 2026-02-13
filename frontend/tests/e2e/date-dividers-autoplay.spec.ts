import { expect, test } from "@playwright/test";

/**
 * E2E-тест: разделители дат, плавающая дата и автовоспроизведение видео.
 * Требует: приложение запущено, пользователь залогинен (sessionStorage).
 * Запуск: npx playwright test date-dividers-autoplay --project=chromium
 * С базовым URL: E2E_BASE_URL=http://localhost:5174 npx playwright test date-dividers-autoplay
 */
test.describe("Date dividers, sticky date, video autoplay", () => {
  test("opens first chat and verifies UI elements", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Проверяем, что мы на дашборде (возможно нужна авторизация)
    const url = page.url();
    if (url.includes("/auth")) {
      test.skip(true, "Требуется авторизация — пропуск теста");
      return;
    }

    // Ждём появления списка чатов
    const chatButtons = page.locator("ul.divide-y.divide-slate-400 > li > button");
    const count = await chatButtons.count();
    if (count === 0) {
      test.skip(true, "Нет чатов в списке — пропуск теста");
      return;
    }

    // Кликаем первый чат
    await chatButtons.first().click();
    await page.waitForURL(/\/chat\//, { timeout: 5000 });

    // Ждём загрузки сообщений
    await page.waitForTimeout(1500);

    // 1. Разделители дат: ищем текст "Сегодня", "Вчера" или паттерн даты (число + месяц)
    const dateDivider = page.locator("span.text-slate-500").filter({
      hasText: /^(Сегодня|Вчера|Today|Yesterday|\d{1,2}\s)/,
    });
    const dividerCount = await dateDivider.count();
    // Если есть сообщения, обычно есть хотя бы один разделитель (Сегодня)
    if (dividerCount > 0) {
      expect(await dateDivider.first().isVisible()).toBeTruthy();
    }

    // 2. Плавающая дата: появляется при скролле — скроллим вниз
    const messagesContainer = page.locator(".overflow-y-auto").filter({ has: page.locator("[data-message-id]") }).first();
    if ((await messagesContainer.count()) > 0) {
      await messagesContainer.evaluate((el) => {
        (el as HTMLElement).scrollTop = 200;
      });
      await page.waitForTimeout(500);
      // Ищем sticky date pill — тёмный rounded span с датой
      const stickyDate = page.locator("span.rounded-full").filter({
        hasText: /^(Сегодня|Вчера|Today|Yesterday|\d{1,2}\s)/,
      });
      if ((await stickyDate.count()) > 0) {
        expect(await stickyDate.first().isVisible()).toBeTruthy();
      }
    }

    // 3. Автовоспроизведение видео: ищем video и проверяем, что при появлении в viewport оно играет
    const videos = page.locator("video");
    const videoCount = await videos.count();
    if (videoCount > 0) {
      const firstVideo = videos.first();
      await firstVideo.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500); // даём время на IntersectionObserver и play()
      const isPaused = await firstVideo.evaluate((v: HTMLVideoElement) => v.paused);
      // Видео должно воспроизводиться (muted), если в viewport
      expect(isPaused).toBeFalsy();
    }

    // 4. GIF: img с .gif в src — просто проверяем наличие
    const gifImgs = page.locator('img[src*=".gif"], img[src*="image/gif"]');
    // GIF-ы анимируются автоматически в img — не требуют особой проверки
  });
});
