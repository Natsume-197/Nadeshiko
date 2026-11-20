import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireImportSlot,
  hasRoomForAnotherImport,
  IMPORT_MEMORY_BYTES,
  releaseImportSlot,
  runningImports,
} from '@app/services/dictionary/custom/importAdmission';

const GB = 1024 * 1024 * 1024;

afterEach(() => {
  while (runningImports() > 0) releaseImportSlot();
});

describe('import admission', () => {
  it('has room while used memory plus one import stays under 85% of the limit', () => {
    expect(hasRoomForAnotherImport({ used: 0.5 * GB, limit: 1.5 * GB })).toBe(true);
    expect(hasRoomForAnotherImport({ used: 1.5 * GB * 0.85 - IMPORT_MEMORY_BYTES, limit: 1.5 * GB })).toBe(true);
    expect(hasRoomForAnotherImport({ used: 1.2 * GB, limit: 1.5 * GB })).toBe(false);
  });

  it('always lets the first import run, even with no room', async () => {
    await acquireImportSlot(
      async () => ({ used: 10 * GB, limit: 1 * GB }),
      async () => {},
    );
    expect(runningImports()).toBe(1);
  });

  it('starts a second import at once when there is room', async () => {
    await acquireImportSlot();
    await acquireImportSlot(
      async () => ({ used: 0.3 * GB, limit: 1.5 * GB }),
      async () => {},
    );
    expect(runningImports()).toBe(2);
  });

  it('holds a second import until memory frees up, then starts it', async () => {
    await acquireImportSlot();
    const readings = [
      { used: 1.3 * GB, limit: 1.5 * GB },
      { used: 1.3 * GB, limit: 1.5 * GB },
      { used: 0.4 * GB, limit: 1.5 * GB },
    ];
    let reads = 0;
    let sleeps = 0;
    await acquireImportSlot(
      async () => readings[Math.min(reads++, readings.length - 1)] as { used: number; limit: number },
      async () => {
        sleeps += 1;
      },
    );
    expect(sleeps).toBe(2);
    expect(runningImports()).toBe(2);
  });

  it('never counts below zero', () => {
    releaseImportSlot();
    expect(runningImports()).toBe(0);
  });
});
