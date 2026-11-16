import { nadeshikoDictionary } from '~~/server/utils/dictionary/nadeshiko';
import { shirabeDictionary } from '~~/server/utils/dictionary/shirabe';
import type { Dictionary } from '~~/server/utils/dictionary/types';

export * from '~~/server/utils/dictionary/types';

export type ProviderName = 'shirabe' | 'nadeshiko';

const PROVIDERS: Record<ProviderName, Dictionary> = {
  shirabe: shirabeDictionary,
  nadeshiko: nadeshikoDictionary,
};

export const isProviderName = (value: unknown): value is ProviderName => value === 'shirabe' || value === 'nadeshiko';

function config(): Record<string, unknown> | null {
  try {
    return useRuntimeConfig() as Record<string, unknown>;
  } catch {
    // No Nitro runtime (unit tests).
    return null;
  }
}

/** The site default, for anonymous readers and readers who never chose (`NUXT_DICTIONARY_PROVIDER`). */
export function defaultProvider(): ProviderName {
  const configured = config()?.dictionaryProvider;
  return isProviderName(configured) ? configured : 'shirabe';
}

/** Whether a provider can answer at all here: Shirabe needs its service key, ours needs the backend. */
export function providerAvailable(name: ProviderName): boolean {
  const runtime = config();
  if (!runtime) return false;
  if (name === 'shirabe') return Boolean(String(runtime.shirabeApiKey ?? '').trim());
  return Boolean(String(runtime.backendInternalUrl ?? '').trim());
}

export function dictionaryFor(name: ProviderName): Dictionary {
  return PROVIDERS[name];
}

/** The provider to ask when `name` fails, if that one can answer. */
export function failoverFor(name: ProviderName): ProviderName | null {
  const other: ProviderName = name === 'shirabe' ? 'nadeshiko' : 'shirabe';
  return providerAvailable(other) ? other : null;
}
