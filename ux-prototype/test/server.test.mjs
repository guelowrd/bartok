// Integration tests for the bridge's HTTP surface (node --test; zero deps).
// BARTOK_TEST=1 gives fixture accounts, an isolated users store, and stubbed
// Rust/zkTLS externals — so these exercise the real routing, gating, funnel
// ladder, rate limits, CORS, and body caps end to end.
process.env.BARTOK_TEST = '1';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { server, CONFIG } = require('../server.js');

let base;
const RITA = '0x' + 'a'.repeat(30);
const NEWBIE = '0x' + 'b'.repeat(30);

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', body: JSON.stringify(body), headers });
const jpost = async (p, body) => (await post(p, body)).json();

before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => server.close(r)));

test('config exposes the economics the UI needs', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.freeGrant, CONFIG.freeGrantBartok);
  assert.equal(c.usdPerBartok, CONFIG.usdPerBartok);
  assert.ok(c.tiers.basic.hold > 0 && c.tiers.genius.hold > c.tiers.basic.hold);
  assert.equal(c.tiers.genius.requiresAccount, true);
});

test('CORS: preflight allows the guardian client verbs and headers', async () => {
  const r = await fetch(base + '/api/config', { method: 'OPTIONS', headers: {
    Origin: 'https://bartok-ten.vercel.app', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(r.headers.get('access-control-allow-headers'), /ngrok-skip-browser-warning/);
});

test('credits ladder: bad code, order enforcement, once per wallet', async () => {
  assert.equal((await jpost('/api/credits/redeem', { buyerId: RITA, code: 'NOPE' })).error, 'bad_code');
  const wrong = await jpost('/api/credits/redeem', { buyerId: RITA, code: 'ILOVEBARTOK_05' });
  assert.equal(wrong.error, 'wrong_order');
  assert.equal(wrong.next, 'ILOVEBARTOK_00');
  assert.ok((await jpost('/api/credits/redeem', { buyerId: RITA, code: 'ILOVEBARTOK' })).txId);
  assert.ok((await jpost('/api/credits/redeem', { buyerId: RITA, code: 'ILOVEBARTOK_00' })).txId);
  assert.equal((await jpost('/api/credits/redeem', { buyerId: RITA, code: 'ILOVEBARTOK_00' })).error, 'already_redeemed');
  const next = await jpost('/api/credits/redeem', { buyerId: RITA, code: 'ILOVEBARTOK_07' });
  assert.equal(next.next, 'ILOVEBARTOK_01');
});

test('auth-lite: register, duplicate, login right/wrong', async () => {
  assert.equal((await jpost('/api/auth/register', { buyerId: RITA, name: 'Rita', password: 'pw' })).ok, true);
  assert.equal((await jpost('/api/auth/register', { buyerId: RITA, password: 'pw2' })).error, 'exists');
  assert.equal((await jpost('/api/auth/login', { buyerId: RITA, password: 'pw' })).ok, true);
  assert.equal((await jpost('/api/auth/login', { buyerId: RITA, password: 'nope' })).error, 'bad_password');
  const acct = await (await fetch(base + `/api/account?buyerId=${RITA}`)).json();
  assert.equal(acct.hasAccount, true);
  assert.ok(acct.codesUsed >= 2);
});

test('session gates: genius needs an account; hold clamps to balance; floors enforced', async () => {
  const noAcct = await post('/api/session/start', { buyerId: NEWBIE, tier: 'genius', balance: '10000000' });
  assert.equal((await noAcct.json()).error, 'account_required');
  const broke = await post('/api/session/start', { buyerId: NEWBIE, tier: 'basic', balance: '10' });
  assert.equal((await broke.json()).error, 'insufficient_credits');
  const clamped = await jpost('/api/session/start', { buyerId: NEWBIE, tier: 'basic', balance: '30000' });
  assert.equal(clamped.escrowTemplate.budget, 30000);            // min(cap, balance)
  const capped = await jpost('/api/session/start', { buyerId: NEWBIE, tier: 'basic', balance: '9999999' });
  assert.equal(capped.escrowTemplate.budget, CONFIG.holdBartok.basic);
});

test('chat lifecycle: escrow required, then stubbed reply with attested-shape charge', async () => {
  const s = await jpost('/api/session/start', { buyerId: RITA, tier: 'basic', balance: '10000000' });
  const early = await (await post('/api/chat', { sessionId: s.sessionId, prompt: 'hi' })).text();
  assert.match(early, /no escrow yet/);
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  const lines = (await (await post('/api/chat', { sessionId: s.sessionId, prompt: 'hi' })).text()).trim().split('\n');
  const done = JSON.parse(lines[lines.length - 1]);
  assert.equal(done.charge, 42);
  assert.equal(done.model, 'stub-basic');
  assert.ok(lines.length >= 4, 'streams live stage events before done');
});

test('settlement returns the refund rail fields', async () => {
  const s = await jpost('/api/session/start', { buyerId: RITA, tier: 'basic', balance: '10000000' });
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  const lines = (await (await post('/api/session/end', { sessionId: s.sessionId })).text()).trim().split('\n');
  const done = JSON.parse(lines[lines.length - 1]);
  assert.equal(done.settleProposalId, '0xprop');
  assert.equal(typeof done.refundNoteFileB64, 'string');
});

test('refund recovery: settled refunds are retrievable per buyer', async () => {
  const s = await jpost('/api/session/start', { buyerId: RITA, tier: 'basic', balance: '10000000' });
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  await post('/api/session/end', { sessionId: s.sessionId });
  const r = await (await fetch(base + `/api/refunds?buyerId=${RITA}`)).json();
  assert.ok(r.files.includes('cmVmdW5k'), 'stubbed refund file recorded and served');
});

test('transient settle failure: first end fails with settle_retry, retry on the same session succeeds', async () => {
  const FLAKY = '0x' + 'd'.repeat(28) + 'ff';   // triggers one stubbed transient failure
  const s = await jpost('/api/session/start', { buyerId: FLAKY, tier: 'basic', balance: '10000000' });
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  const first = JSON.parse((await (await post('/api/session/end', { sessionId: s.sessionId })).text()).trim().split('\n').pop());
  assert.equal(first.error, 'settle_retry');
  const second = JSON.parse((await (await post('/api/session/end', { sessionId: s.sessionId })).text()).trim().split('\n').pop());
  assert.equal(second.error, undefined, 'retry must succeed (session must stay retryable)');
  assert.equal(second.settleProposalId, '0xprop');
});

test('operator delta wedge: a single end call auto-retries through it and succeeds', async () => {
  const WEDGY = '0x' + 'e'.repeat(30);   // stub wedges twice, then clears
  const s = await jpost('/api/session/start', { buyerId: WEDGY, tier: 'basic', balance: '10000000' });
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  const lines = (await (await post('/api/session/end', { sessionId: s.sessionId })).text()).trim().split('\n');
  const stages = lines.slice(0, -1).map((l) => JSON.parse(l).stage);
  const done = JSON.parse(lines[lines.length - 1]);
  assert.ok(stages.includes('settle_wait'), 'streams the auto-retry stage');
  assert.equal(done.error, undefined, 'auto-retry rides out the wedge');
  assert.equal(done.settleProposalId, '0xprop');
});

test('abandoned sessions: the sweeper auto-settles idle escrowed holds and records the refund', async () => {
  const GHOST = '0x' + '9'.repeat(30);
  const { sweepAbandonedSessions } = require('../server.js');
  const s = await jpost('/api/session/start', { buyerId: GHOST, tier: 'basic', balance: '10000000' });
  await jpost('/api/session/escrow', { sessionId: s.sessionId, noteB64: 'bm90ZQ==' });
  await new Promise((r) => setTimeout(r, 80));            // exceed the test idle threshold (50ms)
  await sweepAbandonedSessions();
  const r = await (await fetch(base + `/api/refunds?buyerId=${GHOST}`)).json();
  assert.ok(r.files.length >= 1, 'sweeper settled the ghost session and recorded its refund');
  // idempotent: a second sweep must not double-settle
  const before = r.files.length;
  await sweepAbandonedSessions();
  const again = await (await fetch(base + `/api/refunds?buyerId=${GHOST}`)).json();
  assert.equal(again.files.length, before, 'settled sessions are not re-swept');
});

test('sessions persist to the snapshot file (crash-restart safety)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const files = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`bartok-test-sessions-${process.pid}`));
  assert.equal(files.length, 1, 'sessions snapshot file exists');
  const snap = JSON.parse(fs.readFileSync(`${os.tmpdir()}/${files[0]}`, 'utf8'));
  assert.ok(Object.keys(snap).length >= 1, 'snapshot contains sessions');
});

test('UI ships the settle-retry affordance (guards against silent copy regressions)', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /retrySettle/, 'Try-again button missing from index.html');
  assert.match(html, /Not wrapped up yet/, 'friendly settle-failure copy missing');
  assert.match(html, /settle_retry/, 'settle_retry error mapping missing');
});

test('abuse guards: oversized body rejected, redeem rate limit kicks in', async () => {
  const big = await fetch(base + '/api/auth/register', { method: 'POST', body: 'x'.repeat(600 * 1024) })
    .then((r) => r.status).catch(() => 'conn-reset');
  assert.ok(big === 400 || big === 'conn-reset');
  let last = 0;
  for (let i = 0; i < 8; i++) last = (await post('/api/credits/redeem',
    { buyerId: '0x' + 'c'.repeat(30), code: 'NOPE' }, { 'x-test-ratelimit': '1' })).status;
  assert.equal(last, 429);
});
