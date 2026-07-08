#!/usr/bin/env node
// fallharmony-mcp · Model Context Protocol stdio server
// Wraps fallharmony-sdk · six tools + two resources · MIT

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import fh, {
  parseDiag,
  DIAG_POWERSHELL_PROBE,
  classifyTask,
  ENV_QUESTIONS,
  envDiagnostic,
  EXIT_CHECKLIST,
  evaluateExitChecklist,
  OPERATIONAL_RULES,
  SEVEN_LESSONS,
  snapshot,
} from './sdk.js';

const server = new Server(
  { name: 'fallharmony-mcp', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// ─── Tool schemas ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'parse_diagnostic',
    description: 'Analyse a process/network diagnostic snapshot (from the shipped PowerShell probe). Returns per-item status cards, red/amber/ok summary, and an overall verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        agentServers: { type: 'array', description: 'agent.mjs --server processes ({pid,cmd})' },
        mcpServers:   { type: 'array', description: 'MCP server node processes ({pid,cmd})' },
        playwright:   { type: 'array', description: 'ms-playwright chromium processes ({pid})' },
        realChrome:   { type: 'number', description: 'count of real Chrome windows' },
        port1618:     { type: 'number', description: '1 if :1618 is bound (cockpit), else 0' },
        zombieDirs:   { type: 'number', description: 'count of zombie playwright temp dirs' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'diagnostic_probe_powershell',
    description: 'Return the paste-and-run PowerShell one-liner that produces the diagnostic JSON parse_diagnostic expects.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'classify_task',
    description: 'Classify a task as BUILD / ENV / CLEANUP / AUDIT. ENV kicks off a 30-min time-box hint (per OP4).',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['build', 'env', 'cleanup', 'audit'] } },
      required: ['kind'],
    },
  },
  {
    name: 'env_diagnostic',
    description: 'Three-question ENV-first verdict. Pass answers for the three ENV_QUESTIONS ids (procs / mcp / files). Returns env-parity boolean, verdict, and message.',
    inputSchema: {
      type: 'object',
      properties: {
        procs: { type: 'string', description: 'answer to the same-processes question' },
        mcp:   { type: 'string', description: 'answer to the same-MCP-servers question' },
        files: { type: 'string', description: 'answer to the same-files question' },
      },
      required: ['procs', 'mcp', 'files'],
    },
  },
  {
    name: 'evaluate_exit_checklist',
    description: 'Score the five-item pre-exit checklist. Pass an array of ticked item ids (used_exit, no_agent, no_playwright, no_zombies, pushed).',
    inputSchema: {
      type: 'object',
      properties: { ticked: { type: 'array', items: { type: 'string' } } },
      required: ['ticked'],
    },
  },
  {
    name: 'snapshot',
    description: 'One-shot combined report. Accepts any of: { diag, classify, envAnswers, exitTicked }. Returns a versioned snapshot with each provided section evaluated.',
    inputSchema: {
      type: 'object',
      properties: {
        diag:       { type: 'object', description: 'input for parse_diagnostic' },
        classify:   { type: 'string', enum: ['build','env','cleanup','audit'] },
        envAnswers: { type: 'object', description: '{procs,mcp,files}' },
        exitTicked: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result;
    switch (name) {
      case 'parse_diagnostic':          result = parseDiag(args || {}); break;
      case 'diagnostic_probe_powershell': result = { probe: DIAG_POWERSHELL_PROBE }; break;
      case 'classify_task':             result = classifyTask(args?.kind); break;
      case 'env_diagnostic':            result = envDiagnostic(args || {}); break;
      case 'evaluate_exit_checklist':   result = evaluateExitChecklist(args?.ticked || []); break;
      case 'snapshot':                  result = snapshot(args || {}); break;
      default: throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true };
  }
});

// ─── Resources ────────────────────────────────────────────────────
const RESOURCES = [
  { uri: 'fallharmony://operational-rules', name: 'Operational rules (OP1-OP5)', mimeType: 'application/json', description: 'Five durable rules: env-first debug, name-before-kill, improvisation = stop-the-line, 30-min time-box, session hygiene.' },
  { uri: 'fallharmony://seven-lessons',     name: 'Seven lessons',                mimeType: 'application/json', description: 'The lived-debt layer behind the rules.' },
  { uri: 'fallharmony://env-questions',     name: 'ENV-first three questions',     mimeType: 'application/json', description: 'The three questions to ask before patching code when something worked yesterday and broke today.' },
  { uri: 'fallharmony://exit-checklist',    name: 'Pre-exit checklist',            mimeType: 'application/json', description: 'Five items to tick before ending a session.' },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  const table = {
    'fallharmony://operational-rules': OPERATIONAL_RULES,
    'fallharmony://seven-lessons':     SEVEN_LESSONS,
    'fallharmony://env-questions':     ENV_QUESTIONS,
    'fallharmony://exit-checklist':    EXIT_CHECKLIST,
  };
  const data = table[uri];
  if (!data) throw new Error(`unknown resource: ${uri}`);
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
});

// ─── Boot ─────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('fallharmony-mcp v1.0.0 · stdio ready\n');
