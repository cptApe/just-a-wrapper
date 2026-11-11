import 'server-only';
import { reconcilePendingBilling } from '@/features/billing/server';
import { reconcileToolDeliveries } from '@/features/tools/api/reconcile-tool-deliveries';
import { pruneWebhookReceipts } from './prune-webhook-receipts';

// The daily billing sweep also settles tool deliveries, which the tools feature owns, and prunes
// old webhook receipts. Pruning runs even when a payment could not be reconciled.
export async function runBillingRecovery(): Promise<void> {
  const results = await Promise.allSettled([
    reconcilePendingBilling({ reconcileToolDeliveries }),
    pruneWebhookReceipts(),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
