import { describe, expect, it } from 'vitest';
import {
  getAllowedWorkOrderTransitions,
  InvalidWorkOrderStatusTransitionError,
  transitionWorkOrderStatus,
  workOrderStatuses,
} from './work-order-status';

describe('work order status transitions', () => {
  it('uses the single linear workflow', () => {
    expect(workOrderStatuses).toEqual([
      'draft',
      'estimate',
      'approved',
      'in_progress',
      'completed',
      'invoiced',
    ]);
    expect(workOrderStatuses.slice(0, -1).map((status, index) =>
      transitionWorkOrderStatus(status, workOrderStatuses[index + 1]),
    )).toEqual(workOrderStatuses.slice(1));
  });

  it('rejects skipped, reversed, and repeated transitions', () => {
    expect(() => transitionWorkOrderStatus('draft', 'approved'))
      .toThrow(InvalidWorkOrderStatusTransitionError);
    expect(() => transitionWorkOrderStatus('completed', 'in_progress'))
      .toThrow(InvalidWorkOrderStatusTransitionError);
    expect(() => transitionWorkOrderStatus('invoiced', 'invoiced'))
      .toThrow(InvalidWorkOrderStatusTransitionError);
    expect(getAllowedWorkOrderTransitions('invoiced')).toEqual([]);
  });
});
