import { withTransaction } from './connection.js';
import { decryptSecret, encryptConnectionKey } from '../services/business-settings.service.js';

export async function migrateAiCredentials(): Promise<number> {
  if (!/^[0-9a-f]{64}$/i.test(process.env.AI_PROVIDER_ENCRYPTION_KEY || '')) {
    throw new Error('AI_PROVIDER_ENCRYPTION_KEY must be a 32-byte hex string.');
  }
  return withTransaction(async client => {
    const result = await client.query(`SELECT business_id, slot, api_key_encrypted FROM business_connections
      WHERE api_key_encrypted LIKE 'v1.%' OR api_key_encrypted LIKE 'v2.%'
      ORDER BY business_id, slot FOR UPDATE`);
    for (const row of result.rows) {
      const plaintext = decryptSecret(row.api_key_encrypted, row.business_id, row.slot);
      const ciphertext = encryptConnectionKey(plaintext, row.business_id, row.slot);
      await client.query('UPDATE business_connections SET api_key_encrypted = $1 WHERE business_id = $2 AND slot = $3',
        [ciphertext, row.business_id, row.slot]);
    }
    return result.rowCount ?? 0;
  });
}
