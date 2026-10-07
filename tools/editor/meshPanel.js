// ED-MESH-01c: mesh properties use world-space origin, not prop x/y/z.
export function renderMeshPanel(container, item, { assets, onFieldCommit, onRename }) {
  container.textContent = '';
  const header = document.createElement('div');
  header.className = 'insp-header'; header.textContent = `▦ ${item.id} — Mesh`;
  container.appendChild(header);
  const error = document.createElement('div'); error.className = 'insp-error'; container.appendChild(error);
  const field = (label, type, value, commit) => {
    const row = document.createElement('label'); row.className = 'insp-field-row';
    const title = document.createElement('span'); title.className = 'insp-field-label'; title.textContent = label; row.appendChild(title);
    const input = document.createElement('input'); input.type = type; input.dataset.meshField = label;
    if (type === 'checkbox') input.checked = value; else input.value = value;
    if (type === 'number') input.step = label === 'yawDeg' ? '1' : '0.01';
    input.addEventListener(type === 'checkbox' ? 'change' : 'blur', () => {
      const next = type === 'checkbox' ? input.checked : type === 'number' ? (input.value.trim() ? Number(input.value) : NaN) : input.value;
      if (next === value) { error.textContent = ''; return; }
      const result = commit(next);
      error.textContent = Array.isArray(result) ? result.join('; ') : '';
    });
    row.appendChild(input); container.appendChild(row);
    return input;
  };
  field('id', 'text', item.id, id => { let message = ''; onRename(id, msg => { message = msg; }); return message ? [message] : []; });
  const mesh = document.createElement('div'); mesh.className = 'insp-field-row'; mesh.textContent = item.mesh; container.appendChild(mesh);
  for (const axis of ['x', 'y', 'z']) field(axis, 'number', item.origin[axis], value => onFieldCommit({ origin: { ...item.origin, [axis]: value } }));
  field('yawDeg', 'number', item.yawDeg, value => onFieldCommit({ yawDeg: value }));
  const meshDef = assets.mesh(item.mesh);
  for (const key of ['castShadow', 'collide']) {
    const unavailable = key === 'collide' && meshDef.collide === false;
    const input = field(key, 'checkbox', unavailable ? false : item[key] ?? meshDef[key] ?? true, value => onFieldCommit({ [key]: value }));
    input.disabled = unavailable;
    input.title = unavailable ? 'This mesh asset has collision disabled; placement cannot enable it.'
      : key === 'castShadow' ? 'Cast shadows from this placement.' : 'Saved to content; placement collision changes await gameplay support.';
  }
  const note = document.createElement('div'); note.className = 'insp-field-row';
  note.textContent = 'Collision changes are saved; gameplay support pending.';
  container.appendChild(note);
}
