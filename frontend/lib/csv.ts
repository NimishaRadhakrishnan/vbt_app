/**
 * A small CSV reader for pasted spreadsheet data.
 *
 * The realistic input here is a range copied out of Excel or Google Sheets and
 * pasted into a textarea, which is why `split(",")` is not enough:
 *
 *   - Excel copies tab-separated, not comma-separated, so both are accepted.
 *   - A product description can contain a comma, in which case the cell is
 *     quoted: `"Bio-NPK, liquid"`. Splitting on the comma would break that row
 *     into two and the operator would be told their price column is missing.
 *   - A quoted cell can contain a doubled quote (`""`) meaning one quote.
 *   - Windows line endings and a trailing blank line are both normal.
 *
 * Nothing here knows about products or prices. It returns rows of strings; the
 * caller decides what the columns mean.
 */

export type CsvTable = {
  header: string[];
  rows: string[][];
};

/** Split one delimited line, respecting double-quoted cells. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // A doubled quote inside a quoted cell is one literal quote.
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }

  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * Guess the delimiter from the header line.
 *
 * A tab anywhere means this came out of a spreadsheet, which is the common
 * case and unambiguous. Otherwise assume commas. Semicolons are accepted too
 * because that is what a spreadsheet saves in some locales.
 */
function detectDelimiter(headerLine: string): string {
  if (headerLine.includes("\t")) return "\t";
  if (!headerLine.includes(",") && headerLine.includes(";")) return ";";
  return ",";
}

/** Normalise a header cell to a snake_case key: "Min Quantity" -> "min_quantity". */
export function normaliseHeader(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parseCsv(text: string): CsvTable {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const [headerLine, ...bodyLines] = lines;
  if (headerLine === undefined) return { header: [], rows: [] };

  const delimiter = detectDelimiter(headerLine);
  const header = splitLine(headerLine, delimiter).map(normaliseHeader);
  const rows = bodyLines.map((line) => splitLine(line, delimiter));

  return { header, rows };
}

/**
 * Turn a parsed table into objects keyed by header name.
 *
 * Short rows are padded rather than rejected: a spreadsheet row whose last
 * cells are empty is copied without trailing delimiters, and treating that as
 * a malformed row would reject perfectly ordinary input.
 */
export function toObjects(table: CsvTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const object: Record<string, string> = {};
    table.header.forEach((key, index) => {
      object[key] = row[index] ?? "";
    });
    return object;
  });
}

/** Everything in one step, for the usual case. */
export function parseCsvToObjects(text: string): {
  header: string[];
  records: Record<string, string>[];
} {
  const table = parseCsv(text);
  return { header: table.header, records: toObjects(table) };
}
