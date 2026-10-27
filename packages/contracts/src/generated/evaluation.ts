/* Generated from contracts/evaluation.schema.json. Run npm run generate:contracts. */

/**
 * A reference Case or complete Observation. CLI inputs are bounded arrays of these records, not a mixed-record array.
 */
export type AfterTheAgentIndependentEvaluationRecord = Case | Observation;
export type Identifier = string;
export type Sha256 = string;

export interface Case {
  schema_version: "1.0";
  case_id: Identifier;
  handover_tick: number;
  enqueue_until_tick: number;
  initial_world: InitialWorld;
  /**
   * @maxItems 4096
   */
  transitions: Transition[];
}
export interface InitialWorld {
  scene_id: Identifier;
  active: boolean;
}
export interface Transition {
  tick: number;
  scene_id: Identifier;
  active: boolean;
}
export interface Observation {
  schema_version: "1.0";
  case_id: Identifier;
  case_sha256: Sha256;
  candidate_sha256: Sha256;
  status: "complete";
  terminal_reason: "submitted";
  handover_tick: number;
  observed_through_tick: number;
  budget_exhausted: false;
  reset_during_attempt: false;
  /**
   * @maxItems 16384
   */
  pulses: Pulse[];
}
export interface Pulse {
  tick: number;
  lamp: "left" | "right" | "center";
}
