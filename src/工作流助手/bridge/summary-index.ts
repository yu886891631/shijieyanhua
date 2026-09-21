export function formatSummaryIndexForPlot(allTablesJson: Record<string, unknown> | null): {
  success: boolean;
  content: string;
} {
  try {
    if (!allTablesJson || typeof allTablesJson !== 'object') {
      return { success: false, content: '纪要索引：未获取到表格数据。' };
    }
    const sheets = Object.values(allTablesJson).filter(
      x => x && typeof x === 'object' && 'name' in x && 'content' in x,
    ) as { name: string; content: unknown[][] }[];
    const summaryTable = sheets.find(s => {
      const name = String(s.name || '').trim();
      return name === '纪要表' || name === '总结表';
    });
    if (!summaryTable) {
      return { success: false, content: '纪要索引：未找到纪要表。' };
    }
    if (!Array.isArray(summaryTable.content) || summaryTable.content.length <= 1) {
      return { success: false, content: '纪要索引：纪要表为空。' };
    }
    const headerRow = Array.isArray(summaryTable.content[0]) ? summaryTable.content[0] : [];
    const summaryColIdx = headerRow.findIndex(h => {
      const name = String(h ?? '').trim();
      return name === '概览' || name === '概要';
    });
    const indexColIdx = headerRow.findIndex(h => String(h ?? '').trim() === '编码索引');
    if (summaryColIdx === -1 || indexColIdx === -1) {
      return { success: false, content: '纪要索引：未找到概要列或编码索引列。' };
    }
    let out = `## 表格: 纪要索引\nColumns: 概要, 编码索引\n`;
    const rows = summaryTable.content.slice(1).filter(r => Array.isArray(r));
    if (rows.length === 0) {
      out += '(无数据行)\n';
      return { success: true, content: out };
    }
    rows.forEach((row, idx) => {
      const summary = row[summaryColIdx] ? String(row[summaryColIdx]).trim() : '';
      const indexCode = row[indexColIdx] ? String(row[indexColIdx]).trim() : '';
      if (summary || indexCode) {
        out += `- [${idx}] 概要: ${summary} | 编码索引: ${indexCode}\n`;
      }
    });
    return { success: true, content: out };
  } catch {
    return { success: false, content: '纪要索引：格式化时发生错误。' };
  }
}

export function formatOutlineTableForPlot(allTablesJson: Record<string, unknown> | null): string {
  try {
    if (!allTablesJson || typeof allTablesJson !== 'object') {
      return '总体大纲表：未获取到表格数据。';
    }
    const sheets = Object.values(allTablesJson).filter(
      x => x && typeof x === 'object' && 'name' in x && 'content' in x,
    ) as { name: string; content: unknown[][] }[];
    const outline = sheets.find(s => String(s.name || '').trim() === '总体大纲');
    if (!outline || !Array.isArray(outline.content) || outline.content.length === 0) {
      return '总体大纲表：未找到该表或表结构为空。';
    }
    const headerRow = Array.isArray(outline.content[0]) ? outline.content[0] : [];
    const headers = headerRow.slice(1).map(h => String(h ?? '').trim()).filter(Boolean);
    let out = `## 表格: 总体大纲\n`;
    out += headers.length ? `Columns: ${headers.join(', ')}\n` : 'Columns: (无表头)\n';
    const rows = outline.content.slice(1).filter(r => Array.isArray(r));
    rows.forEach((row, idx) => {
      const cells = row.slice(1);
      const parts: string[] = [];
      for (let i = 0; i < headers.length; i++) {
        const val = cells[i] != null ? String(cells[i]).trim() : '';
        if (val) parts.push(`${headers[i]}: ${val}`);
      }
      if (parts.length) out += `- [${idx}] ${parts.join(' | ')}\n`;
    });
    return out;
  } catch {
    return '总体大纲表：格式化时发生错误。';
  }
}

async function getSummaryIndexFromWorldbook(plotWorldbookConfig: {
  source: string;
  manualSelection: string[];
}): Promise<string | null> {
  let bookNames: string[] = [];
  if (plotWorldbookConfig.source === 'manual' && plotWorldbookConfig.manualSelection.length) {
    bookNames = [...plotWorldbookConfig.manualSelection];
  } else {
    try {
      const charBooks = getCharWorldbookNames('current');
      if (charBooks.primary) bookNames.push(charBooks.primary);
      bookNames.push(...charBooks.additional);
    } catch {
      return null;
    }
  }
  bookNames = [...new Set(bookNames.filter(Boolean))];
  const baseComment = 'TavernDB-ACU-CustomExport-纪要索引';
  for (const bookName of bookNames) {
    try {
      const entries = await getWorldbook(bookName);
      const indexEntry = entries.find(entry => {
        const comment = String(entry.name || '').trim();
        return comment === baseComment || comment.endsWith(baseComment);
      });
      if (indexEntry?.content) {
        return indexEntry.content;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function resolveSummaryIndexContent(
  tablesJson: Record<string, unknown> | null,
  plotWorldbookConfig: { source: string; manualSelection: string[] },
): Promise<string> {
  const fromWb = await getSummaryIndexFromWorldbook(plotWorldbookConfig);
  if (fromWb) return fromWb;
  const formatted = formatSummaryIndexForPlot(tablesJson);
  if (formatted.success) return formatted.content;
  return formatOutlineTableForPlot(tablesJson);
}
