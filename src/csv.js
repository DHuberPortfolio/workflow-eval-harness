// CSV support: spreadsheets and table exports (Excel, Google Sheets, Zapier Tables, ...).
//
// Two steps, kept apart:
//   1. csvToRecords: text -> one plain object per row, every cell still text,
//      keyed by the header row's column names.
//   2. decodeCsvRecords: the cells the config cares about are turned from text into
//      the same shapes a JSON file would have, using the cell conventions:
//        "SUBJ-MNA@0.95 | SUBJ-ANTI@0.88"   two values with confidences
//        ""                                  no values
//        "true" / "FALSE"                    true / false (the "scored" column)
//      After that, load.js treats the records exactly like records from JSON, so every
//      other check (confidence ranges, labels, duplicates) applies to CSV unchanged.

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// Splits CSV text into rows of cells, following the usual CSV rules: a cell in double
// quotes may contain the delimiter, line breaks, and "" standing for one quote mark.
// Returns [{ line, cells }], or null if a quoted cell is never closed (A11).
function parseCsvText(text, delimiter, source, p) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;        // current line in the file, for error messages
  let rowLine = 1;     // line the current row started on
  let quoteLine = 0;   // line the open quote started on

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }   // "" inside quotes is one quote mark
      else if (ch === '"') inQuotes = false;
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      // Windows line ending: the \n that follows ends the row
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = [];
      cell = '';
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) { p.stop('A11', source + ' line ' + quoteLine, 'a quoted cell starts here and is never closed'); return null; }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push({ line: rowLine, cells: row }); }
  return rows;
}

// Text -> plain records, one per row, keyed by the header row. Returns [] after
// reporting if the table is unusable (A4, A11-A13).
function csvToRecords(text, source, p, delimiter) {
  const rows = parseCsvText(text, delimiter, source, p);
  if (rows === null) return [];
  const filled = rows.filter(r => r.cells.some(c => c.trim() !== ''));   // skip blank lines
  if (filled.length === 0) { p.stop('A4', source, 'the file has no rows'); return []; }

  const [header, ...body] = filled;
  const names = header.cells.map(c => c.trim());
  if (names.length === 1 && delimiter !== ';' && names[0].includes(';')) {
    // European Excel separates cells with ; because , is the decimal mark there.
    p.stop('A12', source, 'the header is one column containing ";". The file looks ;-separated: set "delimiter": ";" for this file under "input" in the config.');
    return [];
  }
  let ok = true;
  names.forEach((n, i) => {
    if (n === '') { ok = false; p.stop('A13', source + ' line ' + header.line, 'column ' + (i + 1) + ' has no name in the header row'); }
    else if (names.indexOf(n) !== i) { ok = false; p.stop('A13', source + ' line ' + header.line, 'the column name "' + n + '" appears more than once'); }
  });
  if (!ok) return [];
  if (body.length === 0) { p.stop('A4', source, 'the file has a header row but no records'); return []; }

  const records = [];
  for (const r of body) {
    if (r.cells.length !== names.length) {
      p.stop('A12', source + ' line ' + r.line, 'has ' + r.cells.length + ' cells, but the header has ' + names.length +
        '. A value containing "' + (delimiter === '\t' ? 'tab' : delimiter) + '" must be in double quotes.');
      continue;
    }
    const rec = {};
    names.forEach((n, i) => { rec[n] = r.cells[i]; });
    records.push(rec);
  }
  return records;
}

// ---------- Step 2: decoding cells ----------

// A confidence written in a cell. Returns a number, or undefined after reporting.
function decodeNumber(text, where, p, afterSeparator) {
  const t = text.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  if (/^[+-]?\d+,\d+$/.test(t)) {
    p.stop('E7', where, 'confidence "' + t + '" uses a decimal comma; write it with a dot: ' + t.replace(',', '.'));
  } else {
    p.stop('E4', where, (t === '' ? 'nothing' : '"' + t + '"') + ' where a confidence belongs' +
      (afterSeparator ? ' (after "' + afterSeparator + '"). If values themselves contain "' + afterSeparator + '", set a different confidence_separator.' : ''));
  }
  return undefined;
}

// One value from a cell: "SUBJ-MNA" or "SUBJ-MNA@0.95". Returns the value as text, or an
// object shaped like a JSON value ({ value, confidence } under the configured names).
function decodeItem(piece, o, s, where, p) {
  const at = piece.lastIndexOf(s.confidence_separator);
  if (at === -1) return piece;
  const conf = decodeNumber(piece.slice(at + s.confidence_separator.length), where, p, s.confidence_separator);
  if (conf === undefined) return null;
  return { [o.value_key]: piece.slice(0, at).trim(), [o.confidence_key]: conf };
}

// A cell holding a set: values separated by the list separator. An empty cell means
// "no values" (A14). Spaces around separators are part of the convention, so they are
// trimmed without being reported. An empty piece ("A | | B") is kept so D9 catches it.
function decodeList(cell, o, s, where, p) {
  if (cell.trim() === '') return [];
  return cell.split(s.list_separator).map(piece => decodeItem(piece.trim(), o, s, where, p)).filter(v => v !== null);
}

// A cell holding a label. Empty means no label (F3/F4 catch it). Several values means
// a list, which F2 catches.
function decodeLabel(cell, o, s, where, p) {
  if (cell.trim() === '') return undefined;
  if (cell.includes(s.list_separator)) return decodeList(cell, o, s, where, p);
  return decodeItem(cell.trim(), o, s, where, p) ?? undefined;
}

// Spreadsheets write true/false in any case (Excel: TRUE). Anything else is left as
// text, so the usual check (C10) reports it.
function decodeBool(cell) {
  const t = cell.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === '') return undefined;
  return cell;
}

// Turns the cells the config cares about into JSON shapes. `which` is "predictions" or
// "key"; `s` is that file's input settings. Returns new objects; rows are not changed.
function decodeCsvRecords(rows, config, which, s, source, p) {
  const isKey = which === 'key';
  return rows.map((row, i) => {
    const rec = { ...row };
    const id = has(row, config.id_field) ? row[config.id_field].trim() : '';
    const where = source + ' ' + (id || 'row #' + (i + 1));
    const decode = (col, fn, o) => { if (has(row, col)) rec[col] = fn(row[col], o, s, where + ' ' + col, p); };

    for (const o of Object.values(config.outputs)) {
      const col = isKey ? o.key_field : o.field;
      if (o.type === 'set') {
        decode(col, decodeList, o);
        if (!isKey && o.rejected_field) decode(o.rejected_field, decodeList, o);
      } else {
        decode(col, decodeLabel, o);
        if (!isKey && o.confidence_field && has(row, o.confidence_field)) {
          rec[o.confidence_field] = row[o.confidence_field].trim() === ''
            ? undefined : decodeNumber(row[o.confidence_field], where + ' ' + o.confidence_field, p, null);
        }
      }
    }
    if (!isKey && has(row, 'scored')) rec.scored = decodeBool(row.scored);
    if (isKey && config.trap_field && has(row, config.trap_field)) {
      const t = row[config.trap_field].trim();
      const traps = t === '' ? [] : t.split(s.list_separator).map(x => x.trim());
      rec[config.trap_field] = traps.length === 0 ? undefined : traps.length === 1 ? traps[0] : traps;
    }
    // Empty cells elsewhere (id, route, ...) mean "not given", as a missing field would in JSON.
    for (const [k, v] of Object.entries(rec)) if (v === '') rec[k] = undefined;
    return rec;
  });
}

module.exports = { parseCsvText, csvToRecords, decodeCsvRecords };
