// BARTOK bridge: sessions, tier→model routing, zkTLS pipeline, testnet
// settlement, and the live seller (João) event stream.
//
// Endpoints (all under http://localhost:8787):
//   POST /api/session/start  {buyerId, tier?}       -> {sessionId, escrowTemplate}
//   POST /api/session/escrow {sessionId, noteId}    -> {ok}
//   POST /api/chat           {sessionId, prompt, tier} -> NDJSON stages then done
//   POST /api/session/end    {sessionId}            -> NDJSON settle stage then done
//   POST /api/faucet/fund    {buyerId}              -> {txId, explorer}
//   GET  /api/seller/events                          -> SSE (João's dashboard)
//
// Run:  node ux-prototype/server.js     buyer UI: cd ux-prototype && npm run dev
// Prereqs: zktls-spike/setup.sh + .env, openrouter_keygen, miden setup_accounts.
const http = require('http');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// BARTOK_TEST=1: importable test mode — no listen, no warm-up compile, stubbed
// Rust/zkTLS externals, isolated users-store, fixture accounts. Lets the whole
// HTTP surface be integration-tested with plain `node --test` (zero deps).
const TESTING = process.env.BARTOK_TEST === '1';

// A stray async failure must not take the whole backend down mid-demo.
process.on('unhandledRejection', (e) => console.error('[unhandled rejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaught exception]', e));

// Mirror all bridge output to a logfile — however the bridge is launched
// (operator terminal, nohup, serve.sh), the log survives for diagnosis.
if (!TESTING) {
  const logStream = fs.createWriteStream(path.join(__dirname, '..', 'guardian', 'bridge.log'), { flags: 'a' });
  for (const m of ['log', 'error']) {
    const orig = console[m].bind(console);
    console[m] = (...a) => { orig(...a); try { logStream.write(a.map(String).join(' ') + '\n'); } catch (_) {} };
  }
}

const STATIC = __dirname;
const ROOT = path.resolve(__dirname, '..');
const TLSN = path.join(ROOT, 'zktls-spike', 'tlsn');
const MIDEN_INT = path.join(ROOT, 'miden', 'integration');
const MIDEN_BIN = path.join(ROOT, 'miden', 'target', 'release');
const ENV_FILE = path.join(ROOT, 'zktls-spike', '.env');
const ACCOUNTS = TESTING
  ? { faucet: '0xfaucet', sellerMultisig: '0xseller', operatorMultisig: '0xoperator',
      operatorTag: 909639680, guardianHttp: 'http://localhost:3300', guardianGrpc: 'http://localhost:50052' }
  : JSON.parse(fs.readFileSync(path.join(ROOT, 'miden', 'accounts.json'), 'utf8'));

// ===== ECONOMICS — the ONE place to tune BARTOK's money =====================
// The Bartok (Ŧ) is a stablecoin pegged to the cheapest LLM token: 1 Basic-model
// token ALWAYS costs 1 Ŧ (the peg anchor). Other tiers are basic-token multiples.
const CONFIG = {
  // CLEAN PEG (faucet decimals = 2, on-chain): 1 BASE unit = 1 Basic LLM token;
  // Ŧ1.00 displayed = 100 base units. All CONFIG values are BASE units.
  // Anchored to real cost: $0.10/M tokens → $0.0000001 per base unit.
  usdPerBartok: 0.0000001,     // per BASE unit (display rate on the buy page)
  anonSpendCapBartok: 5000000, // Ŧ50,000 displayed (=$0.50)
  freeGrantBartok: 10000000,   // per ILOVEBARTOK* code: Ŧ100,000 displayed (=$1)
  discountCode: 'ILOVEBARTOK',
  // Reply budget covers REASONING + the visible answer. Reasoning models can
  // burn 500-1,500 tokens thinking before they write — a tight cap makes them
  // 'spend the whole budget thinking' with nothing left to say. At honest
  // pricing a maxed reply is Ŧ2,048 (basic $0.0002) / Ŧ14,336 (genius $0.0014):
  // well inside the session holds (50k / 200k).
  maxTokens: { basic: 2048, genius: 2048 },
  // Session hold per tier = min(cap, buyer's balance), with a per-tier floor
  // (enough for at least ~1 reply). Small by design — not a $250 pre-auth.
  // Measured (2026-07-06): basic reply Ŧ925 first message, Ŧ1,042 with history
  // riding along — call it ~Ŧ1,000-1,600/message. Holds sized for a real session.
  holdBartok: { basic: 50000, genius: 200000 },   // Ŧ500 / Ŧ2,000 displayed
  minHoldBartok: { basic: 2500, genius: 10000 },  // > one worst-case reply
};

