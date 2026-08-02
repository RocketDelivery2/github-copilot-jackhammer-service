import type { PacketExecutionResult, WorkPacket } from './work-packet.js';

export type CodexExecutionRequest = {
  packet: WorkPacket;
};

export interface CodexPort {
  execute(request: CodexExecutionRequest): PacketExecutionResult | Promise<PacketExecutionResult>;
}
