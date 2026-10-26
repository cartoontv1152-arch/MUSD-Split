import { z } from "zod";
import { CATEGORY_IDS, GROUP_COLORS, GROUP_ICONS } from "@/config/app";

export const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x wallet address")
  .transform((s) => s.toLowerCase());

export const addressKey = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x wallet address");

export const amountString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 12.50");

export const txHashSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 0x transaction hash")
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const uuidSchema = z.string().uuid();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Invalid date");

export const groupCreateSchema = z.object({
  name: z.string().trim().min(1, "Name your group").max(60),
  description: z.string().trim().max(280).optional().nullable(),
  icon: z.enum(GROUP_ICONS).default("users"),
  color: z.enum(GROUP_COLORS).default("violet"),
  membersCanInvite: z.boolean().default(true),
  simplifyDebts: z.boolean().default(true),
});

export const groupUpdateSchema = groupCreateSchema.partial().extend({ archived: z.boolean().optional() });

export const inviteCreateSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 90).nullable().optional(),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  label: z.string().trim().max(40).optional().nullable(),
});

export const splitSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("equal"), participants: z.array(addressSchema).min(1).max(100) }),
  z.object({ method: z.literal("custom"), amounts: z.record(addressKey, amountString) }),
  z.object({
    method: z.literal("percentage"),
    percentages: z.record(addressKey, z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a percentage like 33.33")),
  }),
  z.object({ method: z.literal("shares"), shares: z.record(addressKey, z.number().int().min(1).max(10_000)) }),
]);
export type SplitBody = z.infer<typeof splitSchema>;

export const expenseBaseSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(80),
  amount: amountString,
  payer: addressSchema,
  category: z.enum(CATEGORY_IDS),
  date: isoDate,
  notes: z.string().trim().max(500).optional().nullable(),
  receiptId: uuidSchema.optional().nullable(),
  split: splitSchema,
});

export const expenseCreateSchema = expenseBaseSchema.extend({
  clientRequestId: z.string().trim().min(8).max(64).optional(),
});

export const expenseUpdateSchema = expenseBaseSchema.extend({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(280).optional().nullable(),
});

export const expenseDeleteSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(280).optional().nullable(),
});

export const settlementMethodSchema = z.enum(["direct", "contract", "contract_permit"]);

export const settlementCreateSchema = z.object({
  to: addressSchema,
  amount: amountString,
  method: settlementMethodSchema.default("direct"),
  paymentRequestId: uuidSchema.optional().nullable(),
  expenseIds: z.array(uuidSchema).max(50).optional(),
  note: z.string().trim().max(140).optional().nullable(),
});

export const batchCreateSchema = z.object({
  method: z.enum(["batch", "batch_permit"]).default("batch_permit"),
});

export const txSubmitSchema = z.object({ txHash: txHashSchema });

export const paymentRequestCreateSchema = z.object({
  payer: addressSchema,
  amount: amountString,
  note: z.string().trim().max(280).optional().nullable(),
  expenseIds: z.array(uuidSchema).max(50).optional(),
  expiresInDays: z.number().int().min(1).max(90).nullable().optional(),
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(40).nullable().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "3–20 characters: a–z, 0–9 or _")
    .nullable()
    .optional(),
  preferences: z
    .object({
      defaultSettlementMethod: settlementMethodSchema.optional(),
      reduceMotion: z.boolean().optional(),
      compactNumbers: z.boolean().optional(),
    })
    .optional(),
});

export const recurringCreateSchema = expenseBaseSchema
  .omit({ date: true, receiptId: true, notes: true })
  .extend({
    cadence: z.enum(["weekly", "monthly"]),
    intervalCount: z.number().int().min(1).max(12).default(1),
    startOn: isoDate,
    endOn: isoDate.nullable().optional(),
    remindDaysBefore: z.number().int().min(0).max(14).default(2),
  });

export const recurringUpdateSchema = z.object({ active: z.boolean() });
