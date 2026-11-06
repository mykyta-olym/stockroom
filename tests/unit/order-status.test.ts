import { describe, expect, it } from 'vitest';
import {
  adminTransitions,
  canTransition,
  formatOrderNumber,
  isOrderStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  releasesStock,
} from '@/domain/order-status';

describe('canTransition', () => {
  it.each([
    ['pending_payment', 'paid'],
    ['pending_payment', 'payment_failed'],
    ['pending_payment', 'cancelled'],
    ['paid', 'shipped'],
    ['paid', 'cancelled'],
    ['shipped', 'delivered'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['paid', 'delivered'],
    ['shipped', 'cancelled'],
    ['paid', 'pending_payment'],
    ['payment_failed', 'paid'],
  ] as const)('forbids %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats delivered, cancelled and failed orders as final', () => {
    for (const from of ['delivered', 'cancelled', 'payment_failed'] as const) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('never stays in the same status', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe('adminTransitions', () => {
  it('offers the next steps without the ones only payment may take', () => {
    expect(adminTransitions('pending_payment')).toEqual(['cancelled']);
    expect(adminTransitions('paid')).toEqual(['shipped', 'cancelled']);
    expect(adminTransitions('shipped')).toEqual(['delivered']);
    expect(adminTransitions('delivered')).toEqual([]);
  });
});

describe('releasesStock', () => {
  it('is true only for states that undo a reservation', () => {
    const releasing = ORDER_STATUSES.filter(releasesStock);
    expect(releasing).toEqual(['cancelled', 'payment_failed']);
  });
});

describe('helpers', () => {
  it('labels every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('recognises statuses', () => {
    expect(isOrderStatus('paid')).toBe(true);
    expect(isOrderStatus('refunded')).toBe(false);
    expect(isOrderStatus(undefined)).toBe(false);
  });

  it('formats an order number', () => {
    expect(formatOrderNumber(100001)).toBe('SR-100001');
  });
});
