import type { WorkPacket } from './work-packet.js';

export type PlannerRequest = {
  runId: string;
  repository: string;
  baseBranch: string;
  expectedBaseSha: string;
  objective: string;
  limit: number;
  existingWorkItemIds: readonly string[];
};

export interface PlannerPort {
  planNextWorkPackets(request: PlannerRequest): readonly WorkPacket[] | Promise<readonly WorkPacket[]>;
}
