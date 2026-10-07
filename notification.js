'use strict';
(() => {
  const configuredEndpoint = window.CINEMA_NOTIFICATION_ENDPOINT;
  let endpoint;
  try {
    if (typeof configuredEndpoint !== 'string' || !configuredEndpoint.trim()) return;
    endpoint = new URL(configuredEndpoint.trim());
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) return;
  } catch {
    return;
  }

  const celebration = document.querySelector('#celebration');
  const successNote = celebration?.querySelector('.success-note');
  if (!successNote) return;

  const storageKey = 'cinema-notification-request-id';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let requestId;
  let inFlight = false;
  let delivered = false;
  let retryButton;

  function ensureUI() {
    if (retryButton) return;
    successNote.classList.add('notification-status');
    successNote.setAttribute('role', 'status');
    successNote.setAttribute('aria-live', 'polite');
    successNote.setAttribute('aria-atomic', 'true');
    retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'notification-retry';
    retryButton.textContent = 'Попробовать ещё раз';
    retryButton.hidden = true;
    retryButton.addEventListener('click', sendNotification);
    successNote.after(retryButton);
  }

  function setStatus(state, message) {
    ensureUI();
    successNote.dataset.notificationState = state;
    successNote.textContent = message;
    retryButton.hidden = state !== 'failed';
    retryButton.disabled = state === 'pending';
  }

  function getRequestId() {
    if (requestId) return requestId;
    try {
      const savedId = window.sessionStorage.getItem(storageKey);
      if (savedId && uuidPattern.test(savedId)) requestId = savedId;
    } catch {
      // A blocked storage area still allows one in-memory ID for this page.
    }
    if (!requestId) {
      requestId = window.crypto.randomUUID();
      try { window.sessionStorage.setItem(storageKey, requestId); } catch {}
    }
    return requestId;
  }

  function showDelivered() {
    setStatus('delivered', 'Твоё «да» уже у меня 💗 Осталось выбрать фильм и договориться о нашем вечере.');
  }

  async function sendNotification() {
    if (delivered) {
      showDelivered();
      return;
    }
    if (inFlight) return;
    inFlight = true;
    setStatus('pending', 'Передаю твоё «да»… 💌');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ answer: 'yes', requestId: getRequestId() }),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error'
      });
      if (!response.ok) throw new Error('Delivery was not confirmed.');
      const result = await response.json();
      if (result?.delivered !== true) throw new Error('Delivery was not confirmed.');
      delivered = true;
      showDelivered();
    } catch {
      const message = controller.signal.aborted
        ? 'Связь немного задержалась. Попробуй ещё раз или напиши мне 💌'
        : 'Не получилось передать твоё «да». Попробуй ещё раз или напиши мне 💌';
      setStatus('failed', message);
    } finally {
      window.clearTimeout(timeout);
      inFlight = false;
    }
  }

  window.addEventListener('cinema-accepted', sendNotification);
})();
