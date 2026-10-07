import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../telegram-worker.mjs';

const schemaSql = readFileSync(new URL('../drizzle/0000_yielding_the_order.sql', import.meta.url), 'utf8');

const ORIGIN = 'https://codedrift406.github.io';
const REQUEST_ID = '45e4a125-c111-42b0-8e39-b91b2a7d3ffe';
const NOW = 1_791_465_600_000;

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schemaSql);
  t.after(() => sqlite.close());
  return {
    sqlite,
    prepare(sql) {
      assert.equal(sql.includes(';'), false, 'Only single statements are permitted');
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          // SQLite's ?NNN parameters use numbered bindings; D1 accepts positional ones.
          const bindings = Object.fromEntries(values.map((value, i) => [String(i + 1), value]));
          return { async first() { return statement.get(bindings) || null; } };
        },
      };
    },
  };
}

function environment(t) {
  return { DB: database(t), TELEGRAM_BOT_TOKEN: '123456:fake-test-token', TELEGRAM_CHAT_ID: '987654' };
}

function request(body = { answer: 'yes', requestId: REQUEST_ID }, extra = {}) {
  return new Request('https://notification.example/api/reply', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...extra.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')),
  });
}

function telegramSuccess(messageId = 123) {
  return Response.json({ ok: true, result: { message_id: messageId } });
}

test('valid yes sends only fixed server-owned content and confirms delivery', async t => {
  const env = environment(t);
  t.mock.method(Date, 'now', () => NOW);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bot123456:fake-test-token/sendMessage');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      chat_id: '987654',
      text: `💗 На приглашении для Ақерке нажали «Да».\n🎬 Можно договариваться о свидании!\n🕒 ${new Date(NOW).toISOString()}\n${ORIGIN}/kino-s-toboy/`,
      link_preview_options: { is_disabled: true },
    });
    return telegramSuccess();
  });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delivered: true });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(fetchMock.mock.callCount(), 1);
  const row = env.DB.sqlite.prepare('SELECT * FROM cinema_replies').get();
  assert.equal(row.status, 'delivered');
  assert.equal(row.telegram_message_id, 123);
});

