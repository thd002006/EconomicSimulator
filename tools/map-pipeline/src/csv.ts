/** Minimal RFC4180-ish CSV parse/serialize (UTF-8, comma, optional quotes). */

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = records[0]!.map((header) => header.trim());
  const rows: Record<string, string>[] = [];
  for (const record of records.slice(1)) {
    if (record.every((cell) => cell.trim() === "")) continue;
    const row: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index]!;
      if (header === "") continue;
      row[header] = (record[index] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

export function serializeCsv(headers: readonly string[], rows: readonly Record<string, string>[]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

export function requireCsvField(row: Record<string, string>, field: string, label: string): string {
  const value = row[field];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} requires non-empty ${field}.`);
  }
  return value.trim();
}

export function optionalCsvField(row: Record<string, string>, field: string): string | undefined {
  const value = row[field];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

export function parseCsvNumber(row: Record<string, string>, field: string, label: string): number {
  const raw = requireCsvField(row, field, label);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${label}.${field} must be a finite number (got ${raw}).`);
  }
  return value;
}

export function optionalCsvNumber(
  row: Record<string, string>,
  field: string,
  label: string
): number | undefined {
  const raw = optionalCsvField(row, field);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${label}.${field} must be a finite number (got ${raw}).`);
  }
  return value;
}
