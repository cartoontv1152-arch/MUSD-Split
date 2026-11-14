import type { MetadataRoute } from "next";

/** Public pages only: the app pages need a connected wallet, so crawlers would only see the sign-in prompt. */
const PUBLIC_PATHS = ["", "/about", "/stats", "/help", "/legal"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";
  return PUBLIC_PATHS.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
