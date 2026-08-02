import type { PacketExecutionResult, WorkPacket } from './work-packet.js';

export type CopilotExecutionRequest = {
  packet: WorkPacket;
};

export interface CopilotPort {
  execute(request: CopilotExecutionRequest): PacketExecutionResult | Promise<PacketExecutionResult>;
}
