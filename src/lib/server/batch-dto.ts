import "server-only";
import { settlementDTO } from "./groups";
import type { getBatch } from "./settlements";

export function batchDTO(b: NonNullable<Awaited<ReturnType<typeof getBatch>>>) {
  return {
    batch: {
      id: b.batch.id,
      groupId: b.batch.group_id,
      payer: b.batch.payer,
      method: b.batch.method,
      total: b.batch.total,
      status: b.batch.status,
      txHash: b.batch.tx_hash,
      blockNumber: b.batch.block_number,
      failureReason: b.batch.failure_reason,
      createdAt: b.batch.created_at.toISOString(),
      submittedAt: b.batch.submitted_at?.toISOString() ?? null,
      confirmedAt: b.batch.confirmed_at?.toISOString() ?? null,
    },
    items: b.items.map(settlementDTO),
  };
}
