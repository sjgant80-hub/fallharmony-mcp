# fallharmony-mcp

Model Context Protocol server for [fallharmony-sdk](https://github.com/sjgant80-hub/fallharmony-sdk). Exposes the operational cockpit (env-first debug, session hygiene, task classification, pre-exit checklist) as MCP tools + resources.

Stdio transport · six tools · four resources · MIT · zero-config.

## Install & wire into Claude Code

```bash
npm install -g @ai-native-solutions/fallharmony-mcp

# then register with Claude Code
claude mcp add fallharmony -- fallharmony-mcp
```

Or via `.mcp.json`:

```json
{
  "mcpServers": {
    "fallharmony": { "command": "fallharmony-mcp" }
  }
}
```

## Tools

| Tool                             | Purpose                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `parse_diagnostic`               | Analyse a diagnostic snapshot → status cards + red/amber/ok summary + verdict             |
| `diagnostic_probe_powershell`    | Return the paste-and-run PowerShell one-liner that produces the diagnostic JSON           |
| `classify_task`                  | BUILD / ENV / CLEANUP / AUDIT → per-kind hint + timer hint                                |
| `env_diagnostic`                 | Three-question ENV-first verdict (procs / mcp / files → env parity vs env changed)        |
| `evaluate_exit_checklist`        | Score the five-item pre-exit checklist                                                    |
| `snapshot`                       | One-shot combined report accepting any of `{ diag, classify, envAnswers, exitTicked }`    |

## Resources

- `fallharmony://operational-rules` — OP1-OP5
- `fallharmony://seven-lessons` — the lived-debt layer
- `fallharmony://env-questions` — three questions the ENV verdict uses
- `fallharmony://exit-checklist` — five pre-exit items

## Example (call `parse_diagnostic` from Claude Code)

```json
{
  "agentServers": [],
  "mcpServers": [{"pid":1,"cmd":"onlybrains-mcp"}],
  "playwright": [],
  "realChrome": 3,
  "port1618": 0,
  "zombieDirs": 0
}
```

Returns `{ items: [...], summary: { red, amber, ok, total }, verdict: 'ok' }`.

## Companion trio

- **fallharmony-sdk** — the pure ESM SDK (browser + Node)
- **fallharmony-mcp** — this MCP server
- **fallharmony-api** — HTTP + Docker wrapper

## License

MIT.
