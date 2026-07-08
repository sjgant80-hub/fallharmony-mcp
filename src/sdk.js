// @ai-native-solutions/fallharmony-sdk
// Operational cockpit: env-first debug · session hygiene · classify · timer · pre-exit checklist.
// MIT · ai-nativesolutions.com
// Extracted verbatim from the fallharmony single-file tool.

// ─── Diagnostic parser ───────────────────────────────────────────────
// Input shape (from the PowerShell probe):
//   {
//     agentServers: [{pid,cmd}...],
//     mcpServers:   [{pid,cmd}...],
//     playwright:   [{pid}...],
//     realChrome:   Number,
//     port1618:     Number,
//     zombieDirs:   Number
//   }
export function parseDiag(d) {
  if (!d || typeof d !== 'object') throw new Error('parseDiag: input must be an object');

  const items = [];

  const agentN = (d.agentServers || []).length;
  items.push({
    label: 'agent.mjs --server',
    val: agentN === 0 ? 'none' : `${agentN} running`,
    status: agentN === 0 ? 'ok' : (agentN === 1 ? 'amber' : 'red'),
    det: agentN === 0
      ? 'expected · spawns chromium when verbs fire'
      : (agentN === 1
        ? 'one running · check shell profile for autostart'
        : `${agentN} running · only one is ever needed · others are orphans`),
  });

  const mcpN = (d.mcpServers || []).length;
  const mcpSetsApprox = Math.round(mcpN / 4);
  items.push({
    label: 'MCP processes',
    val: `${mcpN} (~${mcpSetsApprox} session${mcpSetsApprox === 1 ? '' : 's'})`,
    status: mcpSetsApprox <= 1 ? 'ok' : 'amber',
    det: mcpSetsApprox <= 1
      ? 'one set · clean'
      : `${mcpSetsApprox - 1} orphan set${mcpSetsApprox > 2 ? 's' : ''} · close extra sessions cleanly`,
  });

  const pwN = (d.playwright || []).length;
  items.push({
    label: 'Playwright chromium',
    val: pwN === 0 ? 'none' : `${pwN} alive`,
    status: pwN === 0 ? 'ok' : 'amber',
    det: pwN === 0 ? 'clean' : 'kill if not in active use · they leak profile locks',
  });

  const rc = Number(d.realChrome || 0);
  items.push({
    label: 'Your real Chrome',
    val: `${rc} window${rc === 1 ? '' : 's'}`,
    status: 'ok',
    det: 'untouched · this is just your browsing',
  });

  const p1618 = Number(d.port1618 || 0);
  items.push({
    label: 'Port :1618 (cockpit)',
    val: p1618 === 0 ? 'free' : 'in use',
    status: p1618 === 0 ? 'ok' : 'amber',
    det: p1618 === 0 ? '--server not bound' : '--server is bound · cockpit reachable at localhost:1618',
  });

  const zd = Number(d.zombieDirs || 0);
  items.push({
    label: 'Zombie playwright temp dirs',
    val: zd === 0 ? 'none' : `${zd} on disk`,
    status: zd === 0 ? 'ok' : 'amber',
    det: zd === 0 ? 'clean' : `delete from temp dirs to free ~${zd * 50}MB`,
  });

  const red = items.filter(i => i.status === 'red').length;
  const amber = items.filter(i => i.status === 'amber').length;
  const ok = items.length - red - amber;

  return {
    items,
    summary: { red, amber, ok, total: items.length },
    verdict: red > 0 ? 'red' : (amber > 0 ? 'amber' : 'ok'),
  };
}

// ─── The PowerShell probe (paste-and-run) ────────────────────────────
export const DIAG_POWERSHELL_PROBE = `@{
  agentServers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -match 'agent\\.mjs'} | Select-Object @{N='pid';E={$_.ProcessId}}, @{N='cmd';E={$_.CommandLine}})
  mcpServers   = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -match 'onlybrains-mcp|fallcore-mcp|claude'} | Select-Object @{N='pid';E={$_.ProcessId}}, @{N='cmd';E={$_.CommandLine}})
  playwright   = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {$_.ExecutablePath -match 'ms-playwright'} | Select-Object @{N='pid';E={$_.ProcessId}})
  realChrome   = (Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Measure-Object).Count
  port1618     = ((netstat -ano | Select-String ':1618.*LISTENING') | Measure-Object).Count
  zombieDirs   = (Get-ChildItem "$env:LOCALAPPDATA\\Temp\\claude" -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -like 'playwright_chromium*'} | Measure-Object).Count
} | ConvertTo-Json -Depth 5 -Compress`;

