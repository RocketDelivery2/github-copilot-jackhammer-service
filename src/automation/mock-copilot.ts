import type { CopilotPort } from './copilot-port.js';
import type { PacketExecutionResult } from './work-packet.js';

export function createMockCopilotPort(): CopilotPort {
  return {
    execute({ packet }): PacketExecutionResult {
      const createdAt = new Date(0).toISOString();
      const rawOutput = `copilot:${packet.workItemId}:${packet.objective}`;
      return {
        workItemId: packet.workItemId,
        runId: packet.runId,
        lane: packet.lane,
        rawOutput,
        rawOutputArtifactId: `${packet.runId}:${packet.workItemId}:raw-output`,
        summary: `copilot completed ${packet.workItemId}`,
        details: [`lane:${packet.lane}`, `taskType:${packet.taskType}`],
        createdAt,
      };
    },
  };
}
