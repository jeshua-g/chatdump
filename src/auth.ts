import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

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

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: authUrl,
  trustedOrigins,
  database: new DatabaseSync(join(DATA_DIR, "chat.db")),
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
