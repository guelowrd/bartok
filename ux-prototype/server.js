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
const httpProxy = require('http');

const STATIC = __dirname;
const ROOT = path.resolve(__dirname, '..');
const TLSN = path.join(ROOT, 'zktls-spike', 'tlsn');
const MIDEN_INT = path.join(ROOT, 'miden', 'integration');
const MIDEN_BIN = path.join(ROOT, 'miden', 'target', 'release');
const ENV_FILE = path.join(ROOT, 'zktls-spike', '.env');
const ACCOUNTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'miden', 'accounts.json'), 'utf8'));

// ===== ECONOMICS — the ONE place to tune BARTOK's money =====================
// The Bartok (Ŧ) is a stablecoin pegged to the cheapest LLM token: 1 Basic-model
// token ALWAYS costs 1 Ŧ (the peg anchor). Other tiers are basic-token multiples.
const CONFIG = {
  usdPerBartok: 0.01,          // display rate on the buy-credits page only
  anonSpendCapBartok: 500,     // spend allowed before an account is required (=$5)
  freeGrantBartok: 1000,       // ILOVEBARTOK grant (=$10)
  discountCode: 'ILOVEBARTOK',
  geniusMaxTokens: 512,        // cap so a Genius reply can't blow the hold
  // Session hold per tier = min(cap, buyer's balance), with a per-tier floor
  // (enough for at least ~1 reply). Small by design — not a $250 pre-auth.
  holdBartok: { basic: 3000, genius: 10000 },
  minHoldBartok: { basic: 500, genius: 2500 },
};

// João's two real tiers: distinct free OpenRouter models, distinct per-token
// prices (in Bartoks). basic.pricePerToken = 1 is the PEG ANCHOR — do not change
// without redefining the Bartok. The 429 fallback stays WITHIN a tier so the
// verified model always matches what the buyer paid for.
const TIERS = {
  basic: {
    models: ['nvidia/nemotron-nano-9b-v2:free', 'openai/gpt-oss-20b:free'],
    pricePerToken: 1,          // PEG ANCHOR: 1 Ŧ = 1 basic token, always
    requiresAccount: false,
  },
  genius: {
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free',
      'openai/gpt-oss-120b:free', 'nvidia/nemotron-3-super-120b-a12b:free'],
    pricePerToken: 7,          // 7x the Basic rate
    requiresAccount: true,     // anonymous users are Basic-only
  },
};

