import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — chat.jdump",
};

export default function PrivacyPage() {
  return (
    <main className="legal">
      <p className="legal-kicker">
        <a href="/">chat.jdump</a>
      </p>
      <h1>Privacy policy</h1>
      <p>Last updated 9 September 2026. This is a small personal chat, not a company product.</p>

      <h2>What we store</h2>
      <ul>
        <li>Messages you send in the guest room (plaintext on the operator&apos;s VPS).</li>
        <li>A generated guest name in your browser (`localStorage`).</li>
        <li>Your IP, used only to enforce send limits.</li>
        <li>
          If you sign in with GitHub or Google: name, email, and provider account id, plus a session
          cookie on `.jdump.com`.
        </li>
      </ul>

      <h2>How long</h2>
      <p>
        Guest-room messages are deleted after about 24 hours. Session cookies last until you{" "}
        <code>/logout</code> or they expire. Account rows stay until the operator deletes them.
      </p>

      <h2>Who sees it</h2>
      <p>
        The guest room is public. We do not sell data. GitHub or Google see that you signed in when
        you use them. The site is served by Cloudflare; the API runs on a private VPS through a
        Cloudflare Tunnel.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:jeshua@jeshuagalao.dev">jeshua@jeshuagalao.dev</a>
        {" · "}
        <a href="/terms">Terms of service</a>
      </p>
    </main>
  );
}
