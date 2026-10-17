// Fictional sample library used by all mockups. Designers and models are invented.
window.LIB = (() => {
  const T = 'assets/thumbs/';
  const designers = {
    k3rn3l:       { name: 'k3rn3l',         color: '#f5a524', models: 12, printed: 8,  platforms: ['printables', 'makerworld'] },
    MakerMia:     { name: 'MakerMia',       color: '#e4729b', models: 9,  printed: 5,  platforms: ['makerworld'] },
    NordicPrints: { name: 'NordicPrints',   color: '#5b9cff', models: 14, printed: 9,  platforms: ['printables', 'thangs'] },
    voidstar:     { name: 'voidstar',       color: '#7c5cff', models: 21, printed: 11, platforms: ['printables', 'thingiverse'] },
    FlexiFab:     { name: 'FlexiFab',       color: '#3ecf8e', models: 6,  printed: 6,  platforms: ['thingiverse', 'makerworld'] },
    LumenLab:     { name: 'LumenLab',       color: '#ff7a45', models: 4,  printed: 2,  platforms: ['makerworld', 'printables'] },
    PropForge:    { name: 'PropForge',      color: '#9aa3b2', models: 3,  printed: 0,  platforms: ['thangs'] },
    TinyLegion:   { name: 'TinyLegion',     color: '#c7623f', models: 38, printed: 27, platforms: ['thangs'] },
    BoatWorksLab: { name: 'BoatWorks Lab',  color: '#2aa198', models: 2,  printed: 2,  platforms: ['thingiverse'] },
    You:          { name: 'You',            color: '#4b5563', models: 17, printed: 15, platforms: ['own'] },
  };
  const M = (id, title, designer, source, license, opts = {}) => ({
    id, title, designer, source, license,
    img: T + id + '.jpg', photo: opts.photo ? T + id + '-photo.jpg' : null,
    printed: opts.printed || 0, files: opts.files || 5, tags: opts.tags || [], material: opts.material || 'PLA',
    added: opts.added || '3 days ago', fav: !!opts.fav, has3mf: opts.has3mf !== false, profile: !!opts.profile,
    category: opts.category || 'Household',
  });
  const models = [
    M('gridfinity-baseplate', 'Gridfinity Baseplate 4×3 (screw-down)', 'k3rn3l', 'printables', 'CC BY-NC-SA 4.0', { printed: 3, files: 14, tags: ['gridfinity', 'organizer', 'workshop'], added: '2 hours ago', fav: true, profile: true, photo: true, category: 'Organization' }),
    M('benchy', 'Calibration Boat', 'BoatWorksLab', 'thingiverse', 'CC BY-ND 4.0', { printed: 5, files: 2, tags: ['calibration', 'benchmark'], added: '1 year ago', photo: true, category: 'Calibration' }),
    M('ripple-vase', 'Ripple Spiral Vase (vase mode)', 'MakerMia', 'makerworld', 'CC BY 4.0', { printed: 1, files: 3, tags: ['vase', 'decor', 'vase-mode'], material: 'PLA Silk', added: 'yesterday', profile: true, photo: true, category: 'Decor' }),
    M('phone-stand', 'Minimal Phone Stand', 'NordicPrints', 'thangs', 'CC0 1.0', { printed: 2, files: 3, tags: ['desk', 'phone'], added: '5 days ago', photo: true, category: 'Desk' }),
    M('gears', 'Planetary Gear Set 3:1', 'voidstar', 'printables', 'CC BY-SA 4.0', { printed: 0, files: 9, tags: ['mechanical', 'gear', 'functional'], material: 'PETG', added: '3 days ago', profile: true, category: 'Tools' }),
    M('hex-bit-holder', 'Hex Bit Holder 18×', 'k3rn3l', 'printables', 'CC BY-NC-SA 4.0', { printed: 1, files: 4, tags: ['workshop', 'tools', 'organizer'], added: '2 weeks ago', photo: true, category: 'Tools' }),
    M('planter', 'Faceted Planter 90 mm', 'MakerMia', 'makerworld', 'CC BY-NC 4.0', { printed: 2, files: 2, tags: ['planter', 'decor', 'garden'], added: '1 week ago', photo: true, category: 'Decor' }),
    M('articulated-snake', 'Articulated Snake (print in place)', 'FlexiFab', 'thingiverse', 'CC BY-NC 4.0', { printed: 4, files: 3, tags: ['flexi', 'toy', 'print-in-place'], added: '2 weeks ago', fav: true, photo: true, category: 'Toys & Games' }),
    M('storage-box', 'Stackable Storage Box with Lid', 'NordicPrints', 'printables', 'CC BY 4.0', { printed: 0, files: 6, tags: ['storage', 'organizer'], added: '4 days ago', profile: true, category: 'Organization' }),
    M('lamp-shade', 'Lattice Lamp Shade E27', 'LumenLab', 'makerworld', 'Standard Digital File', { printed: 1, files: 2, tags: ['lamp', 'decor', 'lighting'], material: 'PETG', added: '3 weeks ago', profile: true, category: 'Decor' }),
    M('helmet', 'Sci-Fi Helmet (wearable, 6 parts)', 'PropForge', 'thangs', 'CC BY-NC-SA 4.0', { printed: 0, files: 11, tags: ['cosplay', 'prop', 'wearable'], added: '6 days ago', category: 'Cosplay' }),
    M('knob', 'Knurled Knob M6', 'voidstar', 'printables', 'CC BY 4.0', { printed: 8, files: 5, tags: ['knob', 'hardware', 'functional'], material: 'PETG', added: '2 months ago', category: 'Tools' }),
    M('fidget-knot', 'Fidget Knot Toy', 'FlexiFab', 'makerworld', 'CC BY 4.0', { printed: 2, files: 1, tags: ['fidget', 'toy'], material: 'TPU', added: '1 month ago', category: 'Toys & Games' }),
    M('keychain', 'Custom Keychain Tag (OpenSCAD)', 'You', 'own', 'Private', { printed: 10, files: 4, tags: ['keychain', 'gift', 'openscad'], added: '3 months ago', category: 'Gifts' }),
    M('miniature', 'Shield Bearer Miniature 32 mm', 'TinyLegion', 'thangs', 'Standard Digital File', { printed: 12, files: 3, tags: ['miniature', 'tabletop', 'fantasy'], material: 'Resin', added: '2 months ago', category: 'Tabletop' }),
    M('pi-case', 'Raspberry Pi 5 Case (vented)', 'k3rn3l', 'printables', 'CC BY-NC-SA 4.0', { printed: 1, files: 7, tags: ['electronics', 'case', 'raspberry-pi'], added: '1 week ago', profile: true, photo: true, category: 'Electronics' }),
    M('spool-holder', 'Spool Holder (608 bearing)', 'voidstar', 'thingiverse', 'CC BY 4.0', { printed: 1, files: 5, tags: ['printer', 'spool', 'workshop'], material: 'PETG', added: '5 months ago', category: 'Printer parts' }),
    M('wall-hook', 'Wall Hook Double', 'NordicPrints', 'makerworld', 'CC0 1.0', { printed: 6, files: 2, tags: ['hook', 'household'], added: '2 weeks ago', category: 'Household' }),
    M('dice', 'Polyhedral Dice Set', 'TinyLegion', 'thangs', 'CC BY-NC 4.0', { printed: 1, files: 7, tags: ['dice', 'tabletop'], material: 'Resin', added: '3 weeks ago', photo: true, category: 'Tabletop' }),
    M('headphone-stand', 'Headphone Stand Arc', 'LumenLab', 'printables', 'CC BY-NC 4.0', { printed: 0, files: 3, tags: ['desk', 'audio'], added: '2 days ago', photo: true, category: 'Desk' }),
    M('cable-clip', 'Cable Clips 3-pack', 'You', 'own', 'Private', { printed: 10, files: 3, tags: ['desk', 'cable', 'household'], added: '4 months ago', fav: true, category: 'Desk' }),
  ];
  const byId = Object.fromEntries(models.map(m => [m.id, m]));
  const collections = [
    { id: 'workshop', title: 'Workshop organisation', items: ['gridfinity-baseplate', 'hex-bit-holder', 'storage-box', 'spool-holder'], count: 23, updated: '2 days ago', pinned: true },
    { id: 'desk', title: 'Desk setup', items: ['headphone-stand', 'phone-stand', 'cable-clip', 'pi-case'], count: 11, updated: '3 days ago', pinned: true },
    { id: 'gifts', title: 'Gifts 2026', items: ['keychain', 'ripple-vase', 'planter', 'dice'], count: 8, updated: '1 week ago', pinned: true },
    { id: 'print-next', title: 'Print next', smart: true, rules: ['printed = 0', 'has 3mf', 'added < 30d'], items: ['gears', 'headphone-stand', 'storage-box', 'helmet'], count: 17, updated: 'live' },
    { id: 'gridfinity', title: 'Gridfinity', smart: true, rules: ['tag: gridfinity'], items: ['gridfinity-baseplate', 'hex-bit-holder', 'storage-box', 'knob'], count: 147, updated: 'live' },
    { id: 'tabletop', title: 'Tabletop & minis', items: ['miniature', 'dice', 'helmet', 'fidget-knot'], count: 64, updated: '5 days ago' },
    { id: 'flexi', title: 'Flexi toys', items: ['articulated-snake', 'fidget-knot', 'dice', 'keychain'], count: 9, updated: '2 weeks ago' },
    { id: 'resin', title: 'Resin only', smart: true, rules: ['material = Resin'], items: ['miniature', 'dice', 'helmet', 'knob'], count: 41, updated: 'live' },
    { id: 'calibration', title: 'Calibration & tests', items: ['benchy', 'knob', 'gears', 'cable-clip'], count: 6, updated: '1 month ago' },
    { id: 'lighting', title: 'Lighting', items: ['lamp-shade', 'ripple-vase', 'planter', 'wall-hook'], count: 5, updated: '3 weeks ago' },
    { id: 'own', title: 'My designs', smart: true, rules: ['designer = You'], items: ['keychain', 'cable-clip', 'knob', 'phone-stand'], count: 17, updated: 'live' },
  ];
  return { designers, models, byId, collections };
})();