// João's two real tiers: distinct free OpenRouter models, distinct per-token
// prices (in Bartoks). basic.pricePerToken = 1 is the PEG ANCHOR — do not change
// without redefining the Bartok. The 429 fallback stays WITHIN a tier so the
// verified model always matches what the buyer paid for.
const TIERS = {
  basic: {
    models: ['nvidia/nemotron-nano-9b-v2:free', 'openai/gpt-oss-20b:free'],
    pricePerToken: 1,          // PEG: 1 base unit per Basic token (decimals live on-chain)
    requiresAccount: false,
  },
  genius: {
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free',
      'openai/gpt-oss-120b:free', 'nvidia/nemotron-3-super-120b-a12b:free'],
    pricePerToken: 7,          // 7x the Basic rate
    requiresAccount: true,     // anonymous users are Basic-only
  },
};

// Sessions persist to a JSON snapshot so a bridge crash/restart can never
// strand an escrowed hold: unsettled sessions reload at boot, and the sweeper
// below auto-settles abandoned ones (refunding the unused hold).
const STATE_DIR = TESTING ? require('os').tmpdir() : path.join(ROOT, 'state');
if (!TESTING) { try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (_) {} }
const SESSIONS_FILE = TESTING
  ? path.join(STATE_DIR, `bartok-test-sessions-${process.pid}.json`)
  : path.join(STATE_DIR, 'sessions.json');
const sessions = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(require('fs').readFileSync(SESSIONS_FILE, 'utf8')))) {
    if (!v.settled) sessions.set(k, v);
  }
  if (sessions.size) console.log(`[sessions] restored ${sessions.size} unsettled session(s) from snapshot`);
} catch (_) {}
function persistSessions() {
  try { require('fs').writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); } catch (e) { console.error('[sessions] persist failed:', e.message); }
}

// ---- seller (João) SSE feed -------------------------------------------------
const sellerClients = new Set();
const sellerStats = { earned: 0, replies: 0, settled: 0 };
function sellerBroadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sellerClients) res.write(msg);
}

function loadKey() {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/OPENROUTER_API_KEY=(\S+)/);
  if (!m) throw new Error('OPENROUTER_API_KEY missing in zktls-spike/.env');
  return m[1];
}

// Async command runner: never rejects — resolves { code, out } with stdout+stderr merged.
// onChunk (optional) sees output as it streams — used to surface REAL pipeline
// progress (request sent / model answered) to the UI while the proof runs.
function run(cmd, args, cwd, env, timeout = 240000, onChunk) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const cap = d => { out += d; if (onChunk) try { onChunk(String(d)); } catch (_) {} };
    p.stdout.on('data', cap);
    p.stderr.on('data', cap);
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeout);
    p.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
    p.on('error', e => { resolve({ code: -1, out: out + String(e) }); });
  });
}

// The miden bins share one sqlite client store — never run two concurrently
// (double-clicked mints etc. collide and surface as RPC/store errors).
let midenQueue = Promise.resolve();
// test stubs: deterministic fake outputs for the Rust bins / zkTLS pipeline
const TEST_STUBS = {
  build_escrow: () => JSON.stringify({ sellerRecipient: ['1','2','3','4'], sellerTag: 1,
    sellerSerial: ['1','2','3','4'], buyerRecipient: ['5','6','7','8'], buyerTag: 2,
    buyerSerial: ['5','6','7','8'], noteType: '0', requestB64: 'cmVx', noteB64: 'bm90ZQ==' }),
  fund_buyer: () => JSON.stringify({ txId: '0xtesttx', explorer: 'https://example.test/tx' }),
  settle_session: (args) => {
    // sessions whose buyer id ends in 'ff' fail the FIRST settle (exit 1),
    // succeed on retry — mirrors the transient testnet races we see live.
    const buyer = args[args.indexOf('--buyer') + 1] || '';
    if (buyer.endsWith('ff') && !TEST_STUBS._failedOnce) { TEST_STUBS._failedOnce = true; return { code: 1, out: 'stub transient failure' }; }
    // buyer ending 'ee': simulate the operator delta wedge clearing after 2 attempts
    if (buyer.endsWith('ee')) {
      TEST_STUBS._wedges = (TEST_STUBS._wedges || 0) + 1;
      if (TEST_STUBS._wedges <= 2) return { code: 1, out: 'Cannot push new delta: there is already a non-canonical delta pending' };
    }
    // buyer ending 'dd': escrow note already consumed on-chain — terminal, never settles
    if (buyer.endsWith('dd')) return { code: 1, out: 'nullifiers already exist: [0xdeadbeef]' };
    return JSON.stringify({ charge: 42, refund: 458, settleProposalId: '0xprop',
      sellerNoteId: '0xsn', buyerNoteId: '0xbn', refundNoteFileB64: 'cmVmdW5k',
      sellerNoteFileB64: null, explorer: 'https://example.test/acct' });
  },
  joao_sweep: () => JSON.stringify({ ok: true }),
};
function runMiden(bin, args, timeout) {
  if (TESTING) {
    const r = TEST_STUBS[bin] ? TEST_STUBS[bin](args) : '{}';
    return Promise.resolve(typeof r === 'string' ? { code: 0, out: r } : r);
  }
  const next = midenQueue.then(() => run(path.join(MIDEN_BIN, bin), args, MIDEN_INT, process.env, timeout));
  midenQueue = next.catch(() => {});
  return next;
}

