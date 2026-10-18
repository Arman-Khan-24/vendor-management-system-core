import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errorHandler.js';

type WriteIdentity = { businessId: string; operation: 'order' | 'payment'; key?: string; payload: unknown };

// Call only after taking the business row lock, in the same transaction as the write.
export async function readReceipt<T>(client: PoolClient, input: WriteIdentity): Promise<T | undefined> {
  if (input.key === undefined) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.key)) {
    throw new AppError('Invalid retry key. Reload the form and try again.', 400);
  }
  const result = await client.query('SELECT request_hash, response FROM write_receipts WHERE business_id = $1 AND operation = $2 AND key = $3',
    [input.businessId, input.operation, input.key]);
  const receipt = result.rows[0];
  if (!receipt) return undefined;
  if (receipt.request_hash !== fingerprint(input.payload)) throw new AppError('This retry belongs to a different submission. Refresh to check the saved record.', 409);
  return receipt.response as T;
}

export async function saveReceipt(client: PoolClient, input: WriteIdentity, response: unknown): Promise<void> {
  if (input.key === undefined) return;
  await client.query('INSERT INTO write_receipts (business_id, operation, key, request_hash, response) VALUES ($1, $2, $3, $4, $5)',
    [input.businessId, input.operation, input.key, fingerprint(input.payload), JSON.stringify(response)]);
}

function fingerprint(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
