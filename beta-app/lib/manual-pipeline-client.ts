import type { ManualDiagnosticPacket, ReviewAttempt } from "./domain";
import { exportWorkerDiagnosticPacket, processWorkerManualDiagnostic, type WorkerPipelineBundle } from "./worker-manual-pipeline";

export type PipelineBundle = WorkerPipelineBundle;

export function exportDiagnosticPacket(attempt: ReviewAttempt) {
  return exportWorkerDiagnosticPacket(attempt);
}

export function processManualDiagnostic(packet: ManualDiagnosticPacket, diagnostic: unknown): Promise<PipelineBundle> {
  return processWorkerManualDiagnostic(packet, diagnostic);
}
