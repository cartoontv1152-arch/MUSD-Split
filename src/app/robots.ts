import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";
  return { rules: [{ userAgent: "*", allow: ["/", "/help", "/legal"], disallow: ["/api/", "/join/", "/settlements/"] }], sitemap: `${base}/sitemap.xml` };
}
