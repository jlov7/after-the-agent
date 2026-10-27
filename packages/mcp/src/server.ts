import { McpServer, fromJsonSchema, type JsonSchemaType, type jsonSchemaValidator } from '@modelcontextprotocol/server';
import { boardSchema, compileSchema, validateRequest, type BoardRequest, type BoardResult } from '../../contracts/src/index.js';
import release from '../package.json' with { type: 'json' };
export const canonicalSchemaProvider: jsonSchemaValidator = { getValidator: <T>(schema: JsonSchemaType) => compileSchema<T>(schema) };
export const boardInputSchema = fromJsonSchema<BoardRequest>(boardSchema as JsonSchemaType, canonicalSchemaProvider);
export type BoardDispatcher = (request: BoardRequest) => BoardResult;
export function createBoardServer(dispatcher: BoardDispatcher): McpServer {
  const server = new McpServer({ name: 'after-the-agent', version: release.version });
  server.registerTool('board_action', { description: 'Inspect and configure the restricted lights board. Identity and world are host-owned.', inputSchema: boardInputSchema }, args => {
    const result = dispatcher(validateRequest(args));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { ...result }, isError: result.outcome === 'rejected' };
  });
  server.registerResource('board_info','ata://board/info',{description:'Fixed lights task and canonical request schema version',mimeType:'application/json'},()=>({contents:[{uri:'ata://board/info',mimeType:'application/json',text:JSON.stringify({task:'alternating-lights-v1',period:4,delay:2,target:'Odd beats left, even beats right, every fourth beat also center. Scene changes invalidate queued work.',schema_version:'1.0'})}]}));
  return server;
}