// ─── Task classification ─────────────────────────────────────────────
export const CLASSIFICATIONS = {
  build:   { hint: 'BUILD · clean scope · single commit per logical step · ship in one go.',        timer: false },
  env:     { hint: 'ENV · 30-min timer started · if not fixed in 30, manual path. Come back later.', timer: true  },
  cleanup: { hint: 'CLEANUP · name what each process provides before killing. If unknown, ask.',    timer: false },
  audit:   { hint: 'AUDIT · read-only · no writes · ship a report and stop.',                        timer: false },
};

export function classifyTask(kind) {
  const c = CLASSIFICATIONS[kind];
  if (!c) throw new Error(`classifyTask: unknown kind '${kind}' · use one of ${Object.keys(CLASSIFICATIONS).join(', ')}`);
  return { kind, hint: c.hint, startTimer: c.timer, timerDurationMs: c.timer ? 30 * 60 * 1000 : 0 };
}

// ─── 30-minute env time-box ──────────────────────────────────────────
// Framework-free timer: returns handle with tick() / remaining() / stop().
export function startEnvTimer(onTick, onExpire) {
  const durationMs = 30 * 60 * 1000;
  const endAt = Date.now() + durationMs;
  let handle = null;
  const tick = () => {
    const remain = endAt - Date.now();
    if (remain <= 0) {
      if (handle) { clearInterval(handle); handle = null; }
      if (onExpire) onExpire();
      return { remaining: 0, display: '00:00', expired: true };
    }
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    const display = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (onTick) onTick({ remaining: remain, display, expired: false });
    return { remaining: remain, display, expired: false };
  };
  const first = tick();
  handle = setInterval(tick, 1000);
  return {
    remaining: () => Math.max(0, endAt - Date.now()),
    display: () => tick().display,
    stop: () => { if (handle) { clearInterval(handle); handle = null; } },
    initial: first,
  };
}

// ─── ENV-first diagnostic (3 questions → verdict) ────────────────────
export const ENV_QUESTIONS = [
  { id: 'procs', q: 'Are the same processes running today as yesterday?',                                        opts: ['yes · same baseline', 'no · something changed', 'don\'t know · check NOW panel'] },
  { id: 'mcp',   q: 'Are the same MCP servers connected (claude-in-chrome, computer-use, etc.)?',                opts: ['yes · all connected',  'no · one disconnected',   'don\'t know'] },
  { id: 'files', q: 'Have any agent.mjs / verb / config files changed since the last green run?',                opts: ['no · same git HEAD',    'yes · I committed today', 'don\'t know'] },
];

export function envDiagnostic(answers) {
  if (!answers || typeof answers !== 'object') throw new Error('envDiagnostic: answers object required');
  const sameProcs = String(answers.procs || '').startsWith('yes');
  const sameMCP   = String(answers.mcp   || '').startsWith('yes');
  const sameFiles = String(answers.files || '').startsWith('no');
  if (sameProcs && sameMCP && sameFiles) {
    return {
      envParity: true,
      verdict:   'Environment is the same · the regression is in the code · patch is correct path.',
      message:   'You\'ve verified env parity. Now patch the verb / file with confidence. Yesterday-worked + today-broken + same-env = a real regression in something you touched.',
      signals:   { sameProcs, sameMCP, sameFiles },
    };
  }
  return {
    envParity: false,
    verdict:   'Environment changed · restore env BEFORE patching code.',
    message:   'Something in the environment differs from when it worked. Patching code now will chase a symptom. Restore the env first: start the missing process, reconnect the MCP, revert the file change. Then test. If still broken, then patch.',
    signals:   { sameProcs, sameMCP, sameFiles },
  };
}

// ─── Pre-exit checklist ──────────────────────────────────────────────
export const EXIT_CHECKLIST = [
  { id: 'used_exit',      lab: 'Used /exit',                     desc: 'not just closed the window · /exit shuts MCPs cleanly' },
  { id: 'no_agent',       lab: 'No agent.mjs --server running',  desc: 'kill it via taskkill /F /PID <pid> if it\'s up' },
  { id: 'no_playwright',  lab: 'No Playwright chromium',         desc: 'check ms-playwright process count' },
  { id: 'no_zombies',     lab: 'No zombie temp dirs',            desc: 'rm -rf temp playwright_chromium* dirs' },
  { id: 'pushed',         lab: 'Pushed any in-progress work',    desc: 'no uncommitted commits drifting locally' },
];

