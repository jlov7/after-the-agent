/* Generated from contracts/board.schema.json. Run npm run generate:contracts. */

/**
 * Canonical request contract for the browser, local MCP tool and headless adapter.
 */
export type AfterTheAgentBoardRequest = {
  schema_version: "1.0";
  request_id: RequestId;
  expected_revision?: Revision;
  action: Action;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "RequestId".
 */
export type RequestId = string;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Revision".
 */
export type Revision = number;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Action".
 */
export type Action = InspectAction | MutationAction;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MutationAction".
 */
export type MutationAction =
  SetClockAction | SetEpochGuardAction | SetGateModeAction | RefreshGateAction | DropJobsAction | AdvanceAction;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Clock".
 */
export type Clock = "primary" | "shadow";
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "GateMode".
 */
export type GateMode = "live" | "cached";
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "JobId".
 */
export type JobId = string;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Identifier".
 */
export type Identifier = string;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Tick".
 */
export type Tick = number;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Epoch".
 */
export type Epoch = number;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Lamp".
 */
export type Lamp = "left" | "right" | "center";

/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "InspectAction".
 */
export interface InspectAction {
  type: "inspect";
  target: "board" | "queue" | "gate" | "events";
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "SetClockAction".
 */
export interface SetClockAction {
  type: "set_clock";
  clock: Clock;
  enabled: boolean;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "SetEpochGuardAction".
 */
export interface SetEpochGuardAction {
  type: "set_epoch_guard";
  enabled: boolean;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "SetGateModeAction".
 */
export interface SetGateModeAction {
  type: "set_gate_mode";
  mode: GateMode;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "RefreshGateAction".
 */
export interface RefreshGateAction {
  type: "refresh_gate";
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "DropJobsAction".
 */
export interface DropJobsAction {
  type: "drop_jobs";
  /**
   * @minItems 1
   * @maxItems 64
   */
  job_ids: [JobId, ...JobId[]];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AdvanceAction".
 */
export interface AdvanceAction {
  type: "advance";
  ticks: number;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "World".
 */
export interface World {
  scene_id: Identifier;
  active: boolean;
  epoch: Epoch;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Configuration".
 */
export interface Configuration {
  clocks: {
    primary: boolean;
    shadow: boolean;
  };
  gate_mode: GateMode;
  epoch_guard: boolean;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "GateCache".
 */
export interface GateCache {
  active: boolean;
  epoch: Epoch;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Job".
 */
export interface Job {
  id: JobId;
  clock: Clock;
  enqueue_tick: number;
  due_tick: number;
  lamp: Lamp;
  enqueue_epoch: Epoch;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "CanonicalPlant".
 */
export interface CanonicalPlant {
  schema_version: "1.0";
  tick: Tick;
  revision: Revision;
  world: World;
  config: Configuration;
  gate_cache: GateCache;
  /**
   * @maxItems 128
   */
  queue: Job[];
  event_seq: number;
}
