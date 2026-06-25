// BARTOK bridge: serves the UI and runs the REAL pipeline per chat message.
//   POST /api/chat {prompt}  ->  zkTLS notarize (real model call) -> present -> oracle (charge)
//                                -> Miden settlement (MockChain) -> { reply, model, charge, settled }
//
// Run:  node ux-prototype/server.js   then open http://localhost:8787
// Prereqs: zktls-spike/setup.sh + .env (OpenRouter key) + miden-settlement/install.sh
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATIC = __dirname;
const ROOT = path.resolve(__dirname, '..');
const TLSN = path.join(ROOT, 'zktls-spike', 'tlsn');
const TEMPLATE = process.env.AGENTIC_TEMPLATE || path.join(os.homedir(), 'Code', 'agentic-template');
const PT = path.join(TEMPLATE, 'project-template');
const ENV_FILE = path.join(ROOT, 'zktls-spike', '.env');
const FREE_MODELS = [
  'openai/gpt-oss-20b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
];

function loadKey() {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/OPENROUTER_API_KEY=(\S+)/);
  if (!m) throw new Error('OPENROUTER_API_KEY missing in zktls-spike/.env');
  return m[1];
}
function sh(cmd, cwd, env, timeout = 240000) {
  return execSync(cmd, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

function runPipeline(prompt) {
  const env = { ...process.env, OPENROUTER_API_KEY: loadKey(), PROMPT: prompt,
    RUST_LOG: 'error,openrouter_prove=info' };

  // 1) zkTLS: notarize the real model call (cycle free models until a 200)
  let model = null;
  for (const m of FREE_MODELS) {
    let out = '';
    try { out = sh('cargo run --release --example openrouter_prove', TLSN, { ...env, MODEL: m }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    if (out.includes('Got response: 200')) { model = m; break; }
  }
  if (!model) throw new Error('all free models are rate-limited (429); retry shortly');

  // 2) present (selective disclosure)
  sh('cargo run --release --example openrouter_present', TLSN, env);

  // 3) oracle: verify the proof, derive the charge (= tokens used)
  const oracleOut = sh('cargo run --release --example openrouter_oracle', TLSN, env);
  const charge = parseInt(oracleOut.trim().split('\n').pop(), 10);

  // reply text from the captured response
  let reply = '(no text returned)';
  try {
    const resp = JSON.parse(fs.readFileSync(path.join(TLSN, 'openrouter.response.json'), 'utf8'));
    const msg = resp.choices && resp.choices[0] && resp.choices[0].message;
    reply = (msg && (msg.content || msg.reasoning)) || reply;
  } catch (_) {}

  // 4) Miden settlement (MockChain): split an escrow of 2x the charge
  let settled = false;
  try {
    const out = sh('cargo test -p integration --release --test settlement_split_test', PT,
      { ...process.env, BARTOK_BUDGET: String(charge * 2), BARTOK_CHARGE: String(charge) });
    settled = /test result: ok/.test(out);
  } catch (_) { settled = false; }

  return { reply, model, charge, settled };
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const { prompt } = JSON.parse(body || '{}');
        if (!prompt) throw new Error('missing prompt');
        console.log(`[chat] "${prompt.slice(0, 60)}" ...`);
        const result = runPipeline(prompt);
        console.log(`[chat] model=${result.model} charge=${result.charge} settled=${result.settled}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[chat] error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  // static files
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(STATIC, rel);
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(file);
  const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(file));
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => console.log(`BARTOK bridge -> http://localhost:${PORT}  (open in your browser)`));
