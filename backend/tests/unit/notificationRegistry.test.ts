import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_REGISTRY,
  REGISTRY_KINDS,
  isOfficialNotificationKind,
  isRegistryKind,
} from '@app/services/notifications/registry';
import { extractPlaceholders, validateTemplateVariables } from '@app/services/notifications/settings';
import { validateRelativeLink } from '@app/services/notifications/broadcast';

describe('notificationRegistry & validation', () => {
  it('registers all core bell and email kinds with valid default params', () => {
    for (const kind of REGISTRY_KINDS) {
      const entry = NOTIFICATION_REGISTRY[kind];
      expect(isRegistryKind(kind)).toBe(true);
      const parsed = entry.paramsSchema.safeParse(entry.defaultParams);
      expect(parsed.success, `defaultParams invalid for ${kind}`).toBe(true);
    }
  });

  it('locks transactional auth emails as alwaysEnabled', () => {
    expect(NOTIFICATION_REGISTRY['magic-link'].alwaysEnabled).toBe(true);
    expect(NOTIFICATION_REGISTRY['verify-new-email'].alwaysEnabled).toBe(true);
    expect(NOTIFICATION_REGISTRY['word-digest'].alwaysEnabled).toBe(false);
  });

  it('marks official notices as pinned and non-mutable', () => {
    expect(isOfficialNotificationKind('site-announcement')).toBe(true);
    expect(isOfficialNotificationKind('admin-message')).toBe(true);
    expect(isOfficialNotificationKind('word-available')).toBe(false);
    expect(NOTIFICATION_REGISTRY['site-announcement'].siteCategory).toBeNull();
    expect(NOTIFICATION_REGISTRY['site-announcement'].pinned).toBe(true);
  });

  it('extracts and validates template variables', () => {
    expect(extractPlaceholders('Hello {{username}}, from {{senderName}}!')).toEqual(['username', 'senderName']);
    const welcome = NOTIFICATION_REGISTRY.welcome;
    expect(() => validateTemplateVariables(welcome, 'Welcome {{username}} from {{senderName}}')).not.toThrow();
    expect(() => validateTemplateVariables(welcome, 'Welcome {{unknownVar}}')).toThrow(/Unknown template variable/);
  });

  it('validates relative link URLs for official bell notices', () => {
    expect(validateRelativeLink('/en/blog/nadeshiko-v3-0-0')).toBe('/en/blog/nadeshiko-v3-0-0');
    expect(validateRelativeLink('   ')).toBeNull();
    expect(() => validateRelativeLink('https://evil.com')).toThrow(/relative path/);
    expect(() => validateRelativeLink('//evil.com')).toThrow(/relative path/);
  });
});
