import { ValidationFailedError } from '@app/errors';
import { TrackerProviderType } from '@app/models/TrackerConnection';
import { anilistProvider } from './anilistProvider';
import { malProvider } from './malProvider';
import type { TrackerProvider } from './types';

const PROVIDERS: Partial<Record<TrackerProviderType, TrackerProvider>> = {
  [TrackerProviderType.ANILIST]: anilistProvider,
  [TrackerProviderType.MAL]: malProvider,
};

export function getTrackerProvider(providerId: TrackerProviderType): TrackerProvider {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new ValidationFailedError({ provider: `${providerId} is not supported yet.` });
  }
  return provider;
}

export function listConfiguredTrackerProviders(): TrackerProviderType[] {
  return Object.values(PROVIDERS)
    .filter((provider): provider is TrackerProvider => Boolean(provider?.isConfigured()))
    .map((provider) => provider.id);
}
