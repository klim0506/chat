import { expect, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * E2E mobile: viewport 375x812, Sessions UI, legal/spravka pages.
 * Run: npx playwright test mobile-sessions-legal --project=chromium
 */
test.describe("Mobile viewport, Sessions UI, legal pages", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("spravka page renders on mobile", async ({ page }) => {
    await page.goto("/spravka");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Справка").or(page.locator("text=Pingy"))).toBeVisible();
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
    await page.waitForLoadState("networkidle");

    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required for sessions");
      return;
    }

    // Scroll to find sessions section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const sessionsText = page.locator("text=Сессии").or(page.locator("text=сессии"));
    const activeText = page.locator("text=Текущая").or(page.locator("text=активных"));
    const hasSessions = (await sessionsText.count()) > 0 || (await activeText.count()) > 0;
    expect(hasSessions || (await page.locator("text=Завершить").count()) > 0).toBeTruthy();
  });
});
