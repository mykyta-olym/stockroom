export type ChargeRequest = {
  orderId: string;
  amountCents: number;
  currency: string;
  // Lets a provider treat a retried request as the same charge.
  idempotencyKey: string;
  // What a provider's payment form hands back. Card data never reaches this code.
  paymentToken: string;
};

export type ChargeResult =
  { status: 'approved'; reference: string } | { status: 'declined'; reason: string };

export class PaymentUnavailableError extends Error {
  override name = 'PaymentUnavailableError';
}

export interface PaymentAdapter {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
