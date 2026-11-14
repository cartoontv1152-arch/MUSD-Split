/**
 * Team shown on /about. Fill in real people only — the section is hidden while this is empty.
 * links: e.g. { label: "GitHub", href: "https://github.com/…" }
 */
export interface TeamMember {
  name: string;
  role: string;
  bio?: string;
  links?: Array<{ label: string; href: string }>;
}

export const TEAM: TeamMember[] = [];

/** Public contact for judges / partners (optional). */
export const CONTACT: { label: string; href: string } | null = null;
