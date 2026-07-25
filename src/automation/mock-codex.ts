import type { CodexPort } from './codex-port.js';
import type { PacketExecutionResult } from './work-packet.js';

export function createMockCodexPort(): CodexPort {
  return {
    execute({ packet }): PacketExecutionResult {
      const createdAt = new Date(0).toISOString();
      const rawOutput = `codex:${packet.workItemId}:${packet.objective}`;
      return {
        workItemId: packet.workItemId,
        runId: packet.runId,
        lane: packet.lane,
        rawOutput,
        rawOutputArtifactId: `${packet.runId}:${packet.workItemId}:raw-output`,
        summary: `codex completed ${packet.workItemId}`,
        details: [`lane:${packet.lane}`, `taskType:${packet.taskType}`],
        createdAt,
      };
    },
  };
}
