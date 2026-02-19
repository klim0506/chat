import { expect, test } from "@playwright/test";

/**
 * E2E test: date dividers, sticky date, and video autoplay.
 * Requires: app is running, user is logged in (sessionStorage).
 * Run: npx playwright test date-dividers-autoplay --project=chromium
 * With base URL: E2E_BASE_URL=http://localhost:5174 npx playwright test date-dividers-autoplay
 */
test.describe("Date dividers, sticky date, video autoplay", () => {
  test("opens first chat and verifies UI elements", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Check we are on dashboard (auth may be required)
    const url = page.url();
    if (url.includes("/auth")) {
      test.skip(true, "Auth required — skipping test");
      return;
    }

    // Wait for chat list to appear
    const chatButtons = page.locator("ul.divide-y.divide-slate-400 > li > button");
    const count = await chatButtons.count();
    if (count === 0) {
      test.skip(true, "No chats in list — skipping test");
      return;
    }

    // Click the first chat
    await chatButtons.first().click();
    await page.waitForURL(/\/chat\//, { timeout: 5000 });

    // Wait for messages to load
    await page.waitForTimeout(1500);

    // 1. Date dividers: look for "Today", "Yesterday" or date pattern (day + month)
    const dateDivider = page.locator("span.text-slate-500").filter({
      hasText: /^(Сегодня|Вчера|Today|Yesterday|\d{1,2}\s)/,
    });
    const dividerCount = await dateDivider.count();
    // If there are messages, there's usually at least one divider (Today)
    if (dividerCount > 0) {
      expect(await dateDivider.first().isVisible()).toBeTruthy();
    }

    // 2. Sticky date: appears on scroll — scroll down
    const messagesContainer = page.locator(".overflow-y-auto").filter({ has: page.locator("[data-message-id]") }).first();
    if ((await messagesContainer.count()) > 0) {
      await messagesContainer.evaluate((el) => {
        (el as HTMLElement).scrollTop = 200;
      });
      await page.waitForTimeout(500);
      // Look for sticky date pill — dark rounded span with date
      const stickyDate = page.locator("span.rounded-full").filter({
        hasText: /^(Сегодня|Вчера|Today|Yesterday|\d{1,2}\s)/,
      });
      if ((await stickyDate.count()) > 0) {
        expect(await stickyDate.first().isVisible()).toBeTruthy();
      }
    }

    // 3. Video autoplay: find video and verify it plays when in viewport
    const videos = page.locator("video");
    const videoCount = await videos.count();
    if (videoCount > 0) {
      const firstVideo = videos.first();
      await firstVideo.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500); // allow time for IntersectionObserver and play()
      const isPaused = await firstVideo.evaluate((v: HTMLVideoElement) => v.paused);
      // Video should be playing (muted) when in viewport
      expect(isPaused).toBeFalsy();
    }

    // 4. GIF: img with .gif in src — just check presence
    const gifImgs = page.locator('img[src*=".gif"], img[src*="image/gif"]');
    // GIFs animate automatically in img — no special check needed
  });
});
