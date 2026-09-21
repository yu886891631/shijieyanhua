const CONFIG_KEY = '是否显示变量更新错误';
const DEFAULT_SHOW_ERRORS = '是';

type ScriptTreeNode = {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
  scripts?: ScriptTreeNode[];
};

function findScriptData(trees: ScriptTreeNode[], script_id: string): Record<string, unknown> | undefined {
  for (const node of trees) {
    if (node.type === 'script' && node.id === script_id) {
      return node.data;
    }
    if (node.type === 'folder' && node.scripts) {
      const found = findScriptData(node.scripts, script_id);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function readScriptExportData(): Record<string, unknown> | undefined {
  const script_id = getScriptId();
  for (const tree_type of ['global', 'character', 'preset'] as const) {
    try {
      const data = findScriptData(getScriptTrees({ type: tree_type }) as ScriptTreeNode[], script_id);
      if (data !== undefined) {
        return data;
      }
    } catch {
      // 无角色卡等情况, 跳过
    }
  }
  return undefined;
}

/** 是否应在变量更新出错时弹出 toastr */
export function shouldShowAddonUpdateErrors(): boolean {
  const export_data = readScriptExportData();
  const from_export = export_data?.[CONFIG_KEY];
  if (from_export === '是' || from_export === '否') {
    return from_export === '是';
  }

  const script_vars = getVariables({ type: 'script' });
  const from_vars = script_vars[CONFIG_KEY];
  if (from_vars === '是' || from_vars === '否') {
    return from_vars === '是';
  }

  return DEFAULT_SHOW_ERRORS === '是';
}
