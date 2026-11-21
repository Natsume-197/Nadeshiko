import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { PatreonConnection } from '@app/models';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

const THEME = { preset: 'sepia', base: 'light', accent: '#e05a8a', background: '#fff5f8' } as const;

/** A stored Patreon link, checked just now unless `checkedAt` says otherwise. The token is not a real one, so any
 * attempt to refresh it against Patreon would fail. */
async function linkPatreon(userId: number, active: boolean, checkedAt = new Date()) {
  await PatreonConnection.delete({ userId });
  await PatreonConnection.create({
    userId,
    patreonUserId: `patreon-${userId}`,
    accessTokenCiphertext: 'x',
    refreshTokenCiphertext: 'x',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    patronStatus: active ? 'active_patron' : 'former_patron',
    entitledAmountCents: active ? 300 : 0,
    membershipCheckedAt: checkedAt,
  }).save();
}

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(async () => {
  const { regular } = fixtures.users;
  await PatreonConnection.delete({ userId: regular.id });
  regular.preferences = {};
  await regular.save();
  signInAs(app, regular);
});

describe('custom themes are a patron perk', () => {
  it('refuses a reader with no Patreon link', async () => {
    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: THEME });

    expect(res.status).toBe(403);
    await fixtures.users.regular.reload();
    expect(fixtures.users.regular.preferences.customTheme).toBeUndefined();
  });

  it('refuses a linked reader whose membership is not active', async () => {
    await linkPatreon(fixtures.users.regular.id, false);

    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: THEME });

    expect(res.status).toBe(403);
  });

  it('stores it for an active patron', async () => {
    await linkPatreon(fixtures.users.regular.id, true);

    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: THEME });

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toEqual(THEME);
  });

  it('stores it for an admin, which is how it is granted by hand', async () => {
    signInAs(app, fixtures.users.kevin);

    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: THEME });

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toEqual(THEME);
    await request(app).patch('/v1/user/preferences').send({ customTheme: null });
  });

  it('replaces the whole theme instead of merging it with the old one', async () => {
    await linkPatreon(fixtures.users.regular.id, true);
    await request(app).patch('/v1/user/preferences').send({ customTheme: THEME });
    const { preset: _preset, ...unnamed } = THEME;

    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: unnamed });

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toEqual(unnamed);
  });
  it('always lets a reader clear it', async () => {
    const res = await request(app).patch('/v1/user/preferences').send({ customTheme: null });

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toBeNull();
  });

  it('rejects a colour that is not a six-digit hex', async () => {
    await linkPatreon(fixtures.users.regular.id, true);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({ customTheme: { ...THEME, accent: 'red' } });

    expect(res.status).toBe(400);
  });

  it('keeps a lapsed patron theme stored but leaves it out of what they read', async () => {
    const { regular } = fixtures.users;
    regular.preferences = { customTheme: { ...THEME } };
    await regular.save();
    await linkPatreon(regular.id, false);
    signInAs(app, regular);

    const res = await request(app).get('/v1/user/preferences');

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toBeUndefined();
    await regular.reload();
    expect(regular.preferences.customTheme).toEqual(THEME);
  });

  it('reads a stale stored membership as it is, without refreshing it from Patreon', async () => {
    const { regular } = fixtures.users;
    regular.preferences = { customTheme: { ...THEME } };
    await regular.save();
    const dayAgo = new Date(Date.now() - 86_400_000);
    await linkPatreon(regular.id, true, dayAgo);
    signInAs(app, regular);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app).get('/v1/user/preferences');

    expect(res.status).toBe(200);
    expect(res.body.customTheme).toEqual(THEME);
    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = await PatreonConnection.findOneByOrFail({ userId: regular.id });
    expect(stored.membershipCheckedAt.getTime()).toBe(dayAgo.getTime());
    fetchSpy.mockRestore();
  });
});
