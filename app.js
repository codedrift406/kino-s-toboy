'use strict';
const invitation = document.querySelector('#invitation');
const celebration = document.querySelector('#celebration');
const yesButton = document.querySelector('#yes-button');
const noButton = document.querySelector('#no-button');
const note = document.querySelector('#playful-note');
const restart = document.querySelector('#restart-button');
const confetti = document.querySelector('#confetti');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let escapes = 0;
let lastEscape = 0;
let celebrating = false;
let cleanupTimer;
const jokes = ['Ой, эта кнопка немного стесняется…', 'У неё, кажется, свои планы на вечер.', 'Котик попросил её не мешать 💗', 'Ладно, ты почти её поймала!', 'Попкорн уже на стороне «да».', 'Она просто очень любит догонялки.'];
function flee(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (celebrating) return;
  const now = performance.now();
  if (now - lastEscape < 90) return;
  lastEscape = now;
  const bounds = noButton.getBoundingClientRect();
  const yesBounds = yesButton.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport ? viewport.width : window.innerWidth;
  const height = viewport ? viewport.height : window.innerHeight;
  const offsetX = viewport ? viewport.offsetLeft : 0;
  const offsetY = viewport ? viewport.offsetTop : 0;
  const margin = 18;
  const maxX = Math.max(margin, width - bounds.width - margin);
  const maxY = Math.max(margin, height - bounds.height - margin);
  const pointerX = event && Number.isFinite(event.clientX) ? event.clientX : bounds.left + bounds.width / 2;
  const pointerY = event && Number.isFinite(event.clientY) ? event.clientY : bounds.top + bounds.height / 2;
  let best = { x: margin, y: margin, score: -Infinity };
  for (let i = 0; i < 40; i++) {
    const x = offsetX + margin + Math.random() * Math.max(0, maxX - margin);
    const y = offsetY + margin + Math.random() * Math.max(0, maxY - margin);
    const overlapsYes = x < yesBounds.right + 20 && x + bounds.width > yesBounds.left - 20 && y < yesBounds.bottom + 20 && y + bounds.height > yesBounds.top - 20;
    if (overlapsYes) continue;
    const distanceFromPointer = Math.hypot(x + bounds.width / 2 - pointerX, y + bounds.height / 2 - pointerY);
    const distanceFromOld = Math.hypot(x - bounds.left, y - bounds.top);
    const score = Math.min(distanceFromPointer, 400) + Math.min(distanceFromOld, 300) + Math.random() * 130;
    if (score > best.score) best = { x, y, score };
  }
  noButton.style.setProperty('--escape-x', `${Math.round(best.x)}px`);
  noButton.style.setProperty('--escape-y', `${Math.round(best.y)}px`);
  noButton.classList.add('escaped');
  escapes++;
  note.textContent = jokes[Math.min(escapes - 1, jokes.length - 1)];
}
noButton.addEventListener('pointerenter', flee);
noButton.addEventListener('pointerdown', flee);
noButton.addEventListener('click', flee);
noButton.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') flee(event);
});
document.addEventListener('pointermove', event => {
  if (celebrating || event.pointerType === 'touch' || document.documentElement.classList.contains('intro-loading')) return;
  const b = noButton.getBoundingClientRect();
  const distance = Math.hypot(Math.max(b.left - event.clientX, 0, event.clientX - b.right), Math.max(b.top - event.clientY, 0, event.clientY - b.bottom));
  if (distance < 35) flee(event);
});
function resetNo() {
  noButton.classList.remove('escaped');
  noButton.style.removeProperty('--escape-x');
  noButton.style.removeProperty('--escape-y');
}
window.addEventListener('resize', resetNo);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resetNo);
function acceptInvitation() {
  if (celebrating) return { accepted: true };
  celebrating = true;
  resetNo();
  invitation.hidden = true;
  celebration.hidden = false;
  document.title = 'Это свидание! 💗';
  document.querySelector('#success-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  if (!reducedMotion.matches) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const heart = document.createElement('span');
      heart.className = 'confetti-heart';
      heart.textContent = i % 3 ? '♥' : '♡';
      heart.style.setProperty('--left', `${Math.random() * 100}%`);
      heart.style.setProperty('--size', `${14 + Math.random() * 24}px`);
      heart.style.setProperty('--color', ['#e9447e', '#f6a7c5', '#cf3170', '#ed78a4'][i % 4]);
      heart.style.setProperty('--duration', `${2.8 + Math.random() * 2.5}s`);
      heart.style.setProperty('--delay', `${Math.random() * 1.1}s`);
      fragment.appendChild(heart);
    }
    confetti.appendChild(fragment);
    cleanupTimer = window.setTimeout(() => confetti.replaceChildren(), 7000);
  }
  return { accepted: true, message: 'Это свидание! Фильм и дату выберем вместе.' };
}
yesButton.addEventListener('click', acceptInvitation);
restart.addEventListener('click', () => {
  celebrating = false;
  escapes = 0;
  lastEscape = 0;
  celebration.hidden = true;
  invitation.hidden = false;
  resetNo();
  note.textContent = 'Спойлер: котик очень надеется на «да».';
  document.title = 'Пойдём в кино? 💗';
  window.clearTimeout(cleanupTimer);
  confetti.replaceChildren();
  yesButton.focus({ preventScroll: true });
});
const art = document.querySelector('#hero-art');
const kitten = document.querySelector('#kitten-image');
art.addEventListener('pointermove', event => {
  if (reducedMotion.matches || event.pointerType === 'touch') return;
  const b = art.getBoundingClientRect();
  art.style.transform = `perspective(900px) rotateY(${(event.clientX - b.left - b.width / 2) / 65}deg) rotateX(${-(event.clientY - b.top - b.height / 2) / 80}deg)`;
});
art.addEventListener('pointerleave', () => art.style.transform = '');
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'accept_cinema_invitation',
      title: 'Принять приглашение в кино',
      description: 'Принять приглашение и показать билет на свидание. Обновляет только текущую страницу, не отправляет сообщений.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Ожидается пустой объект.');
        return acceptInvitation();
      }
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch {}
}
