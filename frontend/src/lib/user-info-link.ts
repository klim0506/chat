export function buildUserInfoHref(user?: { id?: string | null; username?: string | null } | null): string {
  if (!user?.id && !user?.username) return "/chats";
  const params = new URLSearchParams();
  if (user.username) {
    params.set("write", user.username);
  } else if (user.id) {
    params.set("write_id", user.id);
  }
  params.set("profile", "1");
  return `/chats?${params.toString()}`;
}
