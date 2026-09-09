import { createAuthClient } from "better-auth/react";

function apiBase() {
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:3000";
  return process.env.NEXT_PUBLIC_API_URL ?? "https://chat-api.jdump.com";
}

export const authClient = createAuthClient({
  baseURL: apiBase(),
  fetchOptions: { credentials: "include" },
});
