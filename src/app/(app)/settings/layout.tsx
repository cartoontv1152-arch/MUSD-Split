import type { Metadata } from "next";

export const metadata: Metadata = { title: "Profile & settings" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
