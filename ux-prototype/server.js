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

const STATIC = __dirname;
const ROOT = path.resolve(__dirname, '..');
const TLSN = path.join(ROOT, 'zktls-spike', 'tlsn');
const MIDEN_INT = path.join(ROOT, 'miden', 'integration');
const MIDEN_BIN = path.join(ROOT, 'miden', 'target', 'release');
const ENV_FILE = path.join(ROOT, 'zktls-spike', '.env');
const ACCOUNTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'miden', 'accounts.json'), 'utf8'));

// João's two real tiers: distinct free OpenRouter models, distinct per-token
// prices. The 429 fallback stays WITHIN a tier so the verified model always
// matches what the buyer paid for.
const TIERS = {
  basic: {
    models: ['nvidia/nemotron-nano-9b-v2:free', 'openai/gpt-oss-20b:free'],
    pricePerToken: 1,
  },
  genius: {
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free',
      'openai/gpt-oss-120b:free', 'nvidia/nemotron-3-super-120b-a12b:free'],
    pricePerToken: 7,
  },
};
const ESCROW_BUDGET = 25000; // one budget for every session; tiers only change per-message price
const FUND_AMOUNT = 50000;
const USD_PER_UNIT = 0.0001;

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

// Parse the last stdout line of a bin as JSON (our bins' machine-readable contract).
function lastJson(out) {
  const lines = out.trim().split('\n').filter(l => l.trim().startsWith('{'));
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}

// ---- the zkTLS answer pipeline (one message) --------------------------------
let busy = false;
async function runAnswer(prompt, tier, onStage) {
  const tierCfg = TIERS[tier];
  if (!tierCfg) throw new Error(`unknown tier: ${tier}`);
  const env = { ...process.env, OPENROUTER_API_KEY: loadKey(), PROMPT: prompt,
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

  // reply text from the captured response (display only — not part of the proof)
  let reply = '(no text returned)';
  try {
    const resp = JSON.parse(fs.readFileSync(path.join(TLSN, 'openrouter.response.json'), 'utf8'));
    const msg = resp.choices && resp.choices[0] && resp.choices[0].message;
    reply = (msg && (msg.content || msg.reasoning)) || reply;
  } catch (_) {}

  return { reply, model: oracle.model, tier, tokens: oracle.total_tokens, charge: oracle.charge };
}

// ---- helpers ----------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
  });
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

const usd = units => Number((units * USD_PER_UNIT).toFixed(4));

