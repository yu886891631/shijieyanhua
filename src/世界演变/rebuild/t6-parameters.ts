import type { T2ApiReference, T2Budget, T2ContextSettings, T2Frequency, T2Inherited, T2Template } from './t2-template';
export interface T6Parameters {
  frequency: T2Inherited<T2Frequency>;
  budget: T2Inherited<T2Budget>;
  context: T2Inherited<T2ContextSettings>;
  api: T2Inherited<T2ApiReference>;
}
export type T6ParameterKey = keyof T6Parameters;
export function globalT6Parameters(defaults: T2Template['defaults']): T6Parameters {
  return {
    frequency: { state: 'value', value: defaults.frequency },
    budget: { state: 'value', value: defaults.budget },
    context: { state: 'value', value: defaults.context },
    api: defaults.api,
  };
}
