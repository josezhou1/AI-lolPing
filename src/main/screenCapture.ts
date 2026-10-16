interface CaptureSource {
  display_id: string;
  thumbnail: { isEmpty(): boolean; toJPEG(quality: number): Buffer };
}

interface CaptureDeps {
  sources(options: { types: Array<'screen'>; thumbnailSize: { width: number; height: number } }): Promise<CaptureSource[]>;
  hidden<T>(capture: () => Promise<T>): Promise<T>;
}

/** Serializes desktop snapshots so overlapping jobs cannot reveal another job's hidden overlay. */
export class ScreenCaptureService {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CaptureDeps) {}

  capture(display: { id: number; width: number; height: number; scale: number }, signal?: AbortSignal): Promise<string> {
    const check = (): void => { if (signal?.aborted) throw new Error('ai_cancelled'); };
    const run = this.pending.catch(() => undefined).then(() => {
      check();
      return this.deps.hidden(async () => {
        check();
        const factor = Math.min(display.scale, 4096 / Math.max(display.width, display.height));
        let cancel: () => void = () => undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new Error('ai_cancelled'));
          signal?.addEventListener('abort', cancel, { once: true });
        });
        let sources: CaptureSource[];
        try {
          sources = await Promise.race([this.deps.sources({
            types: ['screen'],
            thumbnailSize: { width: Math.round(display.width * factor), height: Math.round(display.height * factor) },
          }), aborted]);
        } finally { signal?.removeEventListener('abort', cancel); }
        check();
        const source = sources.find((s) => s.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('capture_failed');
        const bytes = source.thumbnail.toJPEG(90);
        if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('capture_failed');
        return `data:image/jpeg;base64,${bytes.toString('base64')}`;
      });
    });
    this.pending = run;
    return run;
  }
}
