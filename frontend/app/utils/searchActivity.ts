import {
  NadeshikoError,
  trackUserActivity,
  type NadeshikoClient,
  type TrackUserActivityData,
} from '@brigadasos/nadeshiko-sdk';
import { reportError, reportEvent } from './reportError';

export async function trackSearchActivity(
  sdk: NadeshikoClient,
  body: NonNullable<TrackUserActivityData['body']> & { activityType: 'SEARCH' },
): Promise<void> {
  try {
    // The flat SDK method only accepts body fields. Use its configured client to pass fetch options separately.
    await trackUserActivity({ client: sdk.client, body, keepalive: true, throwOnError: true });
  } catch (error: unknown) {
    // Status 0 means no response arrived; it does not establish that navigation cancelled the request.
    if (error instanceof NadeshikoError && error.status === 0) {
      reportEvent('search_activity_failed', { reason: 'transport' });
      return;
    }
    reportError('search:track-activity-failed', error);
  }
}
