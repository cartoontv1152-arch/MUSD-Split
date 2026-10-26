/** DTO shapes returned by the API (amounts are decimal strings of MUSD base units). */

export interface Profile {
  address: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}
export type Profiles = Record<string, Profile>;

export interface Me extends Profile {
  preferences: { defaultSettlementMethod?: "direct" | "contract" | "contract_permit"; reduceMotion?: boolean };
  createdAt: string;
}

export type SettlementStatus = "created" | "submitted" | "delayed" | "confirmed" | "failed" | "rejected" | "cancelled";
export type SettlementMethod = "direct" | "contract" | "contract_permit" | "batch" | "batch_permit";

export interface Settlement {
  id: string;
  groupId: string;
  groupName?: string;
  from: string;
  to: string;
  amount: string;
  method: SettlementMethod;
  settlementKey: `0x${string}`;
  status: SettlementStatus;
  txHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: string | null;
  blockTime: string | null;
  chainId: number;
  paymentRequestId: string | null;
  batchId: string | null;
  expenseIds: string[];
  note: string | null;
  failureCode: string | null;
  failureReason: string | null;
  rejectedTxHash: string | null;
  verifyAttempts: number;
  lastCheckedAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
}

export interface Transfer {
  from: string;
  to: string;
  amount: string;
}

export interface Ledger {
  nets: Record<string, string>;
  simplified: Transfer[];
  pairwise: Transfer[];
  totalSpent: string;
  totalSettled: string;
  outstanding: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  createdBy: string;
  createdAt: string;
  membersCanInvite: boolean;
  simplifyDebts: boolean;
  currency: string;
  archivedAt: string | null;
}

export interface GroupSummary extends Group {
  role: string;
  memberCount: number;
  members: string[];
  net: string;
  totalSpent: string;
  outstanding: string;
  expenseCount: number;
  lastActivityAt: string;
  settledUp: boolean;
}

export interface Member {
  address: string;
  role: "owner" | "admin" | "member";
  status: "active" | "left" | "removed";
  joinedAt: string;
  net: string;
}

export interface StoredSplit {
  method: "equal" | "custom" | "percentage" | "shares";
  participants?: string[];
  amounts?: Record<string, string>;
  bps?: Record<string, number>;
  weights?: Record<string, number>;
}

export interface Expense {
  id: string;
  groupId: string;
  title: string;
  amount: string;
  currency: string;
  payer: string;
  category: string;
  date: string;
  notes: string | null;
  splitMethod: StoredSplit["method"];
  splitInput: StoredSplit;
  receiptId: string | null;
  recurringId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  deleteReason: string | null;
  participants: Array<{ address: string; share: string; input: string | null }>;
  status: "open" | "partial" | "settled" | "deleted";
  outstanding: string;
  coverage?: Array<{ member: string; share: string; outstanding: string; isPayer: boolean }>;
}

export interface PaymentRequest {
  id: string;
  groupId: string;
  groupName: string | null;
  requester: string;
  payer: string;
  amount: string;
  note: string | null;
  expenseIds: string[];
  status: "pending" | "paid" | "cancelled" | "declined" | "expired";
  expiresAt: string | null;
  createdAt: string;
  closedAt: string | null;
  paidSettlementId: string | null;
  settlementTxHash: string | null;
}

export interface Activity {
  id: string;
  groupId: string;
  groupName: string | null;
  actor: string | null;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Recurring {
  id: string;
  groupId: string;
  title: string;
  amount: string;
  payer: string;
  category: string;
  split: StoredSplit;
  cadence: "weekly" | "monthly";
  intervalCount: number;
  nextRunOn: string;
  endOn: string | null;
  remindDaysBefore: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastRunAt: string | null;
  groupName?: string;
}

export interface GroupBundle {
  group: Group;
  me: { address: string; role: Member["role"]; isAdmin: boolean };
  members: Member[];
  profiles: Profiles;
  ledger: Ledger;
  expenses: Expense[];
  settlements: Settlement[];
  requests: PaymentRequest[];
  recurring: Recurring[];
  activity: Activity[];
}

export interface Notification {
  id: string;
  groupId: string | null;
  groupName: string | null;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
}
