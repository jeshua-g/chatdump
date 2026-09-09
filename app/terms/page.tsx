import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms — chat.jdump",
};

export default function TermsPage() {
  return (
    <main className="legal">
      <p className="legal-kicker">
        <Link href="/">chat.jdump</Link>
      </p>
      <h1>Terms of service</h1>
      <p>Last updated 9 September 2026. By using chat.jdump you agree to this.</p>

      <h2>The service</h2>
      <p>
        chat.jdump is a personal guest chat at <a href="https://chat.jdump.com">chat.jdump.com</a>.
        It is provided as-is, with no uptime promise. The VPS can be offline while the site still
        loads.
      </p>

      <h2>Rules</h2>
      <ul>
        <li>Do not spam, attack, or break the law.</li>
        <li>The guest room is public and plaintext. Do not post secrets.</li>
        <li>We may delete messages or block access at any time.</li>
      </ul>

      <h2>Accounts</h2>
      <p>
        Login via GitHub or Google is optional. You are responsible for that account. Guest use is
        limited per IP.
      </p>

      <h2>Liability</h2>
      <p>
        No warranty. The operator is not liable for lost messages, downtime, or anything you post.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:jeshua@jeshuagalao.dev">jeshua@jeshuagalao.dev</a>
        {" · "}
        <Link href="/privacy">Privacy policy</Link>
      </p>
    </main>
  );
}