test('a delivered UUID, including different case, does not send again', async t => {
  const env = environment(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => telegramSuccess());
  assert.equal((await worker.fetch(request(), env)).status, 200);
  const duplicate = await worker.fetch(request({ answer: 'yes', requestId: REQUEST_ID.toUpperCase() }), env);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { delivered: true });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('invalid JSON, UUID, answer, and browser-supplied recipients/text are rejected', async t => {
  const env = environment(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => assert.fail('Must not send'));
  for (const body of ['{', null, [], {}, { answer: 'no', requestId: REQUEST_ID },
    { answer: 'yes', requestId: 'invalid' },
    { answer: 'yes', requestId: REQUEST_ID, chat_id: 'attacker' },
    { answer: 'yes', requestId: REQUEST_ID, text: 'arbitrary' }]) {
    const response = await worker.fetch(request(body), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).delivered, false);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM cinema_replies').get().n, 0);
});

test('content type and both declared and actual body sizes are bounded', async t => {
  const env = environment(t);
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Must not send'));
  assert.equal((await worker.fetch(request(undefined, { headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal((await worker.fetch(request(undefined, { headers: { 'Content-Length': '999' } }), env)).status, 413);
  assert.equal((await worker.fetch(request(' '.repeat(513)), env)).status, 413);
  const invalidUtf8 = new Request('https://notification.example/api/reply', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: new Uint8Array([0xff]),
  });
  assert.equal((await worker.fetch(invalidUtf8, env)).status, 400);
});

test('exact origin is required, including for preflight', async t => {
  const env = environment(t);
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Must not send'));
  for (const origin of ['https://evil.example', `${ORIGIN}.evil.example`, 'null', '']) {
    const response = await worker.fetch(request(undefined, { headers: { Origin: origin } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const preflight = await worker.fetch(new Request('https://notification.example/api/reply', {
    method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type' },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
});

test('missing configuration and DB exceptions return no secrets or delivery claim', async t => {
  const env = environment(t);
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Must not send'));
  for (const field of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DB']) {
    const response = await worker.fetch(request(), { ...env, [field]: undefined });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { delivered: false, error: 'not_configured', retryable: true });
  }
  const response = await worker.fetch(request(), {
    ...env, DB: { prepare() { throw new Error(`private ${env.TELEGRAM_BOT_TOKEN}`); } },
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes(env.TELEGRAM_BOT_TOKEN), false);
  assert.equal(JSON.parse(body).delivered, false);
});

test('Telegram HTTP and JSON failures never report delivery; failed rows can retry', async t => {
  const env = environment(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) return Response.json({ ok: false, description: 'secret upstream details' }, { status: 401 });
    if (calls === 2) return Response.json({ ok: false });
    return telegramSuccess();
  });
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { delivered: false, error: 'notification_failed', retryable: true });
    assert.equal(env.DB.sqlite.prepare('SELECT status FROM cinema_replies').get().status, 'failed');
  }
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { delivered: true });
  assert.equal(calls, 3);
});

test('Telegram redirects use manual mode and never report delivery or follow Location', async t => {
  const env = environment(t);
  const redirectStatuses = [301, 302, 303, 307, 308];
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'manual', 'workerd rejects redirect:error');
    assert.equal(url, 'https://api.telegram.org/bot123456:fake-test-token/sendMessage');
    const status = redirectStatuses[calls++];
    return Response.json({ ok: true, result: { message_id: 999 } }, {
      status, headers: { Location: 'https://unexpected.example/redirect-target' },
    });
  });
  for (const _status of redirectStatuses) {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      delivered: false, error: 'notification_failed', retryable: true,
    });
    const row = env.DB.sqlite.prepare('SELECT status, telegram_message_id FROM cinema_replies').get();
    assert.equal(row.status, 'failed');
    assert.equal(row.telegram_message_id, null);
  }
  assert.equal(fetchMock.mock.callCount(), redirectStatuses.length);
});

test('concurrent requests for one UUID acquire only one lease and one send', async t => {
  const env = environment(t);
  let release;
  let entered;
  const sending = new Promise(resolve => { entered = resolve; });
  const fetchMock = t.mock.method(globalThis, 'fetch', () => {
    entered();
    return new Promise(resolve => { release = () => resolve(telegramSuccess()); });
  });
  const first = worker.fetch(request(), env);
  await sending;
  const second = await worker.fetch(request(), env);
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.equal(body.delivered, false);
  assert.equal(body.error, 'request_in_progress');
  assert.ok(body.retryAfter > 0);
  assert.equal(fetchMock.mock.callCount(), 1);
  release();
  assert.equal((await first).status, 200);
});

test('an expired pending lease can be claimed; an old lease cannot overwrite it', async t => {
  const env = environment(t);
  t.mock.method(Date, 'now', () => NOW);
  const stale = NOW - 60_001;
  env.DB.sqlite.prepare('INSERT INTO cinema_replies VALUES (?, ?, ?, ?, NULL)')
    .run(REQUEST_ID, 'pending', stale, stale);
  let release;
  let entered;
  const sending = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', () => {
    entered();
    return new Promise(resolve => { release = () => resolve(telegramSuccess()); });
  });
  const pending = worker.fetch(request(), env);
  await sending;
  assert.equal(env.DB.sqlite.prepare('SELECT updated_at FROM cinema_replies').get().updated_at, NOW);
  const fenced = env.DB.sqlite.prepare(`UPDATE cinema_replies SET status = 'failed'
    WHERE request_id = ? AND status = 'pending' AND updated_at = ?`).run(REQUEST_ID, stale);
  assert.equal(fenced.changes, 0);
  release();
  assert.equal((await pending).status, 200);
});

test('the eight-second deadline aborts Telegram and preserves the uncertain lease', async t => {
  const env = environment(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered;
  let signal;
  const sending = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    entered();
    return new Promise(() => {}); // Even a non-cooperating fetch is bounded by the deadline.
  });
  const pending = worker.fetch(request(), env);
  await sending;
  t.mock.timers.tick(7_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    delivered: false, error: 'notification_timeout', retryable: true, retryAfter: 60,
  });
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM cinema_replies').get().status, 'pending');
  assert.equal((await worker.fetch(request(), env)).status, 409);
});

test('invalid upstream JSON and confirmation-write failure remain recoverable without leaking errors', async t => {
  const env = environment(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{not json'));
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).delivered, false);
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM cinema_replies').get().status, 'pending');

  const otherEnv = environment(t);
  t.mock.method(globalThis, 'fetch', async () => telegramSuccess());
  const originalPrepare = otherEnv.DB.prepare;
  otherEnv.DB.prepare = function (sql) {
    if (sql.includes("SET status = 'delivered'")) throw new Error(`private ${otherEnv.TELEGRAM_BOT_TOKEN}`);
    return originalPrepare.call(this, sql);
  };
  const confirmation = await worker.fetch(request(), otherEnv);
  assert.equal(confirmation.status, 503);
  const text = await confirmation.text();
  assert.equal(text.includes(otherEnv.TELEGRAM_BOT_TOKEN), false);
  assert.equal(JSON.parse(text).delivered, false);
});

test('health is non-sensitive and unmatched paths and methods are rejected', async t => {
  const env = environment(t);
  const health = await worker.fetch(new Request('https://notification.example/health'), env);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await worker.fetch(new Request('https://notification.example/missing'), env)).status, 404);
  const response = await worker.fetch(new Request('https://notification.example/api/reply', {
    headers: { Origin: ORIGIN },
  }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST, OPTIONS');
});
