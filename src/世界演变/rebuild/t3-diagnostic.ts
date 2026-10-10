/** Safe local error coordinates; provider/error text and rejected cell values never reach the UI. */
import { T3EngineError, type T3Request } from './t3-engine';
import { parseT3Sql } from './t3-sql';
export interface T3Diagnostic {
  category: string;
  statement: number | null;
  table: string | null;
  field: string | null;
}
export function describeT3Diagnostic(error: unknown, request: T3Request): T3Diagnostic | null {
  if (!(error instanceof T3EngineError)) return null;
  let tableId = error.tableId;
  let statement: number | null = null;
  try {
    const statements = parseT3Sql(request.sql);
    if (
      Number.isSafeInteger(error.statementIndex) &&
      error.statementIndex! >= 0 &&
      error.statementIndex! < statements.length
    ) {
      statement = error.statementIndex! + 1;
      tableId ??= request.template.tables.find(t => t.sqlName === statements[error.statementIndex!].table)?.id;
    }
  } catch {
    /* Parser did not establish coordinates; do not guess. */
  }
  const authorized = [...new Set([...request.policy.write, ...request.policy.read].map(g => g.tableId))];
  const matches = request.template.tables.filter(
    t =>
      t.visibility.user &&
      (tableId
        ? t.id === tableId
        : authorized.includes(t.id) && !!error.fieldId && t.fields.some(f => f.id === error.fieldId)),
  );
  const table = matches.length === 1 ? matches[0] : null;
  const field = table?.fields.find(f => f.id === error.fieldId && f.visibility.user && !f.hiddenUi);
  return { category: error.code, statement, table: table?.name ?? null, field: field?.name ?? null };
}
