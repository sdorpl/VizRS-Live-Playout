// VizRS Live – formularz z metadanych komend mostu (GET /api/commands).
//
// form(komenda, pola, wartości) buduje formularz: rodzaj kontrolki wynika z typu parametru komendy
// (tekst, liczba, tak/nie, wyliczenie, TimeSpan, data/godzina, lista id), opis pola daje etykietę PL,
// sekcję, źródło listy wyboru i podpowiedź. read() zbiera wartości (rzuca Error z opisem złego pola).

import { h, param, pl, pad2 } from './core.js';

/**
 * Opis pola:
 *   { sec: 'Ogólne' }                                   – nagłówek sekcji
 *   { key, label, kind?, options?, none?, hint?, placeholder?, attrs?, show?(wartości), text? }
 *     hint – tekst albo (wartości) => tekst (przeliczany po każdej zmianie, np. podpowiedź zależna od rodzaju)
 *   { label, group: [pola] }                            – kilka kontrolek w jednym wierszu (np. pola tak/nie)
 *   { key, label, render(wartość, wartości) -> {el, read()} } – kontrolka własna (np. wybór treści)
 * kind: text | number | check | enum | time | datetime | pick | multi (domyślnie z typu parametru komendy)
 * options: [[wartość, etykieta]] dla pick/multi/enum (enum domyślnie z mostu, etykiety z PL).
 */
export function form(cmdName, fields, values = {}, opts = {}) {
  const prefix = opts.idPrefix ?? 'f-';
  const ctl = new Map();        // key -> {read(), el}
  const rows = [];              // {wrap, show}
  const hints = [];             // {el, fn} – podpowiedzi zależne od wartości
  const current = () => ({ ...values, ...Object.fromEntries([...ctl].map(([k, c]) => [k, c.peek()])) });

  const build = (f) => {
    const p = f.key ? param(cmdName, f.key) : null;
    const id = prefix + f.key;
    const label = f.label + (f.unit ? ` (${f.unit})` : '');
    if (f.render) {
      const c = f.render(values[f.key], values);
      ctl.set(f.key, { read: c.read, peek: c.peek || (() => values[f.key]) });
      return c.el;
    }
    const kind = f.kind || inferKind(p, f);
    const optional = f.optional ?? (p ? p.optional : true);
    const c = control(kind, id, values[f.key], { ...f, optional, type: p?.type || '', values: p?.values, label });
    ctl.set(f.key, c);
    return c.el;
  };

  const el = h('div', { class: 'form' });
  const add = (labelEl, ctrlEl, f) => {
    const hintEl = f.hint ? h('div', { class: 'hint' }, typeof f.hint === 'function' ? '' : f.hint) : null;
    if (typeof f.hint === 'function') hints.push({ el: hintEl, fn: f.hint });
    const wrap = h('div', { class: 'row' }, labelEl, ctrlEl, hintEl);
    if (f.show) rows.push({ wrap, show: f.show });
    el.append(wrap);
  };
  for (const f of fields) {
    if (!f) continue;
    if (f.sec) { el.append(h('div', { class: 'sec' }, f.sec)); continue; }
    if (f.group) { add(h('label', null, f.label), h('div', { class: 'bar' }, f.group.map(build)), f); continue; }
    const c = build(f);
    const kind = f.kind || inferKind(f.key ? param(cmdName, f.key) : null, f);
    add(h('label', kind === 'multi' || f.render ? null : { for: prefix + f.key }, f.label + (f.unit ? ` (${f.unit})` : '')), c, f);
  }
  const refresh = () => {
    const v = current();
    for (const r of rows) r.wrap.hidden = !r.show(v);
    for (const x of hints) { const t = x.fn(v) || ''; x.el.textContent = t; x.el.hidden = !t; }
  };
  el.addEventListener('change', refresh);
  el.addEventListener('input', refresh);
  refresh();

  return {
    el,
    /** Wartości formularza nałożone na wartości wejściowe; ukryte pola zostają jak w wartościach wejściowych. */
    read() {
      const out = { ...values };
      const v = current();
      const hidden = new Set();
      // pole grupy jest ukryte, gdy ukryta jest cała grupa
      for (const f of fields.flatMap((x) => (x?.group ? x.group.map((g) => ({ ...g, show: g.show || x.show })) : [x]))) if (f?.show && !f.show(v)) hidden.add(f.key);
      for (const [k, c] of ctl) if (!hidden.has(k)) out[k] = c.read();
      return out;
    },
    peek: current,
  };
}

/** Rodzaj kontrolki z typu parametru mostu. */
function inferKind(p, f) {
  if (f.options) return /^List</.test(p?.type || '') ? 'multi' : 'pick';
  if (!p) return 'text';
  if (p.values) return 'enum';
  const t = p.type.replace(/\?$/, '');
  if (t === 'Boolean') return 'check';
  if (/^(U?Int(16|32|64)|Double|Single|Decimal|Byte)$/.test(t)) return 'number';
  if (t === 'TimeSpan') return 'time';
  if (t === 'DateTime' || t === 'DateTimeOffset' || t === 'DateOnly') return 'datetime';
  return 'text';
}

