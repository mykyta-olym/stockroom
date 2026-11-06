import { createHash } from 'node:crypto';
import {
  type ChargeRequest,
  type ChargeResult,
  type PaymentAdapter,
  PaymentUnavailableError,
} from './types';

// FAKE PAYMENT ADAPTER. It talks to nobody, moves no money and never sees card
// data. The outcome is whatever the checkout form asked for, so that every branch
// of the order flow can be reached by hand and by tests.
export class FakePaymentAdapter implements PaymentAdapter {
  readonly name = 'fake';

  constructor(private readonly latencyMs = 0) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    switch (request.paymentToken) {
      case 'fake_approve':
        return { status: 'approved', reference: fakeReference(request.idempotencyKey) };
      case 'fake_decline':
        return { status: 'declined', reason: 'The fake payment was declined, as requested.' };
      case 'fake_error':
        throw new PaymentUnavailableError(
          'The fake payment provider is unavailable, as requested.',
        );
      default:
        return { status: 'declined', reason: 'Unknown fake payment token.' };
    }
  }
}

// Derived from the key, so a retried charge gets the same reference, as it would
// from a real provider.
function fakeReference(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  return `FAKE-${digest.slice(0, 16).toUpperCase()}`;
}
