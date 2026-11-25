export const workOrderStatuses = [
  'draft',
  'estimate',
  'approved',
  'in_progress',
  'completed',
  'invoiced',
] as const;

export type WorkOrderStatus = (typeof workOrderStatuses)[number];

const allowedTransitions: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  draft: ['estimate'],
  estimate: ['approved'],
  approved: ['in_progress'],
  in_progress: ['completed'],
  completed: ['invoiced'],
  invoiced: [],
};

export class InvalidWorkOrderStatusTransitionError extends Error {
  constructor(from: WorkOrderStatus, to: WorkOrderStatus) {
    super(`Der Statuswechsel von „${from}“ zu „${to}“ ist nicht zulässig.`);
    this.name = 'InvalidWorkOrderStatusTransitionError';
  }
}

export function getAllowedWorkOrderTransitions(
  status: WorkOrderStatus,
): readonly WorkOrderStatus[] {
  return allowedTransitions[status];
}

export function transitionWorkOrderStatus(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): WorkOrderStatus {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidWorkOrderStatusTransitionError(from, to);
  }
  return to;
}
