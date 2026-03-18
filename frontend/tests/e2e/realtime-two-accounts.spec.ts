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
  await api.post(`${API_BASE}/auth/send-code/`, { data: { phone } });
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

async function authApiGet<T>(api: APIRequestContext, token: string, path: string): Promise<T> {
  const res = await api.get(`${API_BASE}${path}`, {
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
  test("reactions and read status work between two users", async ({ browser, request }) => {
    requireEnv();
    const a = await loginByCode(request, USER_1_PHONE!, USER_1_CODE);
    const b = await loginByCode(request, USER_2_PHONE!, USER_2_CODE);

    const nonce = Date.now();
    const dm = await authApiPost<ChatDto>(request, a.access, "/chats/dm/", { user_id: b.user.id });
    const msgRes = await authApiPost<{ id: string }>(request, a.access, `/chats/${dm.id}/messages/`, {
      msg_type: "text",
      content: `Reaction-${nonce}`,
    });
    const msgId = msgRes.id;

    // User B adds reaction (use allowed emoji from REACTION_EMOJIS)
    const emoji = "❤️";
    await authApiPost(request, b.access, `/chats/${dm.id}/messages/${msgId}/reactions/`, { emoji });
    const msgWithReaction = await authApiGet<{ reactions: Record<string, number> }>(
      request,
      a.access,
      `/chats/${dm.id}/messages/${msgId}/`
    );
    expect(msgWithReaction.reactions).toBeDefined();
    expect(msgWithReaction.reactions[emoji]).toBe(1);

    // User B marks chat as read
    await authApiPost(request, b.access, `/chats/${dm.id}/mark-read/`, {});
    const msgAfterRead = await authApiGet<{ read_status: string }>(
      request,
      a.access,
      `/chats/${dm.id}/messages/${msgId}/`
    );
    expect(msgAfterRead.read_status).toBe("read");
  });

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

  test("invite link: User B joins via browser navigation", async ({ browser, request }) => {
    requireEnv();
    const a = await loginByCode(request, USER_1_PHONE!, USER_1_CODE);
    const b = await loginByCode(request, USER_2_PHONE!, USER_2_CODE);

    const nonce = Date.now();
    const openChat = await authApiPost<ChatDto>(request, a.access, "/chats/", {
      title: `E2E-Invite-${nonce}`,
      chat_type: "open",
      description: "invite link test",
    });
    expect(openChat.invite_link).toBeTruthy();
    const invite = parseInvite(openChat.invite_link!);

    const ctxB = await browser.newContext();
    const pageB = await seedSession(ctxB, b);

    // User B navigates to invite URL (frontend path)
    const joinPath = `/chat/join/${encodeURIComponent(invite.slug)}?code=${encodeURIComponent(invite.code)}`;
    await pageB.goto(joinPath);
    await pageB.waitForLoadState("networkidle");

    // JoinChatPage auto-joins; expect success message
    await expect(
      pageB.locator("text=Вы вступили в чат").or(pageB.locator("text=Вы уже в чате"))
    ).toBeVisible({ timeout: 8000 });

    // Redirect to chat
    await expect(pageB).toHaveURL(new RegExp(`/chat/${openChat.id}`), { timeout: 5000 });

    // Chat page loaded (message area or chat header)
    const inChat = pageB.locator("[contenteditable=true]").or(pageB.locator("[data-message-id]"));
    await expect(inChat.first()).toBeVisible({ timeout: 5000 });

    await ctxB.close();
  });

  test("invite link without slug/code shows help", async ({ page }) => {
    await page.goto("/chat/join");
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/auth")) {
      test.skip(true, "Join page requires auth and redirects to /auth");
      return;
    }
    await expect(
      page.locator("text=пригласительной ссылке").or(page.locator("text=Вступление в чат")).or(page.locator("text=invite")).or(page.locator("text=Join"))
    ).toBeVisible({ timeout: 10000 });
  });

  test("Unread folder shows only chats with unread messages", async ({ browser, request }) => {
    requireEnv();
    const a = await loginByCode(request, USER_1_PHONE!, USER_1_CODE);
    const b = await loginByCode(request, USER_2_PHONE!, USER_2_CODE);

    const nonce = Date.now();
    const dm = await authApiPost<ChatDto>(request, a.access, "/chats/dm/", { user_id: b.user.id });
    await authApiPost<{ id: string }>(request, a.access, `/chats/${dm.id}/messages/`, {
      msg_type: "text",
      content: `Unread-test-${nonce}`,
    });

    const ctxB = await browser.newContext();
    const pageB = await seedSession(ctxB, b);
    await pageB.goto("/chats");
    await pageB.waitForLoadState("networkidle");

    // Tabs: Чаты | Непрочитанное (Архив appears only when user has archived chats)
    await expect(pageB.locator("button").filter({ hasText: "Чаты" })).toBeVisible();
    await expect(pageB.locator("button").filter({ hasText: "Непрочитанное" })).toBeVisible();

    // In "Чаты" tab: DM chat visible with unread badge
    const chatRow = pageB.locator("ul.divide-y.divide-slate-400 > li > button").filter({
      has: pageB.locator("span").filter({ hasText: /^[1-9]\d*$/ }),
    });
    await expect(chatRow.first()).toBeVisible();

    // Switch to "Непрочитанное" tab
    await pageB.locator("button").filter({ hasText: "Непрочитанное" }).click();
    await pageB.waitForLoadState("networkidle");

    // Chat with unread must appear in Unread tab
    const unreadRow = pageB.locator("ul.divide-y.divide-slate-400 > li > button").filter({
      has: pageB.locator("span").filter({ hasText: /^[1-9]\d*$/ }),
    });
    await expect(unreadRow.first()).toBeVisible();

    // Open chat (marks as read)
    await unreadRow.first().click();
    await expect(pageB).toHaveURL(new RegExp(`/chat/${dm.id}`));
    await pageB.waitForTimeout(500);

    // Go back to chat list
    await pageB.goto("/chats");
    await pageB.waitForLoadState("networkidle");

    // Switch to "Непрочитанное" tab - should be empty or show empty message
    await pageB.locator("button").filter({ hasText: "Непрочитанное" }).click();
    await pageB.waitForLoadState("networkidle");

    const unreadEmpty = pageB.locator("p").filter({ hasText: /Нет чатов с непрочитанными|No unread chats/i });
    await expect(unreadEmpty).toBeVisible();

    // Switch to "Чаты" tab - chat still visible (read)
    await pageB.locator("button").filter({ hasText: "Чаты" }).click();
    await pageB.waitForLoadState("networkidle");

    const allChats = pageB.locator("ul.divide-y.divide-slate-400 > li > button");
    await expect(allChats.first()).toBeVisible();

    await ctxB.close();
  });

  test("invite link redirects unauthenticated user to auth", async ({ browser, request }) => {
    requireEnv();
    const a = await loginByCode(request, USER_1_PHONE!, USER_1_CODE);
    const nonce = Date.now();
    const openChat = await authApiPost<ChatDto>(request, a.access, "/chats/", {
      title: `E2E-Invite-Auth-${nonce}`,
      chat_type: "open",
      description: "invite auth redirect",
    });
    const invite = parseInvite(openChat.invite_link!);

    // Fresh context, no session
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/chat/join/${encodeURIComponent(invite.slug)}?code=${encodeURIComponent(invite.code)}`);
    await page.waitForLoadState("networkidle");

    // Should redirect to auth with next param
    await expect(page).toHaveURL(/\/auth/);
    expect(page.url()).toContain("next=");

    await ctx.close();
  });
});

