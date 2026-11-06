export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
  'payment_failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  payment_failed: [],
};

// Only the payment flow may mark an order as paid or as failed.
const PAYMENT_ONLY: readonly OrderStatus[] = ['paid', 'payment_failed'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  payment_failed: 'Payment failed',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function adminTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from].filter((status) => !PAYMENT_ONLY.includes(status));
}

// Entering one of these states gives the reserved stock back.
export function releasesStock(to: OrderStatus): boolean {
  return to === 'cancelled' || to === 'payment_failed';
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

export function formatOrderNumber(number: number): string {
  return `SR-${number}`;
}
