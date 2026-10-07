'use strict';
(() => {
  const intro = document.querySelector('#intro-screen');
  const shell = document.querySelector('.page-shell');
  const image = document.querySelector('#unicorn-image');
  const aperture = document.querySelector('#heart-aperture');
  const skip = document.querySelector('#intro-skip');
  if (!intro || !image || !aperture || !shell) {
    document.documentElement.classList.remove('intro-loading');
    return;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let finished = false;
  let revealing = false;
  let startTimer;
  let fallbackTimer;
  let animationFrame;
  shell.inert = true;
  shell.setAttribute('aria-hidden', 'true');
  function finish() {
    if (finished) return;
    finished = true;
    window.clearTimeout(startTimer);
    window.clearTimeout(fallbackTimer);
    window.cancelAnimationFrame(animationFrame);
    intro.classList.add('finished');
    intro.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('intro-loading');
    shell.inert = false;
    shell.removeAttribute('aria-hidden');
    if (document.activeElement === skip) document.querySelector('#yes-button').focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('invitation-ready'));
  }
  function reveal() {
    if (finished || revealing) return;
    revealing = true;
    window.clearTimeout(startTimer);
    if (reduced.matches) { finish(); return; }
    const heartBounds = document.querySelector('.intro-small-heart').getBoundingClientRect();
    const unit = Math.max(window.innerWidth / 1000, window.innerHeight / 1000);
    const originY = (heartBounds.y + heartBounds.height / 2 - window.innerHeight / 2) / unit;
    const initialScale = Math.max(1, heartBounds.width / (22 * unit));
    intro.classList.add('revealing');
    const start = performance.now();
    const duration = 1250;
    function frame(time) {
      if (finished) return;
      const progress = Math.min(1, (time - start) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      const scale = initialScale + (240 - initialScale) * eased * eased;
      aperture.setAttribute('transform', `translate(0 ${originY}) scale(${scale}) translate(0 3)`);
      if (progress < 1) animationFrame = requestAnimationFrame(frame);
      else finish();
    }
    animationFrame = requestAnimationFrame(frame);
  }
  skip.addEventListener('click', reveal);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !finished) reveal();
  });
  fallbackTimer = window.setTimeout(finish, 10000);
  const ready = image.decode().catch(() => null);
  ready.then(() => {
    if (finished || revealing) return;
    if (!image.naturalWidth) { finish(); return; }
    intro.classList.add(reduced.matches ? 'reduced' : 'arriving');
    startTimer = window.setTimeout(reveal, reduced.matches ? 700 : 3150);
  });
})();
