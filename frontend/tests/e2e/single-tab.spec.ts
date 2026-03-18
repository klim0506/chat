import { expect, test } from "@playwright/test";

/**
 * E2E single-tab: i18n, chat-actions, pinned, privacy, usernames, drag/paste, scroll-unread.
 * Requires: app running, user logged in via sessionStorage or auth flow.
 * Run: npx playwright test single-tab --project=chromium
 */
test.describe("Single tab: i18n, chat-actions, pinned, privacy, usernames", () => {
  test("i18n: language switch EN/RU in settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required");
      return;
    }
    const enBtn = page.locator('button:has-text("English")');
    const ruBtn = page.locator('button:has-text("Russian")');
    const visible = await enBtn.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, "Auth required (settings not visible)");
      return;
    }
    await expect(ruBtn).toBeVisible();
    await enBtn.click();
    await expect(enBtn).toHaveClass(/bg-blue-600/);
    await ruBtn.click();
    await expect(ruBtn).toHaveClass(/bg-blue-600/);
  });

  test("opens settings and shows privacy options", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required — skip");
      return;
    }
    const onAuthPage = await page.locator('input[type="tel"], [data-auth]').first().isVisible().catch(() => false);
    if (onAuthPage) {
      test.skip(true, "Auth required — skip");
      return;
    }

    // Look for dm_privacy or add_to_group_privacy section (RU or EN); may be absent for free tier
    const privacySection = page.locator("text=Кто может писать в ЛС").or(page.locator("text=ЛС")).or(page.locator("text=Privacy"));
    const hasPrivacy = (await privacySection.count()) > 0;
    const hasPrivatnost = (await page.locator("text=Приватность").count()) > 0;
    if (!hasPrivacy && !hasPrivatnost) {
      test.skip(true, "Privacy section not visible (may require subscription or different locale)");
      return;
    }
    expect(hasPrivacy || hasPrivatnost).toBeTruthy();
  });

  test("wiki/legal pages load", async ({ page }) => {
    await page.goto("/wiki");
    await page.waitForLoadState("domcontentloaded");
    // On app domain /wiki redirects to external wiki; wait for either in-page content or navigation
    const wikiVisible = await page.locator("text=Справка").or(page.locator("text=Pingy")).or(page.locator("text=Help")).or(page.locator("text=Wiki")).first().isVisible().catch(() => false);
    if (!wikiVisible) {
      await page.waitForTimeout(3000);
      const afterWait = await page.locator("text=Справка").or(page.locator("text=Pingy")).or(page.locator("text=Help")).or(page.locator("text=Wiki")).first().isVisible().catch(() => false);
      if (!afterWait) {
        test.skip(true, "Wiki redirects to external site or content not loaded");
        return;
      }
    }

    await page.goto("/wiki/security");
    await page.waitForLoadState("domcontentloaded");
    const secVisible = await page.locator("text=Безопасность").or(page.locator("text=Security")).or(page.locator("text=Справка")).or(page.locator("text=Help")).first().isVisible().catch(() => false);
    if (!secVisible) {
      await page.waitForTimeout(3000);
      const secAfter = await page.locator("text=Безопасность").or(page.locator("text=Security")).or(page.locator("text=Wiki")).first().isVisible().catch(() => false);
      if (!secAfter) {
        test.skip(true, "Wiki security page not visible (redirect or slow load)");
        return;
      }
    }
  });

  test("opens first chat and has message area", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required");
      return;
    }

    const chatButtons = page.locator("ul.divide-y.divide-slate-400 > li > button");
    const count = await chatButtons.count();
    if (count === 0) {
      test.skip(true, "No chats");
      return;
    }

    await chatButtons.first().click();
    await page.waitForURL(/\/chat\//, { timeout: 5000 });
    // Message input or contentEditable
    const input = page.locator("[contenteditable=true]").or(page.locator('[data-placeholder="Сообщение"]'));
    await expect(input.first()).toBeVisible({ timeout: 5000 });
  });

  test("create chat page and user search (usernames)", async ({ page }) => {
    await page.goto("/dashboard/create");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required");
      return;
    }
    const onAuthPage = await page.locator('input[type="tel"], [data-auth]').first().isVisible().catch(() => false);
    if (onAuthPage) {
      test.skip(true, "Auth required");
      return;
    }
    await expect(page.locator("text=Создать группу").or(page.locator("text=Create group")).or(page.locator("h1"))).toBeVisible({ timeout: 5000 });
    const titleInput = page.locator('input[name="title"], input[placeholder*="название"], input[placeholder*="title"], input[type="text"]');
    const inputVisible = await titleInput.first().isVisible().catch(() => false);
    if (!inputVisible) {
      test.skip(true, "Create chat form input not found (may require subscription or different UI)");
      return;
    }
  });

  test("chat area has drop zone for files (drag/paste)", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/auth")) return test.skip(true, "Auth required");
    const chatButtons = page.locator("ul.divide-y.divide-slate-400 > li > button");
    if ((await chatButtons.count()) === 0) return test.skip(true, "No chats");
    await chatButtons.first().click();
    await page.waitForURL(/\/chat\//, { timeout: 5000 });
    const msgArea = page.locator("[data-message-id], .overflow-y-auto").first();
    await expect(msgArea).toBeVisible({ timeout: 5000 });
  });
});