// ponytail: sessions are in-memory only — a server restart loses session state.
// Funds are safe (the escrow note stays consumable on-chain by the operator);
// upgrade path is a JSON snapshot file.
const sessions = new Map();

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
function run(cmd, args, cwd, env, timeout = 240000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const cap = d => { out += d; };
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
function runMiden(bin, args, timeout) {
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
  const tierCfg = TIERS[tier];
  if (!tierCfg) throw new Error(`unknown tier: ${tier}`);
  const { messages, truncated } = buildMessages(history || [], prompt);
  const maxTokens = tier === 'genius' ? CONFIG.geniusMaxTokens : 1024;
  const env = { ...process.env, OPENROUTER_API_KEY: loadKey(),
    MESSAGES_JSON: JSON.stringify(messages), MAX_TOKENS: String(maxTokens),
    RUST_LOG: 'error,openrouter_prove=info' };

  // 1) zkTLS: notarize the real model call (429 fallback within the tier only)
  onStage('answer');
  let model = null;
  for (const m of tierCfg.models) {
    const r = await run('cargo', ['run', '--release', '--example', 'openrouter_prove'],
      TLSN, { ...env, MODEL: m });
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
const rateHits = new Map(); // key `${ip}:${bucket}` -> timestamps[] (ms since a fixed epoch)
let rlClock = 0;            // monotonic-ish tick; incremented per request (no Date.now in this env… but here it's fine)
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}
// allow `limit` requests per `windowMs`. Returns true if the request is allowed.
function rateOk(req, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${clientIp(req)}:${bucket}`;
  const hits = (rateHits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= limit) { rateHits.set(key, hits); return false; }
  hits.push(now);
  rateHits.set(key, hits);
  if (rateHits.size > 5000) rateHits.clear(); // crude unbounded-growth guard
  return true;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function ndjsonHead(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  return obj => res.write(JSON.stringify(obj) + '\n');
}

const usd = units => Number((units * CONFIG.usdPerBartok).toFixed(2));

// ---- auth-lite: {walletId -> {name, salt, hash}} + per-wallet spend + redeemed
// ponytail: a flat JSON file, not a DB. Good enough for the first Rita cohort.
const USERS_FILE = path.join(ROOT, 'ux-prototype', 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
const users = loadUsers();
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
    const preq = httpProxy.request({ ...GUARDIAN_ORIGIN, path: gpath, method: req.method,
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
    const { buyerId, tier = 'basic', balance = 0 } = JSON.parse(await readBody(req) || '{}');
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
    if (!params) return json(res, 500, { error: 'build_escrow failed', detail: p.out.slice(-400) });
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { buyerId, tier, params, budget, escrowNoteB64: null,
      charges: [], settled: false, createdAt: Date.now() });
    console.log(`[session] ${sessionId} buyer=${buyerId} tier=${tier} hold=${budget}`);
    json(res, 200, { sessionId, escrowTemplate: {
      requestB64: params.requestB64, noteB64: params.noteB64,
      faucet: ACCOUNTS.faucet, budget,
    } });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/escrow') {
    const { sessionId, noteB64 } = JSON.parse(await readBody(req) || '{}');
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: 'unknown session' });
    if (!noteB64) return json(res, 400, { error: 'missing noteB64 (private escrow needs full note details)' });
    s.escrowNoteB64 = noteB64;
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
        console.log(`[chat] tier=${msgTier} "${prompt.slice(0, 60)}"`);
        sellerBroadcast('job_started', { tier: msgTier, model: TIERS[msgTier].models[0] });
        s.history = s.history || [];
        const result = await runAnswer(prompt, msgTier, s.history, stage => emit({ type: 'stage', stage }));
        if (spent + result.charge > s.budget) {
          throw new Error('hold_exhausted');
        }
        s.charges.push(result);
        s.history.push({ role: 'user', content: prompt }, { role: 'assistant', content: result.reply });
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
    try {
      const { sessionId } = JSON.parse(await readBody(req) || '{}');
      const s = sessions.get(sessionId);
      if (!s) throw new Error('unknown session');
      if (!s.escrowNoteB64) throw new Error('session has no escrow');
      if (s.settled) throw new Error('already settled');
      const charge = s.charges.reduce((a, c) => a + c.charge, 0);
      emit({ type: 'stage', stage: 'settle' });
      console.log(`[settle] ${sessionId} charge=${charge}`);
      const r = await runMiden('settle_session', [
        '--escrow-note-b64', s.escrowNoteB64, '--charge', String(charge),
        '--buyer', s.buyerId,
        '--seller-serial', s.params.sellerSerial.join(','),
        '--buyer-serial', s.params.buyerSerial.join(','),
      ], 480000);
      const settled = lastJson(r.out);
      if (r.code !== 0 || !settled) {
        throw new Error('settlement failed: ' + r.out.slice(-400));
      }
      s.settled = true;
      sellerStats.settled += 1;
      // João consuming his payment is off Rita's critical path: reconcile it in
      // the background (waits for block inclusion, then proposes+executes).
      if (settled.sellerNoteFileB64) {
        runMiden('joao_sweep', ['--note-file-b64', settled.sellerNoteFileB64], 300000)
          .then(r => console.log(`[joao] ${r.code === 0 ? 'consumed' : 'reconcile pending'}`))
          .catch(() => {});
      }
      sellerBroadcast('session_settled', { charge, chargeUsd: usd(charge),
        proposalId: settled.settleProposalId, explorer: settled.explorer });
      console.log(`[settle] ${sessionId} proposal=${settled.settleProposalId}`);
      emit({ type: 'done', charge, refund: settled.refund,
        chargeUsd: usd(charge), refundUsd: usd(settled.refund),
        settleProposalId: settled.settleProposalId,
        sellerNoteId: settled.sellerNoteId, buyerNoteId: settled.buyerNoteId,
        refundNoteFileB64: settled.refundNoteFileB64,
        joaoProposalId: settled.joaoProposalId,
        links: { operator: settled.explorer } });
    } catch (e) {
      console.error('[settle] error:', e.message);
      emit({ type: 'done', error: String(e.message || e) });
    }
    res.end();
    return;
  }

  // Redeem a discount code for free credits (a private BART mint). The mint note
  // details come back as bytes so Rita consumes them via a Guardian proposal.
  if (req.method === 'POST' && req.url === '/api/credits/redeem') {
    if (!rateOk(req, 'redeem', 5, 60000)) return json(res, 429, { error: 'slow down' });
    const { buyerId, code } = JSON.parse(await readBody(req) || '{}');
    if (!buyerId) return json(res, 400, { error: 'missing buyerId' });
    if ((code || '').trim().toUpperCase() !== CONFIG.discountCode) {
      return json(res, 400, { error: 'bad_code' });
    }
    users[buyerId] = users[buyerId] || {};
    if (users[buyerId].redeemed) return json(res, 400, { error: 'already_redeemed' });
    console.log(`[credits] ${buyerId} redeem ${CONFIG.discountCode}`);
    const r = await runMiden('fund_buyer',
      ['--buyer', buyerId, '--amount', String(CONFIG.freeGrantBartok)], 240000);
    const out = lastJson(r.out);
    if (r.code !== 0 || !out) return json(res, 500, { error: 'mint failed', detail: r.out.slice(-400) });
    users[buyerId].redeemed = true;
    saveUsers(users);
    json(res, 200, { ...out, amount: CONFIG.freeGrantBartok, noteFileB64: out.noteFileB64 || null });
    return;
  }

  // Auth-lite: create/login a basic account bound to the wallet id.
  if (req.method === 'POST' && (req.url === '/api/auth/register' || req.url === '/api/auth/login')) {
    if (!rateOk(req, 'auth', 10, 60000)) return json(res, 429, { error: 'slow down' });
    const { buyerId, name, password } = JSON.parse(await readBody(req) || '{}');
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
    const hash = crypto.scryptSync(password, u.salt, 32).toString('hex');
    if (hash !== u.hash) return json(res, 401, { error: 'bad_password' });
    return json(res, 200, { ok: true, name: u.name });
  }

  // Whether this wallet has an account (drives the UI gates).
  if (req.method === 'GET' && req.url.startsWith('/api/account?')) {
    const id = new URL(req.url, 'http://x').searchParams.get('buyerId') || '';
    json(res, 200, { hasAccount: hasAccount(id), name: (users[id] || {}).name || null,
      spent: spentBy(id), redeemed: !!(users[id] || {}).redeemed });
    return;
  }

  // static files (seller.html and assets on :8787; buyer UI runs on Vite :5173)
  const rel = req.url === '/' ? '/seller.html' : req.url.split('?')[0];
  const file = path.join(STATIC, rel);
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(file);
  const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(file));
});

// Warm the release builds once at startup so the first message isn't a cold compile.
function warm() {
  try {
    console.log('[warm] building pipeline (first run compiles; subsequent starts are instant)…');
    execSync('cargo build --release --example openrouter_prove --example openrouter_present --example openrouter_oracle',
      { cwd: TLSN, stdio: 'ignore' });
    execSync('cargo build --release -p integration --bin settle_session --bin fund_buyer --bin escrow_params',
      { cwd: MIDEN_INT, stdio: 'ignore' });
    console.log('[warm] ready ✓  (~10-15s per message: ~7-8s answer + verify; settle at session end)');
  } catch (e) {
    console.log('[warm] build warning (first message may be slow):', e.message.split('\n')[0]);
  }
}

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`BARTOK bridge -> http://localhost:${PORT}  (seller dashboard: /seller.html)`);
  console.log(`accounts: sellerMultisig=${ACCOUNTS.sellerMultisig} operatorMultisig=${ACCOUNTS.operatorMultisig} faucet=${ACCOUNTS.faucet} guardian=${ACCOUNTS.guardianHttp}`);
  warm();
});
