/**
 * TEMPORARY (2026-11, about one week): browser signals that may tell automation from readers, recorded
 * as properties on events we already send. No new events, so no cost to the PostHog event budget.
 *
 * WHY. A distributed crawler was 28% of all events (docs: plans/posthog-event-budget.md). Today it is
 * recognised only by its screen-and-window shape (`utils/knownCrawlers.ts`), which it can change at
 * will. These signals are harder to fake. After a week, compare the crawler's shape against readers on
 * each signal, keep the ones that separate them with no reader caught, filter on those, and delete
 * this file.
 *
 * Values are coarse on purpose: booleans, small counts and a GPU *class*, never a raw renderer string,
 * so nothing here is a usable per-person fingerprint.
 */

type Signals = Record<string, string | number | boolean | null>;

type GpuClass = 'software' | 'hardware' | 'none' | 'pending';

let gpuClass: GpuClass = 'pending';

/** Software rasterisers stand in for a GPU on servers and in headless browsers. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i;

/**
 * Read the WebGL renderer once, off the critical path. Creating a context costs a few milliseconds,
 * so it waits for an idle moment and the context is released straight after.
 */
export function primeBotSignals(scope: Window | undefined = globalThis.window): void {
  if (!scope || gpuClass !== 'pending') return;
  const run = () => {
    gpuClass = readGpuClass(scope);
  };
  if (typeof scope.requestIdleCallback === 'function') scope.requestIdleCallback(run, { timeout: 5000 });
  else scope.setTimeout(run, 2000);
}

function readGpuClass(scope: Window): GpuClass {
  try {
    const canvas = scope.document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return SOFTWARE_GPU.test(renderer) ? 'software' : 'hardware';
  } catch {
    return 'none';
  }
}

function matches(scope: Window, query: string): boolean | null {
  try {
    return scope.matchMedia ? scope.matchMedia(query).matches : null;
  } catch {
    return null;
  }
}

/** The signals for this document, read now (all cheap) plus the GPU class once known. */
export function collectBotSignals(scope: Window | undefined = globalThis.window): Signals {
  if (!scope?.navigator) return {};
  const nav = scope.navigator as Navigator & {
    userAgentData?: { brands?: { brand: string }[] };
    deviceMemory?: number;
  };
  const brands = nav.userAgentData?.brands ?? [];
  return {
    bot_signal_webdriver: nav.webdriver === true,
    bot_signal_touch_points: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : null,
    bot_signal_pointer_coarse: matches(scope, '(pointer: coarse)'),
    bot_signal_hover: matches(scope, '(hover: hover)'),
    // A window with no real frame reports outer dimensions of 0 or smaller than the page itself.
    bot_signal_outer_smaller: scope.outerWidth < scope.innerWidth || scope.outerHeight < scope.innerHeight,
    bot_signal_outer_zero: scope.outerWidth === 0 || scope.outerHeight === 0,
    bot_signal_plugins: nav.plugins ? nav.plugins.length : null,
    bot_signal_languages: nav.languages ? nav.languages.length : null,
    bot_signal_headless_brand: brands.some((b) => /headless/i.test(b.brand)),
    bot_signal_chrome_object: typeof (scope as Window & { chrome?: unknown }).chrome === 'object',
    bot_signal_cpu: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    bot_signal_memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    bot_signal_dpr: typeof scope.devicePixelRatio === 'number' ? scope.devicePixelRatio : null,
    bot_signal_gpu: gpuClass,
  };
}

/** Events that carry the signals: one per page load, plus the dwell events that fire after the GPU read. */
export const BOT_SIGNAL_EVENTS: ReadonlySet<string> = new Set(['$pageview', 'page_engaged', 'shared_link_read']);

/** Test seam. */
export function resetBotSignals(): void {
  gpuClass = 'pending';
}
