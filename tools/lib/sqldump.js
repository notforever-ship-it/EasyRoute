// A small reader for the INSERT lines of one table of a SQL dump (CMaNGOS classic-db). The dump is read as plain text: the column
// names come from the CREATE TABLE block, the values from the INSERT INTO lines, character by character. Nothing is ever run.
//   const sql = require("./lib/sqldump.js");
//   sql.readColumns(text, "quest_template")  -> ["entry", "Method", ...]   (null when the table is not in the text)
//   sql.readTuples(text, "quest_template")   -> [[v1, v2, ...], ...]       (numbers, strings, null)
//   sql.rows(text, "item_template", ["entry", "name"]) -> [{ entry, name }, ...]  (only the named columns; all columns when none are named)
// Quotes, backslash escapes, doubled quotes and NULL are read the way tools/build-creature-react.js reads them.

const ESCAPES = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };

// The column names of the CREATE TABLE block of a table, in order, or null when the table is not in the text.
function readColumns(sql, table) {
  const start = sql.indexOf("CREATE TABLE `" + table + "` (");
  if (start < 0) return null;
  const end = sql.indexOf(") ENGINE", start);
  if (end < 0) return null;
  const cols = [];
  for (const line of sql.slice(start, end).split("\n")) {
    const t = line.trim();
    if (t.charAt(0) === "`") cols.push(t.split("`")[1]);
  }
  return cols;
}

// Every tuple of every INSERT INTO `table` statement, as an array of values.
function readTuples(sql, table) {
  const tuples = [];
  const marker = "INSERT INTO `" + table + "` VALUES ";
  let pos = 0;
  while ((pos = sql.indexOf(marker, pos)) >= 0) {
    pos += marker.length;
    while (sql.charAt(pos) === "(") {
      pos++;
      const vals = [];
      let cur = "", inQuote = false, isStr = false;
      for (;;) {
        if (pos >= sql.length) return tuples;
        const ch = sql.charAt(pos++);
        if (inQuote) {
          if (ch === "\\") {
            const next = sql.charAt(pos++);
            cur += Object.prototype.hasOwnProperty.call(ESCAPES, next) ? ESCAPES[next] : next;
          } else if (ch === "'") {
            if (sql.charAt(pos) === "'") { cur += "'"; pos++; } else inQuote = false;
          } else cur += ch;
        } else if (ch === "'") {
          inQuote = true; isStr = true;
        } else if (ch === "," || ch === ")") {
          const t = cur.trim();
          vals.push(isStr ? cur : (t === "NULL" ? null : (t === "" ? NaN : Number(t))));
          cur = ""; isStr = false;
          if (ch === ")") break;
        } else cur += ch;
      }
      tuples.push(vals);
      if (sql.charAt(pos) === ",") pos++; else break;
    }
  }
  return tuples;
}

// The rows of a table as objects keyed by column name, with only the wanted columns. Throws a plain error when the table or a
// wanted column is missing.
function rows(sql, table, wanted) {
  const cols = readColumns(sql, table);
  if (!cols) throw new Error(`the dump has no ${table} table`);
  wanted = wanted || cols;
  const idx = wanted.map((w) => {
    const i = cols.indexOf(w);
    if (i < 0) throw new Error(`${table} has no ${w} column`);
    return i;
  });
  return readTuples(sql, table).map((t) => {
    const o = {};
    wanted.forEach((w, i) => { o[w] = t[idx[i]]; });
    return o;
  });
}

module.exports = { readColumns, readTuples, rows };
