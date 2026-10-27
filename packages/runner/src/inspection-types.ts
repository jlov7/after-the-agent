import type { CanonicalPlant, DomainEvent, Job, Lamp } from '../../contracts/src/index.js';

export type PulseCounts = Readonly<Record<Lamp, number>>;
export interface InspectionFrame {
  readonly tick: number;
  readonly plant: CanonicalPlant;
  readonly events: readonly DomainEvent[];
  readonly expected: PulseCounts;
  readonly observed: PulseCounts;
}
export interface ContinuationInspection {
  readonly candidate_sha256: string;
  readonly case_id: string;
  readonly case_sha256: string;
  readonly frames: readonly InspectionFrame[];
  readonly first_mismatch_tick: number | null;
}
export interface JobInspection {
  readonly job_id: string;
  readonly job: Job | null;
  readonly enqueue_recorded: boolean;
  readonly events: readonly DomainEvent[];
  readonly outcome: 'pending' | 'delivered' | 'discarded' | 'dropped' | 'unknown';
}
export interface RepairComparison {
  readonly same_context: boolean;
  readonly context_notes: readonly string[];
  readonly changes: readonly { readonly path: string; readonly before: string; readonly after: string }[];
  readonly cases: readonly { readonly case_id: string; readonly before: string; readonly after: string }[];
}
