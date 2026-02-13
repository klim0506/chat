import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

type AuthUser = {
  id: string;
  phone: string;
  display_name: string;
  username?: string | null;
};

type AuthResult = {
  access: string;
  refresh: string;
  user: AuthUser;
};

type ChatDto = {
  id: string;
  title: string;
  invite_link: string | null;
};

const API_BASE = process.env.E2E_API_URL || "http://localhost:8000/api";
const USER_1_PHONE = process.env.E2E_USER_1_PHONE;
const USER_2_PHONE = process.env.E2E_USER_2_PHONE;
const USER_1_CODE = process.env.E2E_USER_1_CODE || "123456";
const USER_2_CODE = process.env.E2E_USER_2_CODE || "123456";

function requireEnv(): void {
  test.skip(!USER_1_PHONE || !USER_2_PHONE, "Set E2E_USER_1_PHONE and E2E_USER_2_PHONE.");
}

async function loginByCode(api: APIRequestContext, phone: string, code: string): Promise<AuthResult> {
  await api.post(`${API_BASE}/auth/send-code/`, { data: { phone, method: "sms" } });
  const verify = await api.post(`${API_BASE}/auth/verify-code/`, { data: { phone, code } });
  expect(verify.ok()).toBeTruthy();
  return (await verify.json()) as AuthResult;
}

async function authApiPost<T>(api: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const res = await api.post(`${API_BASE}${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as T;
}

async function seedSession(context: BrowserContext, auth: AuthResult): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/auth");
  await page.evaluate((payload) => {
    sessionStorage.setItem(
      "auth-storage",
      JSON.stringify({
        state: {
          accessToken: payload.access,
          refreshToken: payload.refresh,
          user: payload.user,
          isAuthenticated: true,
        },
        version: 0,
      })
    );
  }, auth);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

function parseInvite(link: string): { slug: string; code: string } {
  const url = new URL(link);
  const chunks = url.pathname.split("/").filter(Boolean);
  const slug = decodeURIComponent(chunks[chunks.length - 1] || "");
  const code = url.searchParams.get("code") || "";
  if (!slug || !code) throw new Error(`Invalid invite link format: ${link}`);
  return { slug, code };
}

async function topChatTitles(page: Page, count = 3): Promise<string[]> {
  const rows = page.locator("ul.divide-y.divide-slate-400 > li > button");
  const total = Math.min(await rows.count(), count);
  const result: string[] = [];
  for (let i = 0; i < total; i += 1) {
    result.push((await rows.nth(i).innerText()).trim());
  }
  return result;
}

test.describe("Real-time communication between two accounts", () => {
  test("new chat appears, unread badge updates, pinned order remains stable", async ({ browser, request }) => {
    requireEnv();
    const a = await loginByCode(request, USER_1_PHONE!, USER_1_CODE);
    const b = await loginByCode(request, USER_2_PHONE!, USER_2_CODE);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await seedSession(ctxA, a);
    const pageB = await seedSession(ctxB, b);

    const nonce = Date.now();
    const realtimeChat = await authApiPost<ChatDto>(request, a.access, "/chats/", {
      title: `E2E-RT-${nonce}`,
      chat_type: "open",
      description: "realtime",
    });
    expect(realtimeChat.invite_link).toBeTruthy();
    const invite = parseInvite(realtimeChat.invite_link!);

    await authApiPost<ChatDto>(request, b.access, "/chats/join/", invite);
    await authApiPost(request, a.access, `/chats/${realtimeChat.id}/messages/`, {
      msg_type: "text",
      content: `Ping-${nonce}`,
    });

    const realtimeRow = pageB.locator("ul.divide-y.divide-slate-400 > li > button").filter({
      hasText: realtimeChat.title,
    });
    await expect(realtimeRow).toBeVisible();
    await expect(realtimeRow.locator("span").filter({ hasText: /^[1-9]\d*$/ })).toBeVisible();

    const pinned1 = await authApiPost<ChatDto>(request, b.access, "/chats/", {
      title: `E2E-PIN-1-${nonce}`,
      chat_type: "open",
      description: "pin-1",
    });
    const pinned2 = await authApiPost<ChatDto>(request, b.access, "/chats/", {
      title: `E2E-PIN-2-${nonce}`,
      chat_type: "open",
      description: "pin-2",
    });

    await pageB.evaluate((ids) => {
      localStorage.setItem("pinned_chat_ids", JSON.stringify(ids));
    }, [pinned1.id, pinned2.id]);
    await pageB.reload();
    await expect(pageB.locator("ul.divide-y.divide-slate-400 > li > button").first()).toBeVisible();

    await authApiPost(request, a.access, `/chats/${realtimeChat.id}/messages/`, {
      msg_type: "text",
      content: `Ping-2-${nonce}`,
    });

    const topRows = await topChatTitles(pageB, 3);
    expect(topRows[0]).toContain(pinned1.title);
    expect(topRows[1]).toContain(pinned2.title);

    await ctxA.close();
    await ctxB.close();
  });
});

