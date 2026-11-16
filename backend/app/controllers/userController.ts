import type {
  GetMe,
  ListExcludedMedia,
  AddExcludedMedia,
  RemoveExcludedMedia,
  ListFavoriteMedia,
  AddFavoriteMedia,
  RemoveFavoriteMedia,
} from 'generated/routes/user';
import type { t_MediaSummary } from 'generated/models';
import { assertUser } from '@app/middleware/authentication';
import { AccountQuotaUsage, Media } from '@app/models';
import { resolveEffectiveQuota } from '@app/services/quota/effectiveQuota';
import { config } from '@config/config';
import { NotFoundError } from '@app/errors';
import { toMediaSummaryDTO } from './mappers/sharedMapper';
import { toUserMeDTO } from './mappers/userMapper';
import {
  mutateUserPreferences,
  assertFavoriteMediaWithinCap,
  normalizeMediaPreferences,
} from './preferencesController';

export const getMe: GetMe = async (_params, respond, req) => {
  const user = assertUser(req);
  const resolved = await resolveEffectiveQuota(user);
  const quota = await AccountQuotaUsage.getForUser(user.id, resolved.limit);
  const window = AccountQuotaUsage.getQuotaWindow(quota.periodYyyymm);
  const { assignedTier } = resolved;

  // Name the tier that determined the limit, assigned or earned on Patreon; an override names none, so it cannot
  // masquerade as a tier.
  return respond.with200().body(
    toUserMeDTO(user, quota, window, resolved.tier, {
      // The assigned tier's burst or the deployment default, because that is what new keys are stamped with: keys are
      // never restamped, so a Patreon tier must not stamp a burst that would outlive the membership.
      max: assignedTier?.rateLimitMax ?? config.API_KEY_RATE_LIMIT_MAX,
      windowMs: assignedTier?.rateLimitWindowMs ?? config.API_KEY_RATE_LIMIT_WINDOW_MS,
    }),
  );
};

/** Hydrate in preference order, preserving duplicates and omitting stale IDs. */
async function loadMediaSummaries(publicIds: string[]): Promise<t_MediaSummary[]> {
  if (publicIds.length === 0) return [];

  const media = await Media.find({
    where: publicIds.map((mediaPublicId) => ({ publicId: mediaPublicId })),
    relations: Media.buildRelations({ includeEpisodes: false, includeExternalIds: false }),
  });
  const mediaByPublicId = new Map(media.map((item) => [item.publicId, item]));

  return publicIds
    .map((mediaPublicId) => mediaByPublicId.get(mediaPublicId))
    .filter((item): item is Media => item !== undefined)
    .map(toMediaSummaryDTO);
}

export const listExcludedMedia: ListExcludedMedia = async (_params, respond, req) => {
  const user = assertUser(req);
  // Normalize preferences before reading titles; legacy bare-string rows otherwise resolve to `undefined` entries.
  const hiddenMedia = normalizeMediaPreferences(user.preferences ?? {}).hiddenMedia ?? [];
  const publicIds = hiddenMedia.map((item) => item.mediaPublicId);

  return respond.with200().body({ excludedMedia: await loadMediaSummaries(publicIds) });
};

export const addExcludedMedia: AddExcludedMedia = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const media = await Media.findOne({ where: { publicId: body.mediaPublicId } });
  if (!media) {
    throw new NotFoundError('Media not found.');
  }

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const hiddenMedia = current.hiddenMedia ?? [];
    if (hiddenMedia.some((item) => item.mediaPublicId === media.publicId)) {
      return current;
    }

    // The id alone. The names this used to copy in were never read back -- the
    // list endpoint above resolves them from `Media`, where a rename lands.
    return { ...current, hiddenMedia: [...hiddenMedia, { mediaPublicId: media.publicId }] };
  });

  return respond.with204();
};

export const removeExcludedMedia: RemoveExcludedMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const hiddenMedia = current.hiddenMedia ?? [];
    const nextHiddenMedia = hiddenMedia.filter((item) => item.mediaPublicId !== params.mediaPublicId);

    if (nextHiddenMedia.length === hiddenMedia.length) {
      throw new NotFoundError('Excluded media not found.');
    }

    return { ...current, hiddenMedia: nextHiddenMedia };
  });

  return respond.with204();
};

export const listFavoriteMedia: ListFavoriteMedia = async (_params, respond, req) => {
  const user = assertUser(req);
  // Show favorites newest first here; search makes its own alphabetical copy, so `favoritedAt` preserves both orders.
  const favoriteMedia = [...(normalizeMediaPreferences(user.preferences ?? {}).favoriteMedia ?? [])].sort((a, b) =>
    (b.favoritedAt ?? '').localeCompare(a.favoritedAt ?? ''),
  );
  const publicIds = favoriteMedia.map((item) => item.mediaPublicId).filter(Boolean);

  return respond.with200().body({ favoriteMedia: await loadMediaSummaries(publicIds) });
};

export const addFavoriteMedia: AddFavoriteMedia = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const media = await Media.findOne({ where: { publicId: body.mediaPublicId } });
  if (!media) {
    throw new NotFoundError('Media not found.');
  }

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const favoriteMedia = current.favoriteMedia ?? [];
    if (favoriteMedia.some((item) => item.mediaPublicId === media.publicId)) {
      return current;
    }

    const next = {
      ...current,
      favoriteMedia: [
        ...favoriteMedia,
        {
          mediaPublicId: media.publicId,
          // Server-set: a client clock decides nothing about stored order. The
          // only field kept beside the id; see `hiddenMedia` in `User.ts`.
          favoritedAt: new Date().toISOString(),
        },
      ],
    };

    // Thrown inside the mutate callback so the transaction rolls back rather
    // than writing a list one entry past the cap.
    assertFavoriteMediaWithinCap(next);
    return next;
  });

  return respond.with204();
};

export const removeFavoriteMedia: RemoveFavoriteMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const favoriteMedia = current.favoriteMedia ?? [];
    const nextFavoriteMedia = favoriteMedia.filter((item) => item.mediaPublicId !== params.mediaPublicId);

    if (nextFavoriteMedia.length === favoriteMedia.length) {
      throw new NotFoundError('Favorite media not found.');
    }

    return { ...current, favoriteMedia: nextFavoriteMedia };
  });

  return respond.with204();
};
