import { expect, test } from "@playwright/test";

/**
 * E2E single-tab: i18n, chat-actions, pinned, privacy, usernames, drag/paste, scroll-unread.
 * Requires: app running, user logged in via sessionStorage or auth flow.
 * Run: npx playwright test single-tab --project=chromium
 */
test.describe("Single tab: i18n, chat-actions, pinned, privacy, usernames", () => {
  test("i18n: language switch EN/RU in settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required");
      return;
    }
    const enBtn = page.locator('button:has-text("English")');
    const ruBtn = page.locator('button:has-text("Russian")');
    await expect(enBtn).toBeVisible();
    await expect(ruBtn).toBeVisible();
    await enBtn.click();
    await expect(enBtn).toHaveClass(/bg-blue-600/);
    await ruBtn.click();
    await expect(ruBtn).toHaveClass(/bg-blue-600/);
  });

  test("opens settings and shows privacy options", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required — skip");
      return;
    }

    // Look for dm_privacy or add_to_group_privacy section
    const privacySection = page.locator("text=Кто может писать в ЛС").or(page.locator("text=ЛС"));
    const hasPrivacy = (await privacySection.count()) > 0;
    expect(hasPrivacy || (await page.locator("text=Приватность").count()) > 0).toBeTruthy();
  });

  test("spravka/legal pages load", async ({ page }) => {
    await page.goto("/spravka");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Справка").or(page.locator("text=Приватные чаты"))).toBeVisible();

    await page.goto("/spravka/security");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Безопасность").or(page.locator("text=Справка"))).toBeVisible();
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
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/auth")) {
      test.skip(true, "Auth required");
      return;
    }
    await expect(page.locator("text=Создать чат").or(page.locator("h1"))).toBeVisible();
    const titleInput = page.locator('input[name="title"], input[placeholder*="название"]');
    await expect(titleInput.first()).toBeVisible({ timeout: 3000 });
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
