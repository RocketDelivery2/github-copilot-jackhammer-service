import type { PlannerPort, PlannerRequest } from './planner-port.js';
import type { WorkPacket } from './work-packet.js';

export function createMockPlanner(packets: readonly WorkPacket[]): PlannerPort {
  let cursor = 0;

  return {
    planNextWorkPackets(request: PlannerRequest): readonly WorkPacket[] {
      const next = packets.slice(cursor, cursor + request.limit);
      cursor += next.length;
      return next.map(packet => ({ ...packet }));
    },
  };
}