// Parse the last stdout line of a bin as JSON (our bins' machine-readable contract).
function lastJson(out) {
  const lines = out.trim().split('\n').filter(l => l.trim().startsWith('{'));
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}

// ---- the zkTLS answer pipeline (one message) --------------------------------
// Bounded conversation history: keep the last turns that fit a byte budget
// (must stay under the notarized request's MAX_SENT_DATA of 4 KiB — larger
// budgets exceed the MPC mux stream cap). Returns { messages, truncated }.
const HISTORY_BUDGET = 2400; // conservative vs 4 KiB (headers + auth + body framing)
function buildMessages(history, prompt) {
  const turns = [...history, { role: 'user', content: prompt }];
  let kept = [], size = 0, truncated = false;
  for (let i = turns.length - 1; i >= 0; i--) {
    const len = JSON.stringify(turns[i]).length;
    if (size + len > HISTORY_BUDGET && kept.length) { truncated = true; break; }
    kept.unshift(turns[i]); size += len;
  }
  return { messages: kept, truncated };
}

let busy = false;
async function runAnswer(prompt, tier, history, onStage) {
  if (TESTING) {
    onStage('answer'); onStage('thinking'); onStage('received'); onStage('verify');
    const { truncated } = buildMessages(history || [], prompt);
    return { reply: 'stub reply', reasoning: null, truncated,
      model: tier === 'genius' ? 'stub-genius' : 'stub-basic', tier, tokens: 42, charge: 42 * (TIERS[tier].pricePerToken) };
  }
  const tierCfg = TIERS[tier];
  if (!tierCfg) throw new Error(`unknown tier: ${tier}`);
  let { messages, truncated } = buildMessages(history || [], prompt);
  // Basic = answers, not deliberation: '/no_think' (nemotron's control message)
  // turns reasoning off so the whole budget is visible output — measured: the
  // pi question went from 2,072 tokens of pure thinking to a 175-token answer.
  // (The OpenRouter unified reasoning param errors on this model; this works.)
  if (tier !== 'genius') messages = [{ role: 'system', content: '/no_think' }, ...messages];
  const maxTokens = CONFIG.maxTokens[tier] || 2048;
  const env = { ...process.env, OPENROUTER_API_KEY: loadKey(),
    MESSAGES_JSON: JSON.stringify(messages), MAX_TOKENS: String(maxTokens),
    RUST_LOG: 'error,openrouter_prove=info' };

  // 1) zkTLS: notarize the real model call (429 fallback within the tier only).
  // The prover's own log lines drive honest live stages in the UI.
  onStage('answer');
  let model = null;
  for (const m of tierCfg.models) {
    let acc = '', sent = false, got = false;
    const r = await run('cargo', ['run', '--release', '--example', 'openrouter_prove'],
      TLSN, { ...env, MODEL: m }, 240000, chunk => {
        acc += chunk; // match on the accumulated stream — chunk boundaries can split lines
        if (!sent && acc.includes('Sending request')) { sent = true; onStage('thinking'); }
        if (!got && acc.includes('Got response: 200')) { got = true; onStage('received'); }
      });
    if (r.out.includes('Got response: 200')) { model = m; break; }
  }
  if (!model) throw new Error('BUSY'); // tier's free models all rate-limited (429)

  // 2) present (selective disclosure) + oracle (verify notary + proof -> charge)
  onStage('verify');
  await run('cargo', ['run', '--release', '--example', 'openrouter_present'], TLSN, env);
  const oracleRun = await run('cargo', ['run', '--release', '--example', 'openrouter_oracle'],
    TLSN, { ...env, PRICE_PER_TOKEN: String(tierCfg.pricePerToken) });
  const oracle = lastJson(oracleRun.out);
  if (oracleRun.code !== 0 || !oracle || !oracle.notary_ok) {
    const reason = /REJECTED/.test(oracleRun.out) ? 'oracle rejected: unknown notary'
      : 'oracle verification failed';
    throw new Error(reason);
  }
  // The verified model must be the one this tier promised. OpenRouter may
  // resolve an alias to a dated snapshot (foo:free -> foo-20230311:free), so
  // match on the base name prefix; the PROOF's model string is what we report.
  const requestedBase = model.replace(/:free$/, '');
  const verifiedBase = String(oracle.model).replace(/:free$/, '');
  if (!verifiedBase.startsWith(requestedBase)) {
    throw new Error(`verified model mismatch: paid for ${model}, proof says ${oracle.model}`);
  }

  // reply text from the captured response (display only — not part of the proof).
  // Reasoning models return their thinking in `reasoning`; NEVER show that as
  // the answer — pass it separately so the UI can tuck it behind a toggle.
  let reply = '';
  let reasoning = null;
  try {
    const resp = JSON.parse(fs.readFileSync(path.join(TLSN, 'openrouter.response.json'), 'utf8'));
    const msg = resp.choices && resp.choices[0] && resp.choices[0].message;
    reply = (msg && msg.content) || '';
    reasoning = (msg && msg.reasoning) || null;
  } catch (_) {}
  if (!reply) {
    reply = reasoning
      ? '(The model spent its whole reply budget on internal reasoning. Ask again, or ask for a shorter answer.)'
      : '(no text returned)';
  }

  return { reply, reasoning, truncated, model: oracle.model, tier, tokens: oracle.total_tokens, charge: oracle.charge };
}

