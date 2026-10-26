export const APP_NAME = "MUSD Split";
export const APP_TAGLINE = "Split shared costs. Settle them in MUSD on Mezo.";
export const APP_DESCRIPTION =
  "MUSD Split tracks group expenses, works out exactly who owes whom, and settles debts with real, verified MUSD transfers on the Mezo network.";

export const EXPENSE_CATEGORIES = [
  { id: "food", label: "Food & drink" },
  { id: "groceries", label: "Groceries" },
  { id: "rent", label: "Rent" },
  { id: "utilities", label: "Utilities" },
  { id: "internet", label: "Internet & phone" },
  { id: "transport", label: "Transport" },
  { id: "travel", label: "Travel & stay" },
  { id: "entertainment", label: "Entertainment" },
  { id: "shopping", label: "Shopping" },
  { id: "health", label: "Health" },
  { id: "gifts", label: "Gifts" },
  { id: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];
export const CATEGORY_IDS = EXPENSE_CATEGORIES.map((c) => c.id) as [ExpenseCategory, ...ExpenseCategory[]];
export const categoryLabel = (id: string) => EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? "Other";

export const GROUP_ICONS = [
  "users",
  "plane",
  "home",
  "utensils",
  "graduation-cap",
  "heart",
  "party-popper",
  "mountain",
  "briefcase",
  "car",
  "music",
  "shopping-bag",
] as const;
export type GroupIcon = (typeof GROUP_ICONS)[number];

export const GROUP_COLORS = ["violet", "cyan", "amber", "mint", "rose", "sky"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const LIMITS = {
  maxGroupMembers: 50,
  receiptMaxBytes: 2 * 1024 * 1024,
  avatarMaxBytes: 512 * 1024,
  receiptMime: ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const,
  avatarMime: ["image/png", "image/jpeg", "image/webp"] as const,
  /** a submitted tx we can't find anywhere is rejected after this long */
  txNotFoundTimeoutMs: 20 * 60 * 1000,
  /** tolerance (blocks) when binding a direct transfer to the intent's creation block */
  intentBlockTolerance: 5n,
};
