/* Shared helpers for the HTML-only mockups: inline SVG "thumbnails" and a theme toggle.
   No framework, no build step. */
(function () {
  const T = {
    baseplate: '<path d="M8 40 32 28l24 12-24 12z" fill="var(--thumb-fill)"/><path d="M8 40v6l24 12v-6M56 40v6L32 58v-6M32 28v-6l-24 12 24 12 24-12-24-12" /><path d="M14 37l24 12M20 34l24 12M26 31l24 12M26 49l18-9M20 46l18-9M14 43l18-9"/>',
    benchy: '<path d="M6 44h52l-6 10H12z" fill="var(--thumb-fill)"/><path d="M12 44V30h24v14M22 30v-8h8v8M36 36h10l6 8M30 22h-6v-4h6z"/><circle cx="18" cy="37" r="2"/><circle cx="26" cy="37" r="2"/>',
    arm: '<circle cx="16" cy="52" r="6" fill="var(--thumb-fill)"/><path d="M16 46 24 24l16-8 12 12" stroke-width="4"/><circle cx="24" cy="24" r="4" fill="var(--thumb-fill)"/><circle cx="40" cy="16" r="4" fill="var(--thumb-fill)"/><path d="M52 28l6-6M52 28l-2 8M6 58h20"/>',
    vase: '<path d="M24 8h16l-4 8c6 6 10 14 10 22a14 14 0 0 1-28 0c0-8 4-16 10-22z" fill="var(--thumb-fill)"/><path d="M20 30c4 2 8 2 12 0s8-2 12 0M18 40c4 2 10 2 14 0s10-2 14 0M20 50c4 2 8 2 12 0s8-2 12 0"/>',
    stand: '<path d="M14 54h36l-6-10H20z" fill="var(--thumb-fill)"/><path d="M22 44 36 12l12 6-12 26M26 44h14" /><path d="M20 54v4M44 54v4"/>',
    helmet: '<path d="M12 36a20 20 0 0 1 40 0v14H12z" fill="var(--thumb-fill)"/><path d="M12 36h40M20 42h10l4 4h-14zM32 16v8"/><path d="M12 50v4h40v-4"/>',
    clip: '<path d="M10 50h44v6H10z" fill="var(--thumb-fill)"/><path d="M18 50V32a14 14 0 0 1 28 0v6M40 38h8M22 50V32a10 10 0 0 1 20 0v4"/><circle cx="32" cy="32" r="4" fill="var(--thumb-fill)"/>',
    tower: '<path d="M20 58V22l12-10 12 10v36z" fill="var(--thumb-fill)"/><path d="M20 22h24M26 30h12M26 38h12M26 46h12M14 58h36M32 12V6M20 22l-4 4M44 22l4 4"/>'
  };
  document.querySelectorAll('[data-thumb]').forEach((el) => {
    const key = el.getAttribute('data-thumb');
    if (!T[key]) return;
    el.innerHTML =
      '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      T[key] + '</svg>';
  });
  const root = document.documentElement;
  function applyTheme(t) {
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-toggle-theme]').forEach((b) => {
      b.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    });
  }
  const dflt = root.getAttribute('data-default-theme') || 'dark';
  let theme = dflt;
  try { theme = localStorage.getItem('mock-theme') || dflt; } catch (e) {}
  applyTheme(theme);
  document.querySelectorAll('[data-toggle-theme]').forEach((b) => {
    b.addEventListener('click', () => {
      theme = theme === 'light' ? 'dark' : 'light';
      applyTheme(theme);
      try { localStorage.setItem('mock-theme', theme); } catch (e) {}
    });
  });
  document.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.card').forEach((o) => o.classList.remove('selected'));
      c.classList.add('selected');
    });
  });
})();