// ---- helpers ----------------------------------------------------------------
const MAX_BODY = 512 * 1024; // 512 KiB: escrow note bytes are ~100 KiB base64; well clear
function readBody(req) {
  return new Promise((resolve) => {
    let body = '', tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      body += c;
      if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } // → callers see {} → 400
    });
    req.on('end', () => resolve(tooBig ? '' : body));
    req.on('error', () => resolve(''));
  });
}

// ---- per-IP rate limiter (in-memory sliding window). ponytail: a Map, not Redis.
const rateHits = new Map(); // key `${ip}:${bucket}` -> timestamps[]
function clientIp(req) {
  // ngrok appends the true client IP as the LAST x-forwarded-for entry; a client
  // can prepend spoofed values but can't remove ngrok's, so take the last one.
  const xf = req.headers['x-forwarded-for'];
  const parts = xf ? String(xf).split(',').map(p => p.trim()).filter(Boolean) : [];
  return parts[parts.length - 1] || req.socket.remoteAddress || 'unknown';
}
// allow `limit` requests per `windowMs`. Returns true if the request is allowed.
function rateOk(req, bucket, limit, windowMs) {
  // In test mode the limiter is opt-in (x-test-ratelimit header) so functional
  // tests aren't throttled while the abuse-guard test still exercises it.
  if (TESTING && !req.headers['x-test-ratelimit']) return true;
  const now = Date.now();
  const key = `${clientIp(req)}:${bucket}`;
  const hits = (rateHits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= limit) { rateHits.set(key, hits); return false; }
  hits.push(now);
  rateHits.set(key, hits);
  // bounded growth: evict the oldest keys instead of wiping everyone's counters
  if (rateHits.size > 5000) { const it = rateHits.keys(); for (let i = 0; i < 1000; i++) rateHits.delete(it.next().value); }
  return true;
}

// Safe body parse: malformed JSON returns null (caller 400s) instead of throwing
// an unhandled rejection that hangs the socket forever.
async function readJson(req) { try { return JSON.parse((await readBody(req)) || '{}'); } catch { return null; } }

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function ndjsonHead(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  return obj => res.write(JSON.stringify(obj) + '\n');
}

const usd = units => Number((units * CONFIG.usdPerBartok).toFixed(6));

