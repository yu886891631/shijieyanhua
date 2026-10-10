/** Data-only transfer receipt. Imported SQL/history is audit material, never executed. */
import { z } from 'zod';
import { t9LedgerSchema } from './t9-ledger';
export const t13EvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    action: z.enum(['legacy', 'snapshot', 'template', 'clear']),
    sourceKind: z.enum(['alpha11', 'legacy005', 'world', 'data', 'template', 'clear']),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    material: z.unknown(),
    materialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    redactions: z.number().int().min(0),
    mapping: z
      .array(
        z.strictObject({
          tableId: z.string().max(64),
          sourceId: z.string().max(512),
          rowId: z.string().max(64),
        }),
      )
      .max(5000),
    limitations: z.array(z.string().max(1000)).max(32),
    /** Explicit null resets legacy/cleared progress; absence preserves template migration progress. */
    ledger: t9LedgerSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const compatible = {
      legacy: ['alpha11', 'legacy005'],
      snapshot: ['world', 'data'],
      template: ['template'],
      clear: ['clear'],
    };
    if (
      !compatible[v.action].includes(v.sourceKind) ||
      (v.action !== 'template' && v.ledger === undefined) ||
      (['legacy', 'clear'].includes(v.action) && v.ledger !== null)
    )
      ctx.addIssue({ code: 'custom', message: '迁移类型与进度处理不匹配' });
    if (new Set(v.mapping.map(m => `${m.tableId}/${m.sourceId}`)).size !== v.mapping.length)
      ctx.addIssue({ code: 'custom', message: '重复来源映射' });
  });
export type T13Evidence = z.infer<typeof t13EvidenceSchema>;
