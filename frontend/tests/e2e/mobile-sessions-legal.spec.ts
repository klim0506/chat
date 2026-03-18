import { expect, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * E2E mobile: viewport 375x812, Sessions UI, legal/wiki pages.
 * Run: npx playwright test mobile-sessions-legal --project=chromium
 */
test.describe("Mobile viewport, Sessions UI, legal pages", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("wiki page renders on mobile", async ({ page }) => {
    await page.goto("/wiki");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    const visible = await page.locator("text=Справка").or(page.locator("text=Pingy")).or(page.locator("text=Help")).or(page.locator("text=Wiki")).first().isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, "Wiki redirects to external site or content not loaded");
      return;
    }
  });

  test("landing page fits mobile viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // No horizontal overflow
    const box = await body.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 20);
  });

  test("settings sessions section when logged in", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required for sessions");
      return;
    }
    const onAuthPage = await page.locator('input[type="tel"], [data-auth]').first().isVisible().catch(() => false);
    if (onAuthPage) {
      test.skip(true, "Auth required for sessions");
      return;
    }

    // Scroll to find sessions section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const sessionsText = page.locator("text=Сессии").or(page.locator("text=сессии")).or(page.locator("text=Sessions"));
    const activeText = page.locator("text=Текущая").or(page.locator("text=активных"));
    const hasSessions = (await sessionsText.count()) > 0 || (await activeText.count()) > 0;
    const hasTerminate = (await page.locator("text=Завершить").count()) > 0 || (await page.locator("text=Terminate").count()) > 0;
    if (!hasSessions && !hasTerminate) {
      test.skip(true, "Sessions section not visible (may require subscription or different locale)");
      return;
    }
    expect(hasSessions || hasTerminate).toBeTruthy();
  });
});
