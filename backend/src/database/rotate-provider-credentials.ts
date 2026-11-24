import { pool, withTransaction } from './connection.js';
import { decryptSecret, encryptSecret } from '../services/business-settings.service.js';

async function rotate() {
  if (!/^[0-9a-f]{64}$/i.test(process.env.PROVIDER_ENCRYPTION_KEY || '')) {
    throw new Error('Set PROVIDER_ENCRYPTION_KEY before migrating credentials.');
  }
  return withTransaction(async client => {
    const ai = await client.query(`SELECT business_id, slot, api_key_encrypted FROM business_connections
      WHERE api_key_encrypted LIKE 'v1.%' FOR UPDATE`);
    for (const row of ai.rows) {
      const secret = decryptSecret(row.api_key_encrypted, row.business_id, row.slot);
      await client.query('UPDATE business_connections SET api_key_encrypted = $1 WHERE business_id = $2 AND slot = $3',
        [encryptSecret(secret, row.business_id, row.slot), row.business_id, row.slot]);
    }
    const meta = await client.query(`SELECT business_id, access_token_encrypted, app_secret_encrypted, verify_token_encrypted
      FROM whatsapp_connections WHERE access_token_encrypted LIKE 'v1.%' OR app_secret_encrypted LIKE 'v1.%'
      OR verify_token_encrypted LIKE 'v1.%' FOR UPDATE`);
    for (const row of meta.rows) {
      const rotateField = (value: string | null, field: string) => {
        if (!value?.startsWith('v1.')) return value;
        const purpose = 'whatsapp:' + field;
        return encryptSecret(decryptSecret(value, row.business_id, purpose), row.business_id, purpose);
      };
      await client.query(`UPDATE whatsapp_connections SET access_token_encrypted = $1,
        app_secret_encrypted = $2, verify_token_encrypted = $3 WHERE business_id = $4`, [
        rotateField(row.access_token_encrypted, 'accessToken'),
        rotateField(row.app_secret_encrypted, 'appSecret'),
        rotateField(row.verify_token_encrypted, 'verifyToken'),
        row.business_id,
      ]);
    }
    return { aiConnections: ai.rowCount, whatsappConnections: meta.rowCount };
  });
}

rotate().then(counts => console.log('Migrated provider credentials', counts)).catch(() => {
  console.error('Provider credential migration failed. Check database connectivity and encryption key configuration.');
  process.exitCode = 1;
}).finally(() => pool.end());
