import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms & privacy" };

export default function LegalPage() {
  return (
    <article className="max-w-[72ch] space-y-8 text-[14.5px] leading-relaxed text-fg-muted">
      <header>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.025em] text-fg">Terms & privacy</h1>
        <p className="mt-2">Plain-language terms for the MUSD Split testnet build.</p>
      </header>
      <section>
        <h2 className="mb-2 font-display text-[20px] font-semibold text-fg">Terms of use</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>MUSD Split is experimental software provided as-is for testing on Mezo testnet. Don&apos;t use it with real funds.</li>
          <li>You are responsible for the transactions you approve in your wallet. Blockchain transfers can&apos;t be reversed.</li>
          <li>Group records are agreements between members. MUSD Split doesn&apos;t enforce, collect or guarantee any debt.</li>
          <li>Don&apos;t upload unlawful content or other people&apos;s personal data without permission.</li>
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-display text-[20px] font-semibold text-fg">Privacy</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            We store: your wallet address, the display name/username/picture you choose, groups you belong to, expenses, payment requests, notifications and the
            transaction hashes of your settlements.
          </li>
          <li>We never ask for, receive or store private keys or seed phrases.</li>
          <li>Group data, receipts and profile pictures are visible only to members of the groups you share. Files are stored in our database, not in public buckets.</li>
          <li>On-chain transactions are public by nature and visible on the Mezo explorer to anyone.</li>
          <li>We use a single HttpOnly session cookie to keep you signed in, and Vercel Web Analytics (cookieless, aggregate page views).</li>
        </ul>
      </section>
    </article>
  );
}
