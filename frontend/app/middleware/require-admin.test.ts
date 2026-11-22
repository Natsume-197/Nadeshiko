import { describe, test, expect, beforeEach, vi } from 'vitest';

const store = { isLoggedIn: false, isAdmin: false };
const navigateTo = vi.fn((path: string) => path);

vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn);
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('userStore', () => store);

const { default: auth } = await import('./auth');
const { default: requireAdmin } = await import('./require-admin');

beforeEach(() => {
  navigateTo.mockClear();
  store.isLoggedIn = false;
  store.isAdmin = false;
});

describe('auth middleware', () => {
  test('sends anonymous readers home', () => {
    expect((auth as () => unknown)()).toBe('/en/');
    expect(navigateTo).toHaveBeenCalledWith('/en/', { replace: true });
  });

  test('lets signed-in readers through', () => {
    store.isLoggedIn = true;
    expect((auth as () => unknown)()).toBeUndefined();
  });
});

describe('require-admin middleware', () => {
  test('sends non-admins to their settings', () => {
    store.isLoggedIn = true;
    expect((requireAdmin as () => unknown)()).toBe('/en/user/settings');
  });

  test('lets admins through', () => {
    store.isLoggedIn = true;
    store.isAdmin = true;
    expect((requireAdmin as () => unknown)()).toBeUndefined();
  });
});