// ---- auth-lite: {walletId -> {name, salt, hash}} + per-wallet spend + redeemed
// ponytail: a flat JSON file, not a DB. Good enough for the first Rita cohort.
const USERS_FILE = path.join(STATE_DIR, TESTING ? `bartok-test-users-${process.pid}.json` : 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
const users = loadUsers();

// ---- refund recovery: private refund NoteFiles persisted per buyer so a
// browser that dies mid-settle can still collect on its next visit.
const REFUNDS_FILE = path.join(STATE_DIR, TESTING ? `bartok-test-refunds-${process.pid}.json` : 'refunds.json');
function loadRefunds() { try { return JSON.parse(fs.readFileSync(REFUNDS_FILE, 'utf8')); } catch { return {}; } }
function recordRefund(buyerId, noteFileB64) {
  if (!noteFileB64) return;
  const r = loadRefunds();
  r[buyerId] = [...(r[buyerId] || []), noteFileB64].slice(-20);
  fs.writeFileSync(REFUNDS_FILE, JSON.stringify(r));
}
function hasAccount(walletId) { return !!(users[walletId] && users[walletId].hash); }
function spentBy(walletId) { return (users[walletId] && users[walletId].spent) || 0; }
function recordSpend(walletId, amount) {
  users[walletId] = users[walletId] || {};
  users[walletId].spent = spentBy(walletId) + amount;
  saveUsers(users);
}

// ---- HTTP server ------------------------------------------------------------
const GUARDIAN_ORIGIN = { host: 'localhost', port: 3300 };

const server = http.createServer(async (req, res) => {
  // CORS for the (cross-origin) hosted buyer app. Permissive: this backend
  // holds only testnet funds; tighten to the Vercel origin for a real launch.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-pubkey,x-signature,x-timestamp,ngrok-skip-browser-warning');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Proxy /guardian/* -> Bartok-Guardian :3300 so a single tunnel to this bridge
  // serves both the app API and Guardian (prod). In dev, Vite proxies instead.
  if (req.url.startsWith('/guardian/') || req.url === '/guardian') {
    const gpath = req.url.replace(/^\/guardian/, '') || '/';
    const preq = http.request({ ...GUARDIAN_ORIGIN, path: gpath, method: req.method,
      headers: { ...req.headers, host: `localhost:${GUARDIAN_ORIGIN.port}` } }, pres => {
      res.writeHead(pres.statusCode, { ...pres.headers, 'Access-Control-Allow-Origin': '*' });
      pres.pipe(res);
    });
    preq.on('error', e => { res.writeHead(502); res.end('guardian proxy: ' + e.message); });
    req.pipe(preq);
    return;
  }

  // SSE: João's live dashboard feed
  if (req.method === 'GET' && req.url === '/api/seller/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    sellerClients.add(res);
    res.write(`event: snapshot\ndata: ${JSON.stringify({ ...sellerStats,
      earnedUsd: usd(sellerStats.earned), tiers: Object.fromEntries(Object.entries(TIERS)
        .map(([k, v]) => [k, { model: v.models[0], pricePerToken: v.pricePerToken }])) })}\n\n`);
    req.on('close', () => sellerClients.delete(res));
    return;
  }

  // Client-side error beacon: mobile browsers have no visible console — the
  // app posts wallet-init failures here so they land in the bridge log.
  if (req.method === 'POST' && req.url === '/api/client-log') {
    if (!rateOk(req, 'clientlog', 30, 60000)) return json(res, 429, { error: 'slow down' });
    const b = await readBody(req);
    console.log('[client]', String(b).replace(/[\r\n]+/g, ' ').slice(0, 400));
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && req.url === '/api/config') {
    json(res, 200, { faucet: ACCOUNTS.faucet, seller: ACCOUNTS.sellerMultisig,
      usdPerBartok: CONFIG.usdPerBartok, anonSpendCap: CONFIG.anonSpendCapBartok,
      freeGrant: CONFIG.freeGrantBartok,
      tiers: Object.fromEntries(Object.entries(TIERS).map(([k, v]) =>
        [k, { pricePerToken: v.pricePerToken, requiresAccount: v.requiresAccount,
          hold: CONFIG.holdBartok[k] }])) });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/start') {
    if (!rateOk(req, 'start', 20, 60000)) return json(res, 429, { error: 'slow down' });
    const body = await readJson(req); if (!body) return json(res, 400, { error: 'bad_json' });
    const { buyerId, tier = 'basic', balance = 0 } = body;
    if (!buyerId) return json(res, 400, { error: 'missing buyerId' });
    if (!TIERS[tier]) return json(res, 400, { error: 'unknown tier' });
    if (TIERS[tier].requiresAccount && !hasAccount(buyerId)) {
      return json(res, 403, { error: 'account_required', tier });
    }
    // Hold = min(tier cap, buyer's balance). Self-reported balance is fine:
    // it's their own escrow — understate and the hold is smaller, overstate and
    // their escrow funding fails on-chain.
    const bal = Math.max(0, Math.floor(Number(balance) || 0));
    if (bal < CONFIG.minHoldBartok[tier]) {
      return json(res, 400, { error: 'insufficient_credits', needed: CONFIG.minHoldBartok[tier] });
    }
    const budget = Math.min(CONFIG.holdBartok[tier], bal);
    const p = await runMiden('build_escrow',
      ['--buyer', buyerId, '--budget', String(budget)], 60000);
    const params = lastJson(p.out);
    if (!params) { console.error('[build_escrow] failed:\n' + p.out.slice(-1500)); return json(res, 500, { error: 'setup_failed' }); }
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { buyerId, tier, params, budget, escrowNoteB64: null,
      charges: [], settled: false, createdAt: Date.now(), lastActivity: Date.now() });
    persistSessions();
    console.log(`[session] ${sessionId} buyer=${buyerId} tier=${tier} hold=${budget}`);
    json(res, 200, { sessionId, escrowTemplate: {
      requestB64: params.requestB64, noteB64: params.noteB64,
      faucet: ACCOUNTS.faucet, budget,
    } });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/escrow') {
    const body = await readJson(req); if (!body) return json(res, 400, { error: 'bad_json' });
    const { sessionId, noteB64 } = body;
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: 'unknown session' });
    if (!noteB64) return json(res, 400, { error: 'missing noteB64 (private escrow needs full note details)' });
    s.escrowNoteB64 = noteB64;
    s.lastActivity = Date.now();
    persistSessions();
    console.log(`[session] ${sessionId} escrow registered`);
    json(res, 200, { ok: true, budget: s.budget });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!rateOk(req, 'chat', 30, 60000)) { json(res, 429, { error: 'slow down' }); return; }
    const emit = ndjsonHead(res);
    try {
      const { sessionId, prompt, tier } = JSON.parse(await readBody(req) || '{}');
      const s = sessions.get(sessionId);
      if (!s) throw new Error('unknown session');
      if (!s.escrowNoteB64) throw new Error('session has no escrow yet');
      if (s.settled) throw new Error('session already settled');
      if (!prompt) throw new Error('missing prompt');
      const msgTier = tier || s.tier;
      if (!TIERS[msgTier]) throw new Error('unknown tier');
      if (TIERS[msgTier].requiresAccount && !hasAccount(s.buyerId)) {
        throw new Error('account_required');
      }
      // Anonymous spend cap: block once cumulative spend would cross it.
      if (!hasAccount(s.buyerId) && spentBy(s.buyerId) >= CONFIG.anonSpendCapBartok) {
        throw new Error('anon_cap');
      }
      if (busy) throw new Error('BUSY');
      busy = true;
      try {
        const spent = s.charges.reduce((a, c) => a + c.charge, 0);
        console.log(`[chat] tier=${msgTier} prompt_len=${prompt.length}`); // prompts are user data — never logged
        sellerBroadcast('job_started', { tier: msgTier, model: TIERS[msgTier].models[0] });
        s.history = s.history || [];
        const result = await runAnswer(prompt, msgTier, s.history, stage => emit({ type: 'stage', stage }));
        if (spent + result.charge > s.budget) {
          throw new Error('hold_exhausted');
        }
        if (s.settled) throw new Error('session already settled'); // settled while this reply was in flight — don't give it away free
        s.charges.push(result);
        s.lastActivity = Date.now();
        persistSessions();
        // Memory rides inside the notarized request (4 KiB send cap → ~2.4 KB of
        // history). Replies dominate the bytes, so store a trimmed version:
        // ~3x more turns remembered for the same budget.
        const gist = (result.reply || '').length > 400 ? result.reply.slice(0, 400) + '…' : result.reply;
        s.history.push({ role: 'user', content: prompt }, { role: 'assistant', content: gist });
        recordSpend(s.buyerId, result.charge);
        sellerStats.replies += 1;
        sellerStats.earned += result.charge;
        sellerBroadcast('job_done', { tier: msgTier, model: result.model,
          tokens: result.tokens, charge: result.charge, chargeUsd: usd(result.charge) });
        const totalCharge = spent + result.charge;
        console.log(`[chat] model=${result.model} tokens=${result.tokens} charge=${result.charge}`);
        emit({ type: 'done', reply: result.reply, reasoning: result.reasoning,
          truncated: result.truncated, model: result.model, tier: msgTier,
          tokens: result.tokens, charge: result.charge, chargeUsd: usd(result.charge),
          totalCharge, remaining: s.budget - totalCharge });
      } finally {
        busy = false;
      }
    } catch (e) {
      console.error('[chat] error:', e.message);
      emit({ type: 'done', error: String(e.message || e) });
    }
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/end') {
    const emit = ndjsonHead(res);
    let guarded = null; // session whose settling flag we must clear in finally
    try {
      const body = await readJson(req);
      const s = body && sessions.get(body.sessionId);
      if (!body) throw new Error('bad_json');
      if (!s) throw new Error('unknown session');
      if (!s.escrowNoteB64) throw new Error('session has no escrow');
      if (s.settled) throw new Error('already settled');
      // ARCH#3: one settle per session at a time — a retry click / dropped-and-
      // retried request / the hourly sweeper must not double-settle the escrow.
      if (s.settling) throw new Error('settle_retry'); // already settling; the UI's retry will find it done
      s.settling = true; guarded = s;
      s.lastActivity = Date.now(); // so the idle sweeper doesn't pick it up mid-settle
      const charge = s.charges.reduce((a, c) => a + c.charge, 0);
      emit({ type: 'stage', stage: 'settle' });
      console.log(`[settle] ${body.sessionId} charge=${charge}`);
      // A failed submit can orphan a Guardian delta on the operator, wedging ALL
      // settlements for ~2 min (one-pending rule + discard window). Ride it out
      // here with backoff instead of bouncing the user between instant failures.
      const RETRY_MS = TESTING ? 50 : 35000;
      let r, settled;
      for (let attempt = 1; attempt <= 6; attempt++) {
        r = await runMiden('settle_session', [
          '--escrow-note-b64', s.escrowNoteB64, '--charge', String(charge),
          '--buyer', s.buyerId,
          '--seller-serial', s.params.sellerSerial.join(','),
          '--buyer-serial', s.params.buyerSerial.join(','),
        ], 480000);
        settled = lastJson(r.out);
        if (r.code === 0 && settled) break;
        const wedged = /non-canonical delta pending/.test(r.out);
        console.error(`[settle] attempt ${attempt} failed${wedged ? ' (operator delta wedge)' : ''}:\n` + r.out.slice(-1500));
        if (!wedged || attempt === 6) { settled = null; break; }
        emit({ type: 'stage', stage: 'settle_wait' });
        await new Promise((res2) => setTimeout(res2, RETRY_MS));
      }
      if (!settled) {
        throw new Error('settle_retry'); // non-wedge failure or wedge outlasted us; the UI offers a retry
      }
      recordRefund(s.buyerId, settled.refundNoteFileB64);
      sellerStats.settled += 1;
      // ARCH#4: settled → evict from memory + snapshot (refund lives in refunds.json;
      // nothing reads a settled session, and keeping it persisted user prompts/replies).
      sessions.delete(body.sessionId);
      persistSessions();
      // João consuming his payment is off Rita's critical path: reconcile it in
      // the background (waits for block inclusion, then proposes+executes).
      if (settled.sellerNoteFileB64) {
        runMiden('joao_sweep', ['--note-file-b64', settled.sellerNoteFileB64], 480000)
          .then(r => console.log(`[joao] ${r.code === 0 ? 'consumed' : 'reconcile pending'}`))
          .catch(() => {});
      }
      sellerBroadcast('session_settled', { charge, chargeUsd: usd(charge),
        proposalId: settled.settleProposalId, explorer: settled.explorer });
      console.log(`[settle] ${body.sessionId} proposal=${settled.settleProposalId}`);
      emit({ type: 'done', charge, refund: settled.refund,
        chargeUsd: usd(charge), refundUsd: usd(settled.refund),
        settleProposalId: settled.settleProposalId,
        sellerNoteId: settled.sellerNoteId, buyerNoteId: settled.buyerNoteId,
        refundNoteFileB64: settled.refundNoteFileB64,
        links: { operator: settled.explorer } });
    } catch (e) {
      if (e.message !== 'settle_retry' && e.message !== 'already settled') console.error('[settle] error:', e.message);
      emit({ type: 'done', error: String(e.message || e) });
    } finally {
      if (guarded) guarded.settling = false; // released on error/retry; a settled session is already evicted
    }
    res.end();
    return;
  }

  // Redeem a discount code for free credits (a private BART mint). The mint note
  // details come back as bytes so Rita consumes them via a Guardian proposal.
  if (req.method === 'POST' && req.url === '/api/credits/redeem') {
    if (!rateOk(req, 'redeem', 5, 60000)) return json(res, 429, { error: 'slow down' });
    const body = await readJson(req); if (!body) return json(res, 400, { error: 'bad_json' });
    const { buyerId, code } = body;
    if (!buyerId) return json(res, 400, { error: 'missing buyerId' });
    // Valid codes: ILOVEBARTOK (the shared one) + ILOVEBARTOK_00 … ILOVEBARTOK_99.
    // Each code is claimable ONCE per wallet (so a wallet can top up ~100x).
    const c = (code || '').trim().toUpperCase();
    const ok = c === CONFIG.discountCode || new RegExp(`^${CONFIG.discountCode}_[0-9]{2}$`).test(c);
    if (!ok) return json(res, 400, { error: 'bad_code' });
    users[buyerId] = users[buyerId] || {};
    // migrate the old boolean flag to the per-code map
    const claimed = users[buyerId].codes || (users[buyerId].redeemed ? { [CONFIG.discountCode]: true } : {});
    if (claimed[c]) return json(res, 400, { error: 'already_redeemed' });
    // Numbered codes unlock IN ORDER: the next valid one is the lowest _NN this
    // wallet hasn't claimed yet (plain ILOVEBARTOK is independent of the ladder).
    if (c !== CONFIG.discountCode) {
      let expected = -1;
      for (let i = 0; i < 100; i++) {
        const ci = `${CONFIG.discountCode}_${String(i).padStart(2, '0')}`;
        if (!claimed[ci]) { expected = i; break; }
      }
      const next = `${CONFIG.discountCode}_${String(expected).padStart(2, '0')}`;
      if (c !== next) return json(res, 400, { error: 'wrong_order', next });
    }
    console.log(`[credits] ${buyerId} redeem ${c}`);
    const r = await runMiden('fund_buyer',
      ['--buyer', buyerId, '--amount', String(CONFIG.freeGrantBartok)], 240000);
    const out = lastJson(r.out);
    if (r.code !== 0 || !out) { console.error('[credits] mint failed:\n' + r.out.slice(-1500)); return json(res, 500, { error: 'mint_failed' }); }
    claimed[c] = true;
    users[buyerId].codes = claimed;
    delete users[buyerId].redeemed;
    saveUsers(users);
    json(res, 200, { ...out, amount: CONFIG.freeGrantBartok, noteFileB64: out.noteFileB64 || null });
    return;
  }

  // Auth-lite: create/login a basic account bound to the wallet id.
  if (req.method === 'POST' && (req.url === '/api/auth/register' || req.url === '/api/auth/login')) {
    if (!rateOk(req, 'auth', 10, 60000)) return json(res, 429, { error: 'slow down' });
    const body = await readJson(req); if (!body) return json(res, 400, { error: 'bad_json' });
    const { buyerId, name, password } = body;
    if (!buyerId || !password) return json(res, 400, { error: 'missing fields' });
    const register = req.url.endsWith('/register');
    if (register) {
      if (hasAccount(buyerId)) return json(res, 400, { error: 'exists' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 32).toString('hex');
      users[buyerId] = { ...(users[buyerId] || {}), name: name || 'Rita', salt, hash };
      saveUsers(users);
      return json(res, 200, { ok: true, name: users[buyerId].name });
    }
    const u = users[buyerId];
    if (!u || !u.hash) return json(res, 401, { error: 'no_account' });
    const hash = crypto.scryptSync(password, u.salt, 32);
    const ok = crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'));
    if (!ok) return json(res, 401, { error: 'bad_password' });
    return json(res, 200, { ok: true, name: u.name });
  }

  // Pending refund note files for a wallet (imported + absorbed on app load).
  if (req.method === 'GET' && req.url.startsWith('/api/refunds?')) {
    const id = new URL(req.url, 'http://x').searchParams.get('buyerId') || '';
    json(res, 200, { files: loadRefunds()[id] || [] });
    return;
  }

  // Whether this wallet has an account (drives the UI gates).
  if (req.method === 'GET' && req.url.startsWith('/api/account?')) {
    const id = new URL(req.url, 'http://x').searchParams.get('buyerId') || '';
    const u = users[id] || {};
    json(res, 200, { hasAccount: hasAccount(id), name: u.name || null,
      spent: spentBy(id), codesUsed: Object.keys(u.codes || {}).length + (u.redeemed ? 1 : 0) });
    return;
  }

  // static files: EXPLICIT allowlist only (the buyer UI is on Vercel; the bridge
  // serves just João's dashboard + the shared stylesheet). An allowlist — not a
  // directory scan — so no state file, source, or dotfile in this dir is ever
  // reachable over the public tunnel.
  const SERVABLE = { '/': 'seller.html', '/seller.html': 'seller.html', '/bartok.css': 'bartok.css' };
  const name = SERVABLE[req.url.split('?')[0]];
  if (!name) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(STATIC, name);
  const ct = name.endsWith('.css') ? 'text/css' : 'text/html';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(file));
});

