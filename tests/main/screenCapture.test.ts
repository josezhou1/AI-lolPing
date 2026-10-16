import { describe, expect, it, vi } from 'vitest';
import { ScreenCaptureService } from '../../src/main/screenCapture';

describe('ScreenCaptureService', () => {
  it('uses the marked display and never substitutes the primary screen', async () => {
    const service = new ScreenCaptureService({
      sources: async () => [
        { display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('primary') } },
        { display_id: '2', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('marked') } },
      ],
      hidden: async (fn) => fn(),
    });
    expect(await service.capture({ id: 2, width: 1280, height: 1024, scale: 1.5 }))
      .toBe('data:image/jpeg;base64,bWFya2Vk');
    await expect(service.capture({ id: 3, width: 1280, height: 1024, scale: 1 })).rejects.toThrow('capture_failed');
  });

  it('serializes captures so one cannot restore overlays during another capture', async () => {
    const events: string[] = [];
    const service = new ScreenCaptureService({
      sources: async () => [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('x') } }],
      hidden: async (fn) => { events.push('hide'); const result = await fn(); events.push('restore'); return result; },
    });
    await Promise.all([1, 2].map(() => service.capture({ id: 1, width: 1920, height: 1080, scale: 1 })));
    expect(events).toEqual(['hide', 'restore', 'hide', 'restore']);
  });

  it('skips canceled queued captures and drops an active result after cancellation', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let captures = 0;
    let hidden = 0;
    let restored = 0;
    let encoded = 0;
    const service = new ScreenCaptureService({
      sources: async () => {
        captures++;
        await blocked;
        return [{ display_id: '1', thumbnail: { isEmpty: () => false,
          toJPEG: () => { encoded++; return Buffer.from('private'); } } }];
      },
      hidden: async (fn) => { hidden++; try { return await fn(); } finally { restored++; } },
    });
    const controller = new AbortController();
    const results = Promise.allSettled([1, 2, 3].map(() => service.capture(
      { id: 1, width: 1920, height: 1080, scale: 1 }, controller.signal)));
    await vi.waitFor(() => expect(captures).toBe(1));
    controller.abort();
    try {
      await vi.waitFor(() => expect(restored).toBe(1), { timeout: 100 });
    } finally { release(); }
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(captures).toBe(1);
    expect(hidden).toBe(1);
    expect(encoded).toBe(0);
  });
});
