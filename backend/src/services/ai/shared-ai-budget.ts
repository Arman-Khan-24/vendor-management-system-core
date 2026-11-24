import { withTransaction } from '../../database/connection.js';
import { ProviderError } from '../provider-http.js';

export async function reserveSharedAiRequest(businessId: string): Promise<void> {
  const allowed = process.env.SHARED_AI_BUSINESS_IDS?.split(',').map(id => id.trim()).filter(Boolean);
  if (allowed?.length && !allowed.includes(businessId)) {
    throw new ProviderError('SHARED_AI_DISABLED', false);
  }

  await withTransaction(async client => {
    // Take global first in every transaction. Roll back both counters if either is full.
    for (const [scope, limit] of [['global', 300], [businessId, 30]] as const) {
      const result = await client.query(
        `INSERT INTO shared_ai_usage (scope, usage_date, requests)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
         ON CONFLICT (scope) DO UPDATE SET usage_date = EXCLUDED.usage_date,
           requests = CASE WHEN shared_ai_usage.usage_date = EXCLUDED.usage_date
             THEN shared_ai_usage.requests + 1 ELSE 1 END
         WHERE shared_ai_usage.usage_date <> EXCLUDED.usage_date OR shared_ai_usage.requests < $2
         RETURNING requests`,
        [scope, limit]
      );
      if (!result.rowCount) throw new ProviderError('SHARED_AI_QUOTA_EXCEEDED', false);
    }
  });
}
