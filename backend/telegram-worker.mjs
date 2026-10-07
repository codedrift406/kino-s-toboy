// Cloudflare Worker. Bind DB to D1 and store the two TELEGRAM_* values as secrets.
const ALLOWED_ORIGIN = 'https://codedrift406.github.io';
const INVITATION_URL = `${ALLOWED_ORIGIN}/kino-s-toboy/`;
const MAX_BODY_BYTES = 512;
const TELEGRAM_TIMEOUT_MS = 8_000;
const LEASE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SQL = {
  insert: `INSERT INTO cinema_replies (request_id, status, created_at, updated_at)
    VALUES (?1, 'pending', ?2, ?2)
    ON CONFLICT(request_id) DO NOTHING
    RETURNING request_id, status, created_at, updated_at`,
  claim: `UPDATE cinema_replies
    SET status = 'pending',
        updated_at = CASE WHEN updated_at >= ?2 THEN updated_at + 1 ELSE ?2 END
    WHERE request_id = ?1
      AND (status = 'failed' OR (status = 'pending' AND updated_at <= ?3))
    RETURNING request_id, status, created_at, updated_at`,
  read: `SELECT status, updated_at FROM cinema_replies WHERE request_id = ?1`,
  delivered: `UPDATE cinema_replies
    SET status = 'delivered', updated_at = ?3, telegram_message_id = ?4
    WHERE request_id = ?1 AND status = 'pending' AND updated_at = ?2
    RETURNING request_id`,
  failed: `UPDATE cinema_replies
    SET status = 'failed', updated_at = ?3
    WHERE request_id = ?1 AND status = 'pending' AND updated_at = ?2
    RETURNING request_id`,
};

function json(body, status, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...extraHeaders,
  };
  if (origin === ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(status, error, origin, retryable = false, retryAfter = 0, extraHeaders = {}) {
  const body = { delivered: false, error, retryable };
  if (retryAfter) {
    body.retryAfter = retryAfter;
    extraHeaders['Retry-After'] = String(retryAfter);
  }
  return json(body, status, origin, extraHeaders);
}

async function readReply(request) {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return { status: 415, error: 'invalid_content_type' };

  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return { status: /^\d+$/.test(length) ? 413 : 400, error: 'invalid_body_size' };
  }
  if (!request.body) return { status: 400, error: 'invalid_request' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { status: 413, error: 'invalid_body_size' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const reply = JSON.parse(text);
    if (!reply || Array.isArray(reply) || typeof reply !== 'object'
      || Object.keys(reply).length !== 2
      || reply.answer !== 'yes'
      || typeof reply.requestId !== 'string'
      || !UUID.test(reply.requestId)) {
      return { status: 400, error: 'invalid_request' };
    }
    return { requestId: reply.requestId.toLowerCase() };
  } catch {
    return { status: 400, error: 'invalid_request' };
  } finally {
    reader.releaseLock();
  }
}

async function notifyTelegram(env, createdAt) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('deadline'));
    }, TELEGRAM_TIMEOUT_MS);
  });

  const send = async () => {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      // workerd supports manual redirects; the non-2xx check below rejects them.
      redirect: 'manual',
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `💗 На приглашении для Ақерке нажали «Да».\n🎬 Можно договариваться о свидании!\n🕒 ${new Date(createdAt).toISOString()}\n${INVITATION_URL}`,
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!response.ok) return { ok: false, uncertain: false };
    const data = await response.json();
    if (data?.ok !== true) return { ok: false, uncertain: false };
    const messageId = data.result?.message_id;
    return { ok: true, messageId: Number.isSafeInteger(messageId) ? messageId : null };
  };

  try {
    return await Promise.race([send(), deadline]);
  } catch {
    // A network failure, invalid response, or timeout may follow actual delivery.
    // Keep its lease pending so an immediate retry cannot overlap that attempt.
    return { ok: false, uncertain: true, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function replyToInvitation(request, env, origin) {
  const reply = await readReply(request);
  if (reply.error) return failure(reply.status, reply.error, origin);
  if (typeof env?.TELEGRAM_BOT_TOKEN !== 'string' || !env.TELEGRAM_BOT_TOKEN.trim()
    || typeof env?.TELEGRAM_CHAT_ID !== 'string' || !env.TELEGRAM_CHAT_ID.trim()
    || typeof env?.DB?.prepare !== 'function') {
    return failure(503, 'not_configured', origin, true);
  }

  const { requestId } = reply;
  let lease;
  try {
    const now = Date.now();
    // Each claim is a single atomic statement; updated_at also fences old attempts.
    lease = await env.DB.prepare(SQL.insert).bind(requestId, now).first();
    if (!lease) {
      lease = await env.DB.prepare(SQL.claim).bind(requestId, now, now - LEASE_MS).first();
    }
    if (!lease) {
      const existing = await env.DB.prepare(SQL.read).bind(requestId).first();
      if (existing?.status === 'delivered') return json({ delivered: true }, 200, origin);
      if (existing?.status === 'pending') {
        const retryAfter = Math.max(1, Math.ceil((existing.updated_at + LEASE_MS - now) / 1000));
        return failure(409, 'request_in_progress', origin, true, retryAfter);
      }
      return failure(503, 'storage_unavailable', origin, true);
    }
  } catch {
    return failure(503, 'storage_unavailable', origin, true);
  }

  const notification = await notifyTelegram(env, lease.created_at);
  if (!notification.ok) {
    if (!notification.uncertain) {
      try {
        await env.DB.prepare(SQL.failed)
          .bind(requestId, lease.updated_at, Math.max(Date.now(), lease.updated_at + 1)).first();
      } catch {
        return failure(503, 'storage_unavailable', origin, true, 60);
      }
    }
    return failure(notification.timedOut ? 504 : 502,
      notification.timedOut ? 'notification_timeout' : 'notification_failed',
      origin, true, notification.uncertain ? 60 : 0);
  }

  try {
    const saved = await env.DB.prepare(SQL.delivered)
      .bind(requestId, lease.updated_at, Math.max(Date.now(), lease.updated_at + 1), notification.messageId)
      .first();
    if (!saved) return failure(503, 'storage_unavailable', origin, true, 60);
  } catch {
    return failure(503, 'storage_unavailable', origin, true, 60);
  }
  return json({ delivered: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    const origin = request.headers.get('Origin');
    if (pathname === '/health' && request.method === 'GET') {
      return json({ status: 'ok' }, 200, origin);
    }
    if (pathname !== '/api/reply') return failure(404, 'not_found', origin);
    if (origin !== ALLOWED_ORIGIN) return failure(403, 'origin_not_allowed', origin);

    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'POST') {
        return failure(405, 'method_not_allowed', origin, false, 0, { Allow: 'POST, OPTIONS' });
      }
      const requestedHeaders = request.headers.get('Access-Control-Request-Headers') || '';
      if (requestedHeaders.split(',').some(header => header.trim() && header.trim().toLowerCase() !== 'content-type')) {
        return failure(403, 'cors_headers_not_allowed', origin);
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        },
      });
    }
    if (request.method !== 'POST') {
      return failure(405, 'method_not_allowed', origin, false, 0, { Allow: 'POST, OPTIONS' });
    }
    // Errors returned to the browser are fixed codes; never return/log upstream errors.
    return replyToInvitation(request, env, origin);
  },
};