// ---- abandoned-session sweeper: a real user who closes the tab mid-chat must
// never leave a hold stranded. Any unsettled session with an escrow and no
// activity for SWEEP_IDLE_MS gets auto-settled (charges kept, rest refunded,
// refund recorded for the wallet's next visit). Runs at boot + hourly.
const SWEEP_IDLE_MS = TESTING ? 50 : 2 * 60 * 60 * 1000; // 2h
async function sweepAbandonedSessions() {
  for (const [id, s] of sessions) {
    if (s.settled || s.settling || !s.escrowNoteB64) continue;
    if (Date.now() - (s.lastActivity || s.createdAt) < SWEEP_IDLE_MS) continue;
    const charge = s.charges.reduce((a, c) => a + c.charge, 0);
    console.log(`[sweep] auto-settling abandoned session ${id} (charge=${charge})`);
    s.settling = true;
    try {
      const r = await runMiden('settle_session', [
        '--escrow-note-b64', s.escrowNoteB64, '--charge', String(charge),
        '--buyer', s.buyerId,
        '--seller-serial', s.params.sellerSerial.join(','),
        '--buyer-serial', s.params.buyerSerial.join(','),
      ], 480000);
      const settled = lastJson(r.out);
      if (r.code === 0 && settled) {
        recordRefund(s.buyerId, settled.refundNoteFileB64);
        sessions.delete(id);
        persistSessions();
        if (settled.sellerNoteFileB64) runMiden('joao_sweep', ['--note-file-b64', settled.sellerNoteFileB64], 300000).catch(() => {});
        console.log(`[sweep] settled ${id}: refund ${settled.refund} recorded for ${s.buyerId}`);
      } else if (/nullifiers already exist/.test(r.out)) {
        // The escrow note was already consumed on-chain (e.g. a prior settle
        // landed but its settled=true write was lost). Settlement can never
        // succeed, so stop retrying it every hour and evict the ghost.
        sessions.delete(id);
        persistSessions();
        console.log(`[sweep] evicted ${id}: escrow note already spent, nothing to settle`);
      } else {
        console.error(`[sweep] settle failed for ${id} (will retry next sweep):\n` + r.out.slice(-800));
      }
    } catch (e) { console.error(`[sweep] error for ${id}:`, e.message); }
    finally { const cur = sessions.get(id); if (cur) cur.settling = false; }
  }
}
if (!TESTING) {
  setTimeout(sweepAbandonedSessions, 60 * 1000);           // shortly after boot
  setInterval(sweepAbandonedSessions, 60 * 60 * 1000);      // hourly
}

