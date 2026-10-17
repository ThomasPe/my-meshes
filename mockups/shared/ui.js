// Tiny render helpers so the mockup pages stay readable. No framework, no build step.
(function () {
  const L = window.LIB;
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    heart: '<path d="M19.5 12.6 12 20l-7.5-7.4a4.6 4.6 0 0 1 6.5-6.5l1 1 1-1a4.6 4.6 0 0 1 6.5 6.5Z"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    files: '<path d="M8 7V5a2 2 0 0 1 2-2h5l4 4v8a2 2 0 0 1-2 2h-1"/><path d="M5 7h7l3 3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    cube: '<path d="M21 8.5 12 3 3 8.5v8L12 21l9-4.5Z"/><path d="M3 8.5 12 13l9-4.5M12 13v8"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    gridSm: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z"/>',
    pin: '<path d="M12 17v5M8 7l1 5-3 3h12l-3-3 1-5M7 7h10M9 3h6v4H9Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    upload: '<path d="M12 15V3m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tag: '<path d="M3 12V4h8l9 9-8 8-9-9Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/>',
    home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M3 12h18"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16Z"/><path d="m13 7 4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    hash: '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/>',
    package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    ruler: '<path d="m3 16 13-13 5 5L8 21Z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>',
    wand: '<path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM3 21 14 10M19 14l.7 1.3L21 16l-1.3.7L19 18l-.7-1.3L17 16l1.3-.7Z"/>',
    arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;

  const SRC = { printables: ['P', 'Printables'], makerworld: ['MW', 'MakerWorld'], thingiverse: ['T', 'Thingiverse'], thangs: ['Th', 'Thangs'], own: ['Me', 'Own design'] };
  const src = (key, cls = '') => `<span class="src ${key} ${cls}" title="${SRC[key][1]}">${SRC[key][0]}</span>`;
  const srcName = key => SRC[key][1];

  const avatar = (key, cls = '') => {
    const d = L.designers[key] || { name: key, color: '#4b5563' };
    const initials = d.name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="avatar ${cls}" style="background:${d.color}">${initials}</span>`;
  };
  const designerName = key => (L.designers[key] || { name: key }).name;

  function card(m, opts = {}) {
    const extra = (opts.selected ? ' selected' : '') + (opts.hover ? ' hover' : '');
    const printed = m.printed > 0 ? `<span class="badge ok">${icon('check', 'sm')} Printed${m.printed > 1 ? ' ×' + m.printed : ''}</span>` : '';
    const img = opts.photo && m.photo ? m.photo : m.img;
    const quick = opts.hover ? `<div class="quick"><button class="btn">${icon('cube')} Open in slicer</button><button class="btn dark">${icon('folder')}</button><button class="btn dark">${icon('more')}</button></div>` : '';
    const metaRight = opts.metaRight || `${icon('files', 'sm')} ${m.files}`;
    return `<article class="card${extra}">
      <div class="thumb"><img src="${img}" alt="">
        <div class="tl">${printed}</div>
        <div class="tr"><span class="heart${m.fav ? ' on' : ''}">${icon('heart', 'sm')}</span></div>
        ${quick}
      </div>
      <div class="body">
        <div class="title">${m.title}</div>
        <div class="by">${avatar(m.designer)}<span class="name">${designerName(m.designer)}</span>${src(m.source)}</div>
        <div class="meta"><span>${icon('clock', 'sm')} ${m.added}</span>${m.has3mf ? '<span class="tag" style="height:18px">3MF</span>' : ''}<span class="right">${metaRight}</span></div>
      </div>
    </article>`;
  }

  function board(c, opts = {}) {
    const imgs = c.items.map(id => L.byId[id].img);
    const cover = `<div class="cover">
      <img class="big" src="${imgs[0]}" alt=""><img src="${imgs[1]}" alt=""><img src="${imgs[2]}" alt="">
      ${c.smart ? `<span class="badge dark">${icon('bolt', 'sm')} Smart</span>` : ''}
    </div>`;
    const rules = c.smart ? `<div class="rules">${c.rules.map(r => `<span class="tag">${r}</span>`).join('')}</div>` : '';
    const sub = c.smart ? `${c.count} models · updates live` : `${c.count} models · updated ${c.updated}`;
    return `<article class="board${opts.cls ? ' ' + opts.cls : ''}">${cover}<div class="body">
      <div class="title">${c.pinned ? icon('pin', 'sm') : ''}${c.title}</div>
      <div class="sub">${sub}</div>${rules}</div></article>`;
  }

  function titlebar() {
    return `<div class="titlebar">
      <div class="logo"><span class="mark">${icon('cube', 'sm')}</span> My Meshes</div>
      <div class="menu"><span>File</span><span>Edit</span><span>View</span><span>Library</span><span>Help</span></div>
      <div class="spacer"></div>
      <div class="controls"><span>—</span><span>☐</span><span class="close">✕</span></div>
    </div>`;
  }

  function topnav(active, opts = {}) {
    const items = [['home', 'Home'], ['browse', 'Browse'], ['collections', 'Collections'], ['designers', 'Designers'], ['makes', 'Makes']];
    return `<header class="topnav">
      <div class="brand"><span class="mark">${icon('cube')}</span> My Meshes</div>
      <nav>${items.map(([k, l]) => `<a class="${k === active ? 'active' : ''}" href="#">${l}</a>`).join('')}</nav>
      <div class="search">${icon('search')}<span>${opts.search || 'Search your library — titles, tags, designers, file names'}</span><span class="kbd">Ctrl K</span></div>
      <div class="right">
        <div class="sync"><span class="dot"></span>Synced · 2 min ago</div>
        <button class="iconbtn bordered" title="Inbox">${icon('inbox')}</button>
        <button class="btn primary">${icon('plus')} Import</button>
        <button class="iconbtn">${icon('settings')}</button>
      </div>
    </header>`;
  }

  function statusbar(left, right) {
    return `<footer class="statusbar"><span>${left}</span><span class="right">${right}</span></footer>`;
  }

  window.UI = { icon, src, srcName, avatar, designerName, card, board, titlebar, topnav, statusbar };
})();
