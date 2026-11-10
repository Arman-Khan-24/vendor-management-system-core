import { WhatsAppRepository } from '../../repositories/whatsapp.repo.js';
import { OrderProcessingEngine } from '../order.processor.js';
import { ProviderError } from '../provider-http.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { WhatsAppTransport } from './whatsapp.provider.js';

export async function processNextWhatsAppJob(transport?: WhatsAppTransport): Promise<boolean> {
  const job = await WhatsAppRepository.claim();
  if (!job) return false;
  try { await OrderProcessingEngine.processJob(job,transport); }
  catch (error) {
    const code = error instanceof ProviderError ? error.code : error instanceof AppError ? 'ORDER_REVIEW_REQUIRED' : 'PROCESSING_FAILED';
    const retryable = error instanceof ProviderError
      ? error.retryable || (job.kind==='inbound' && error.code==='PROVIDER_RESPONSE_UNCONFIRMED')
      : !(error instanceof AppError);
    await WhatsAppRepository.fail(job,code,retryable);
    console.error('WhatsApp job failed', { jobId: job.id, code });
  }
  return true;
}
export function startWhatsAppWorker(transport?: WhatsAppTransport) {
  let running = false, stopping = false;
  const tick = async () => {
    if (running || stopping) return;
    running = true;
    try { for (let i=0; i<10 && !stopping; i++) if (!await processNextWhatsAppJob(transport)) break; }
    catch { console.error('WhatsApp queue unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(),1000);
  void tick();
  return async () => {
    stopping = true; clearInterval(timer);
    while (running) await new Promise(resolve => setTimeout(resolve,100));
  };
}