// ---- HTTP server ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
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
    json(res, 200, { faucet: ACCOUNTS.faucet, seller: ACCOUNTS.seller,
      escrowBudget: ESCROW_BUDGET, usdPerUnit: USD_PER_UNIT, fundAmount: FUND_AMOUNT });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/start') {
    const { buyerId, tier = 'basic' } = JSON.parse(await readBody(req) || '{}');
    if (!buyerId) return json(res, 400, { error: 'missing buyerId' });
    if (!TIERS[tier]) return json(res, 400, { error: 'unknown tier' });
    const p = await run(path.join(MIDEN_BIN, 'escrow_params'),
      ['--seller', ACCOUNTS.seller, '--buyer', buyerId], MIDEN_INT, process.env, 30000);
    const params = lastJson(p.out);
    if (!params) return json(res, 500, { error: 'escrow_params failed', detail: p.out.slice(-400) });
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { buyerId, tier, params, escrowNoteId: null,
      charges: [], settled: false, createdAt: Date.now() });
    console.log(`[session] ${sessionId} buyer=${buyerId} tier=${tier}`);
    json(res, 200, { sessionId, escrowTemplate: {
      sellerRecipient: params.sellerRecipient, sellerTag: params.sellerTag,
      buyerRecipient: params.buyerRecipient, buyerTag: params.buyerTag,
      noteType: params.noteType, faucet: ACCOUNTS.faucet,
      operatorTag: ACCOUNTS.operatorTag, budget: ESCROW_BUDGET,
    } });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/session/escrow') {
    const { sessionId, noteId } = JSON.parse(await readBody(req) || '{}');
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: 'unknown session' });
    s.escrowNoteId = noteId;
    console.log(`[session] ${sessionId} escrow=${noteId}`);
    json(res, 200, { ok: true, budget: ESCROW_BUDGET });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    const emit = ndjsonHead(res);
    try {
      const { sessionId, prompt, tier } = JSON.parse(await readBody(req) || '{}');
      const s = sessions.get(sessionId);
      if (!s) throw new Error('unknown session');
      if (!s.escrowNoteId) throw new Error('session has no escrow yet');
      if (s.settled) throw new Error('session already settled');
      if (!prompt) throw new Error('missing prompt');
      const msgTier = tier || s.tier;
      if (busy) throw new Error('BUSY');
      busy = true;
      try {
        const spent = s.charges.reduce((a, c) => a + c.charge, 0);
        console.log(`[chat] tier=${msgTier} "${prompt.slice(0, 60)}"`);
        sellerBroadcast('job_started', { tier: msgTier, model: TIERS[msgTier].models[0] });
        const result = await runAnswer(prompt, msgTier, stage => emit({ type: 'stage', stage }));
        if (spent + result.charge > ESCROW_BUDGET) {
          throw new Error(`budget exhausted: ${spent} + ${result.charge} > ${ESCROW_BUDGET}`);
        }
        s.charges.push(result);
        sellerStats.replies += 1;
        sellerStats.earned += result.charge;
        sellerBroadcast('job_done', { tier: msgTier, model: result.model,
          tokens: result.tokens, charge: result.charge, chargeUsd: usd(result.charge) });
        const totalCharge = spent + result.charge;
        console.log(`[chat] model=${result.model} tokens=${result.tokens} charge=${result.charge}`);
        emit({ type: 'done', reply: result.reply, model: result.model, tier: msgTier,
          tokens: result.tokens, charge: result.charge, chargeUsd: usd(result.charge),
          totalCharge, remaining: ESCROW_BUDGET - totalCharge });
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
      if (!s.escrowNoteId) throw new Error('session has no escrow');
      if (s.settled) throw new Error('already settled');
      const charge = s.charges.reduce((a, c) => a + c.charge, 0);
      emit({ type: 'stage', stage: 'settle' });
      console.log(`[settle] ${sessionId} charge=${charge}`);
      const r = await run(path.join(MIDEN_BIN, 'settle_session'), [
        '--note-id', s.escrowNoteId, '--charge', String(charge),
        '--buyer', s.buyerId,
        '--seller-serial', s.params.sellerSerial.join(','),
        '--buyer-serial', s.params.buyerSerial.join(','),
      ], MIDEN_INT, process.env, 480000);
      const settled = lastJson(r.out);
      if (r.code !== 0 || !settled) {
        throw new Error('settlement failed: ' + r.out.slice(-400));
      }
      s.settled = true;
      sellerStats.settled += 1;
      sellerBroadcast('session_settled', { charge, chargeUsd: usd(charge),
        txId: settled.txId, explorer: settled.explorer });
      console.log(`[settle] ${sessionId} tx=${settled.txId}`);
      emit({ type: 'done', txId: settled.txId, charge, refund: settled.refund,
        chargeUsd: usd(charge), refundUsd: usd(settled.refund),
        sellerNoteId: settled.sellerNoteId, buyerNoteId: settled.buyerNoteId,
        buyerSerial: s.params.buyerSerial,
        links: {
          tx: settled.explorer,
          sellerNote: settled.sellerNoteId ? `https://testnet.midenscan.com/note/${settled.sellerNoteId}` : null,
          buyerNote: settled.buyerNoteId ? `https://testnet.midenscan.com/note/${settled.buyerNoteId}` : null,
        } });
    } catch (e) {
      console.error('[settle] error:', e.message);
      emit({ type: 'done', error: String(e.message || e) });
    }
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/faucet/fund') {
    const { buyerId } = JSON.parse(await readBody(req) || '{}');
    if (!buyerId) return json(res, 400, { error: 'missing buyerId' });
    console.log(`[fund] ${buyerId}`);
    const r = await run(path.join(MIDEN_BIN, 'fund_buyer'),
      ['--buyer', buyerId, '--amount', String(FUND_AMOUNT)], MIDEN_INT, process.env, 240000);
    const out = lastJson(r.out);
    if (r.code !== 0 || !out) return json(res, 500, { error: 'mint failed', detail: r.out.slice(-400) });
    json(res, 200, { ...out, amount: FUND_AMOUNT });
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
  console.log(`accounts: seller=${ACCOUNTS.seller} operator=${ACCOUNTS.operator} faucet=${ACCOUNTS.faucet}`);
  warm();
});
