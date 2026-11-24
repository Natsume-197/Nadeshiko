import { type Locator, type Page, expect } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly username: Locator;
  readonly email: Locator;
  readonly logoutButton: Locator;
  readonly sessionsCard: Locator;
  readonly refreshSessionsButton: Locator;
  readonly logOutOtherDevicesButton: Locator;
  readonly defaultSearchCategory: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page.getByTestId('account-username');
    this.email = page.getByTestId('account-email');
    this.logoutButton = page.getByTestId('account-sign-out');
    this.sessionsCard = page.getByTestId('sessions-card');
    this.refreshSessionsButton = page.getByRole('button', { name: 'Refresh' });
    this.logOutOtherDevicesButton = page.getByRole('button', { name: 'Sign out other devices', exact: true });
    this.defaultSearchCategory = page.getByTestId('default-search-category');
  }

  async goto() {
    const response = await this.page.goto('/user/settings');
    expect(response?.status(), 'settings navigation should return HTTP 200').toBe(200);
  }

  async gotoSearch() {
    const response = await this.page.goto('/user/media');
    expect(response?.status(), 'search settings navigation should return HTTP 200').toBe(200);
  }

  async gotoAccount() {
    const response = await this.page.goto('/user/account');
    expect(response?.status(), 'account navigation should return HTTP 200').toBe(200);
  }

  async expectLoaded() {
    // Visible SSR controls are inert until Vue attaches handlers; wait for the app-owned marker.
    await expect(this.page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
    await expect(this.page.getByTestId('translation-languages')).toBeVisible({ timeout: 10_000 });
  }

  async expectSearchLoaded() {
    await expect(this.page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
    await expect(this.defaultSearchCategory).toBeVisible({ timeout: 10_000 });
  }

  async expectAccountLoaded() {
    await expect(this.page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
    await expect(this.username).toBeVisible({ timeout: 10_000 });
    await expect(this.email).toBeVisible({ timeout: 10_000 });
  }

  get currentSessionRow() {
    return this.sessionsCard.getByTestId('session-row-current');
  }

  get otherSessionRows() {
    return this.sessionsCard.getByTestId('session-row');
  }

  get allSessionRows() {
    return this.sessionsCard.getByTestId(/^session-row/);
  }

  get currentSessionBadge() {
    return this.currentSessionRow.getByText('Current');
  }
}