// Warm the release builds once at startup so the first message isn't a cold compile.
function warm() {
  if (TESTING) return;
  try {
    console.log('[warm] building pipeline (first run compiles; subsequent starts are instant)…');
    execSync('cargo build --release --example openrouter_prove --example openrouter_present --example openrouter_oracle',
      { cwd: TLSN, stdio: 'ignore' });
    execSync('cargo build --release -p integration --bin settle_session --bin fund_buyer --bin build_escrow --bin joao_sweep',
      { cwd: MIDEN_INT, stdio: 'ignore' });
    console.log('[warm] ready ✓  (~10-15s per message: ~7-8s answer + verify; settle at session end)');
  } catch (e) {
    console.log('[warm] build warning (first message may be slow):', e.message.split('\n')[0]);
  }
}

module.exports = { server, CONFIG, TIERS, sweepAbandonedSessions };

if (require.main === module) {
  const PORT = process.env.PORT || 8787;
  server.listen(PORT, () => {
    console.log(`BARTOK bridge -> http://localhost:${PORT}  (seller dashboard: /seller.html)`);
    console.log(`accounts: sellerMultisig=${ACCOUNTS.sellerMultisig} operatorMultisig=${ACCOUNTS.operatorMultisig} faucet=${ACCOUNTS.faucet} guardian=${ACCOUNTS.guardianHttp}`);
    warm();
  });
}