class FieldError extends Error {}
const fail = (o, el, msg) => { el.focus(); throw new FieldError(`Pole „${o.label}”: ${msg}`); };

function control(kind, id, value, o) {
  switch (kind) {
    case 'check': {
      const el = h('input', { type: 'checkbox', id, checked: !!value });
      const box = h('label', { class: 'chk' }, el, o.text || '');
      return { el: o.text ? box : el, read: () => el.checked, peek: () => el.checked };
    }
    case 'number': {
      const el = h('input', { id, type: 'number', step: o.step || (/Int/.test(o.type) ? 1 : 'any'), value: value ?? '', placeholder: o.placeholder, ...o.attrs });
      const read = () => {
        if (el.value.trim() === '') return o.optional ? null : fail(o, el, 'podaj liczbę');
        const n = Number(el.value);
        if (!Number.isFinite(n)) return fail(o, el, 'to nie jest liczba');
        if (/Int/.test(o.type) && !Number.isInteger(n)) return fail(o, el, 'podaj liczbę całkowitą');
        return n;
      };
      return { el, read, peek: () => (el.value === '' ? null : Number(el.value)) };
    }
    case 'enum':
    case 'pick': {
      const list = o.options || (o.values || []).map((v) => [v, pl(v)]);
      const opts = o.optional && kind === 'pick' ? [[null, o.none || '—'], ...list] : list;
      const el = h('select', { id, ...o.attrs }, opts.map(([v, t]) => h('option', { value: v == null ? '' : String(v) }, t)));
      el.value = value == null ? '' : String(value);
      if (el.selectedIndex < 0 && value != null) {  // wartość spoza listy (np. usunięty profil) – pokaż, nie gub
        el.append(h('option', { value: String(value) }, `${value} (spoza listy)`));
        el.value = String(value);
      }
      const numeric = kind === 'pick' && list.some(([v]) => typeof v === 'number');
      const conv = (s) => (s === '' ? null : numeric ? Number(s) : s);
      const read = () => {
        const v = conv(el.value);
        if (v == null && !o.optional) return fail(o, el, 'wybierz wartość');
        return v;
      };
      return { el, read, peek: () => conv(el.value) };
    }
    case 'multi': {
      const set = new Set(value || []);
      const boxes = (o.options || []).map(([v, t]) => {
        const c = h('input', { type: 'checkbox', value: String(v), checked: set.has(v) });
        return [v, c, h('label', { class: 'chk' }, c, t)];
      });
      const el = h('div', { class: 'multi', id, role: 'group', 'aria-label': o.label },
        boxes.length ? boxes.map((b) => b[2]) : h('span', { class: 'dim' }, o.empty || 'brak pozycji do wyboru'));
      const read = () => boxes.filter((b) => b[1].checked).map((b) => b[0]);
      return { el, read, peek: read };
    }
    case 'time': {
      const el = h('input', { id, value: value == null ? '' : String(value), placeholder: o.placeholder || 'gg:mm:ss', inputmode: 'numeric', class: 'num', ...o.attrs });
      const read = () => {
        const s = el.value.trim();
        if (!s) return o.optional ? null : fail(o, el, 'podaj czas gg:mm:ss');
        const t = parseTimeSpan(s);
        return t ?? fail(o, el, 'czas w postaci gg:mm:ss (np. 06:00:00) albo d.gg:mm:ss');
      };
      return { el, read, peek: () => parseTimeSpan(el.value.trim()) };
    }
    case 'datetime': {
      const el = h('input', { id, type: 'datetime-local', step: 1, value: toLocalInput(value), ...o.attrs });
      const read = () => {
        if (!el.value) return o.optional ? null : fail(o, el, 'podaj datę i godzinę');
        return /Offset/.test(o.type) ? new Date(el.value).toISOString() : (el.value.length === 16 ? el.value + ':00' : el.value);
      };
      return { el, read, peek: () => el.value || null };
    }
    default: {
      const el = h('input', { id, value: value ?? '', placeholder: o.placeholder, ...o.attrs });
      const read = () => {
        if (o.required && !el.value.trim()) return fail(o, el, 'nie może być puste');
        return el.value;
      };
      return { el, read, peek: () => el.value };
    }
  }
}

/** „6:00” → „06:00:00”, „1.02:00:00” zostaje; null, gdy to nie jest czas. */
export function parseTimeSpan(s) {
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s || '');
  if (!m || +m[3] > 59 || (m[4] && +m[4] > 59) || (!m[1] && +m[2] > 23)) return null;
  return (m[1] ? m[1] + '.' : '') + pad2(m[2]) + ':' + m[3] + ':' + (m[4] || '00');
}

function toLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
