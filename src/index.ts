#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { JpzipClient } from '@jpzip/jpzip';
import { listCitiesInPrefecture, lookupZipcode, searchByAddress } from './tools.js';

const client = new JpzipClient();

const server = new Server(
  {
    name: 'mcp-server-jpzip',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  },
);

const TOOLS = [
  {
    name: 'lookup_zipcode',
    description:
      'Look up the Japanese address for a 7-digit postal code (郵便番号). Returns prefecture, city, and town(s) in kanji, katakana, and romaji, plus the JIS prefecture code and Soumu city code. Hyphens in the input are allowed.',
    inputSchema: {
      type: 'object',
      properties: {
        zipcode: {
          type: 'string',
          description: '7-digit postal code, e.g. "2310017" or "231-0017".',
        },
      },
      required: ['zipcode'],
    },
  },
  {
    name: 'search_by_address',
    description:
      'Search for postal codes by free-text address query. Matches against prefecture, city, and town in kanji, katakana, or romaji (case-insensitive substring match, whitespace ignored). First call in a session downloads the full dataset (~25MB) into memory; subsequent calls within the same session are instant.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Address keyword, e.g. "横浜市中区本町" / "ヨコハマシナカクホンチョウ".',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of hits to return (default 20).',
          minimum: 1,
          maximum: 200,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_cities_in_prefecture',
    description:
      'List all municipalities (city / ward / town / village) in a Japanese prefecture, with their Soumu city codes. Prefecture name accepts kanji, katakana, or romaji. Shares the same in-memory dataset as search_by_address.',
    inputSchema: {
      type: 'object',
      properties: {
        prefecture: {
          type: 'string',
          description: 'Prefecture name, e.g. "神奈川県" / "カナガワケン" / "Kanagawa".',
        },
      },
      required: ['prefecture'],
    },
  },
  {
    name: 'get_metadata',
    description:
      'Return the jpzip dataset metadata: data version (YYYY-MM), generated timestamp, total entry count, and per-prefecture counts. Useful for confirming the dataset is current.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      case 'lookup_zipcode': {
        const zipcode = String((args as { zipcode?: unknown }).zipcode ?? '');
        const result = await lookupZipcode(client, zipcode);
        return toolResult(result);
      }
      case 'search_by_address': {
        const a = args as { query?: unknown; limit?: unknown };
        const query = String(a.query ?? '');
        const limit = typeof a.limit === 'number' ? a.limit : undefined;
        const hits = await searchByAddress(client, query, limit);
        return toolResult({ count: hits.length, hits });
      }
      case 'list_cities_in_prefecture': {
        const prefecture = String((args as { prefecture?: unknown }).prefecture ?? '');
        const result = await listCitiesInPrefecture(client, prefecture);
        if ('error' in result) return toolResult(result);
        return toolResult({ count: result.length, cities: result });
      }
      case 'get_metadata': {
        const meta = await client.getMeta();
        return toolResult(meta ?? { error: 'meta.json is not available from the CDN.' });
      }
      default:
        return toolResult({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolResult({ error: message }, true);
  }
});

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('mcp-server-jpzip fatal:', err);
  process.exit(1);
});
