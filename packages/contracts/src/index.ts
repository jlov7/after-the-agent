import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import boardSchema from '../../../contracts/board.schema.json' with { type: 'json' };
import evaluationSchema from '../../../contracts/evaluation.schema.json' with { type: 'json' };
import type { AfterTheAgentBoardRequest as BoardRequest, CanonicalPlant } from './generated/board.js';
export type { AfterTheAgentBoardRequest as BoardRequest } from './generated/board.js';
export type * from './model.js';
export { boardSchema, evaluationSchema };
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const requestValidator = ajv.compile<BoardRequest>(boardSchema);
const plantValidator = ajv.compile<CanonicalPlant>({ $schema: boardSchema.$schema, $defs: boardSchema.$defs, $ref: '#/$defs/CanonicalPlant' });
export class ContractError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(readonly issues: readonly ErrorObject[], readonly request_id?: string) { super('Canonical schema validation failed'); this.name = 'ContractError'; }
}
export function validateRequest(value: unknown): BoardRequest {
  if (!requestValidator(value)) throw new ContractError(structuredClone(requestValidator.errors ?? []),typeof value === 'object' && value !== null && 'request_id' in value && typeof value.request_id === 'string' ? value.request_id : undefined);
  return value;
}
export function validatePlantShape(value: unknown): CanonicalPlant {
  if (!plantValidator(value)) throw new ContractError(structuredClone(plantValidator.errors ?? []));
  return value;
}

export function compileSchema<T>(schema: object): (value: unknown) => { valid: true; data: T; errorMessage: undefined } | { valid: false; data: undefined; errorMessage: string } {
  const validate = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false }).compile<T>(schema);
  return value => validate(value) ? { valid: true, data: value, errorMessage: undefined } : { valid: false, data: undefined, errorMessage: 'Canonical schema validation failed' };
}

export { canonicalJson, sha256Json, sha256Text } from './canonical.js';
