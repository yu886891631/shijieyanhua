/** addon 变量更新事件名, 对齐 MVU events 命名风格 */
export const AddonEvent = {
  VARIABLE_UPDATE_STARTED: 'addon_variable_update_started',
  PATCH_PARSED: 'addon_patch_parsed',
  VARIABLE_UPDATE_ENDED: 'addon_variable_update_ended',
  /** 变更日志已写入（含零 op / 无数据变化但有 issues） */
  PATCH_LOG_UPDATED: 'addon_patch_log_updated',
} as const;
