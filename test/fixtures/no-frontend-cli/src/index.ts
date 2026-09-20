export function cut(rows: string[][], columns: number[]): string[][] {
  return rows.map((r) => columns.map((c) => r[c] ?? ""));
}
export function join(a: string[][], b: string[][], key: number): string[][] {
  const index = new Map(b.map((r) => [r[key], r]));
  return a.map((r) => [...r, ...(index.get(r[key]) ?? [])]);
}
export function stat(rows: string[][], column: number): { count: number; unique: number } {
  const values = rows.map((r) => r[column]);
  return { count: values.length, unique: new Set(values).size };
}
