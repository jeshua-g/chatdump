import { join } from "node:path";
import { betterAuth } from "better-auth";
import { openDb } from "./db.ts";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

const authUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const trustedOrigins = (
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??
  process.env.CORS_ORIGIN ??
  "https://chat.jdump.com,http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const github =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      }
    : undefined;

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account" as const,
      }
    : undefined;

export function isOwner(user: { id: string; email?: string | null }) {
  const id = process.env.OWNER_ID;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return (Boolean(id) && user.id === id) || (Boolean(email) && user.email?.toLowerCase() === email);
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: authUrl,
  trustedOrigins,
  database: openDb(DATA_DIR).sqlite,
  socialProviders: {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
  },
  advanced: {
    useSecureCookies: authUrl.startsWith("https://"),
    crossSubDomainCookies: authUrl.includes("jdump.com")
      ? { enabled: true, domain: "jdump.com" }
      : undefined,
  },
});