export function evaluateExitChecklist(ticked) {
  const set = new Set(Array.isArray(ticked) ? ticked : []);
  const total = EXIT_CHECKLIST.length;
  const done = EXIT_CHECKLIST.filter(x => set.has(x.id)).length;
  const remaining = EXIT_CHECKLIST.filter(x => !set.has(x.id)).map(x => x.id);
  return {
    done,
    total,
    ready: done === total,
    remaining,
    message: done === total ? `ready to /exit · ${done}/${total}` : `${done}/${total} ticked · keep going`,
  };
}

// ─── Operational protocol (five durable rules) ───────────────────────
export const OPERATIONAL_RULES = [
  { id: 'OP1', title: 'ENV-FIRST DEBUG',            body: 'When something worked yesterday and breaks today, verify the environment is the same BEFORE patching code. Three checks: (a) same processes running? (b) same MCP servers connected? (c) same files on disk? If yes, then patch. If no, restore environment first.' },
  { id: 'OP2', title: 'NAME-BEFORE-KILL',           body: 'Before stopping any process, name what it provides. If you can\'t name it, ask. Don\'t kill.' },
  { id: 'OP3', title: 'IMPROVISATION = STOP-THE-LINE', body: 'If an agent starts inventing new file names instead of using the existing verb, that\'s the signal it lost context. Stop. Force the verb. Don\'t let it improvise harder.' },
  { id: 'OP4', title: '30-MIN TIME-BOX ON ENV DEBUGGING', body: 'Build problems are bounded. Environment debugging is unbounded. After 30 min, switch to the manual path (paste yourself · post yourself · ship via UI). Come back to the fix when the work is done.' },
  { id: 'OP5', title: 'SESSION HYGIENE',            body: 'Always /exit the CLI · never close the window. Once daily, scan Task Manager for orphan node.exe with MCP names in command line when no session is running.' },
];

// ─── Seven lessons (the lived-debt layer behind the rules) ───────────
export const SEVEN_LESSONS = [
  { n: 1, title: 'Env-question comes BEFORE code-question',    tag: 'trap',           body: 'Hours patching the verb · all the while the load-bearing agent.mjs --server was dead. Yesterday\'s environment had it running. Today\'s didn\'t. Should have noticed in minute 5.' },
  { n: 2, title: 'Cleanup that breaks working state',           tag: 'my-side',        body: 'Killed processes without naming what they provided. Killed the pipe. Then improvised harder. Three rounds of this.' },
  { n: 3, title: 'Improvised scripts = lost context',           tag: 'sub-agent',      body: 'When a sub-agent started writing post-topic-linkedin.mjs, linkedin-post-topic.mjs · that was the loss-of-context signal. Should have force-stopped and routed back to the existing verb.' },
  { n: 4, title: 'Inline batching = unstoppable',               tag: 'UX',             body: 'Long polls inline (150s blocking loops). Stop messages arrive but can\'t be seen until each bash finished. Bad UX. Background-fire all long ops · cap inline loops at 30s.' },
  { n: 5, title: 'Build vs env are different beasts',           tag: 'classification', body: 'Builds are bounded. Env-debugging is unbounded · easy to chase symptoms forever. Time-box hard.' },
  { n: 6, title: 'MCP server leak across sessions',             tag: 'hygiene',        body: 'Closing the CLI without /exit leaves child MCP processes alive. Over days = sidebar clog. Use /exit always.' },
  { n: 7, title: 'Brief like a colleague who walked in cold',   tag: 'briefing',       body: 'Build-agents refuse woo-coded briefs (rightly). Include a verified anchor: URL that returns 200, file path on disk, commit SHA. Saves a hallucination and a wasted turn.' },
];

// ─── Convenience: full snapshot for reports ──────────────────────────
export function snapshot(input) {
  const out = { version: '1.0.0', at: new Date().toISOString() };
  if (input?.diag)     out.diag = parseDiag(input.diag);
  if (input?.classify) out.classify = classifyTask(input.classify);
  if (input?.envAnswers) out.env = envDiagnostic(input.envAnswers);
  if (input?.exitTicked) out.exit = evaluateExitChecklist(input.exitTicked);
  return out;
}

export const VERSION = '1.0.0';

export default {
  VERSION,
  parseDiag,
  DIAG_POWERSHELL_PROBE,
  CLASSIFICATIONS,
  classifyTask,
  startEnvTimer,
  ENV_QUESTIONS,
  envDiagnostic,
  EXIT_CHECKLIST,
  evaluateExitChecklist,
  OPERATIONAL_RULES,
  SEVEN_LESSONS,
  snapshot,
};
