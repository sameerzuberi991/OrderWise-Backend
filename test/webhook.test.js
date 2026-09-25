// Smoke tests for the WhatsApp webhook — no database calls involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Dummy env so db.js doesn't bail; these tests never run a query.
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-key';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';

const { default: app } = await import('../app.js');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('GET /webhook echoes hub.challenge when verify token matches', async () => {
  const res = await fetch(
    `${base}/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345`
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '12345');
});

test('GET /webhook rejects a wrong verify token', async () => {
  const res = await fetch(
    `${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`
  );
  assert.equal(res.status, 403);
});

test('POST /webhook acknowledges non-message payloads (status callbacks)', async () => {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }],
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { replies: [] });
});

test('POST /webhook ignores WaSender echoes of our own outbound (fromMe)', async () => {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.received',
      data: { messages: { key: { fromMe: true }, messageBody: 'hi' } },
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { replies: [] });
});

test('POST /webhook rejects a WaSender payload with a bad signature', async () => {
  process.env.WASENDER_WEBHOOK_SECRET = 'top-secret';
  try {
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'wrong' },
      body: JSON.stringify({
        event: 'messages.received',
        data: { messages: { key: { cleanedSenderPn: '923001234567' }, messageBody: 'hi' } },
      }),
    });
    assert.equal(res.status, 401);
  } finally {
    delete process.env.WASENDER_WEBHOOK_SECRET;
  }
});
