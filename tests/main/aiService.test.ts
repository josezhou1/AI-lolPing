import { describe, expect, it, vi } from 'vitest';
import { AiService } from '../../src/main/aiService';
import type { AiConfig, AiConversation } from '../../src/shared/ai';

const profile = { id: 'p', name: 'test', baseUrl: 'https://example.com/v1', model: 'vision', supportsVision: true };
const point = { displayId: 1, x: 100, y: 200, width: 1920, height: 1080 };
const image = 'data:image/png;base64,AAAA';
function setup(fetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: 'Answer' } }] }),
  deleting?: (id: string) => Promise<void>) {
  let config: AiConfig = { profiles: [profile], defaultChatProfileId: 'p', defaultVisionProfileId: 'p',
    paused: false, visionMinutes: 5, searchEnabled: false };
  let saved: AiConversation[] = [];
  const keys = new Map([['p', 'key']]);
  let time = 1000;
  let sequence = 0;
  const completions: string[] = [];
  const fired: string[] = [];
  const service = new AiService({ getConfig: () => config, updateConfig: (next) => { config = next; },
    credentials: { get: (id) => keys.get(id), ids: () => [...keys.keys()],
      set: async (id, key) => { keys.set(id, key); }, delete: async (id) => { await deleting?.(id); keys.delete(id); } },
    history: { load: () => saved, save: async (history) => { saved = structuredClone(history); }, flush: async () => undefined },
    fetch: fetcher, now: () => time, id: () => `id${++sequence}`,
    completed: (id) => { completions.push(id); }, timerDue: (timer) => { fired.push(timer.id); } });
  return { service, completions, fired, saved: () => saved, keys, advance: (ms: number) => { time += ms; } };
}

describe('AiService', () => {
  it('coalesces a burst of stream tokens into one running snapshot', async () => {
    vi.useFakeTimers();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({ start: (controller) => { stream = controller; } });
    const fixture = setup(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const updates: string[] = [];
    fixture.service.subscribe((snapshot) => {
      const conversation = snapshot.conversations[0];
      const answer = conversation?.messages.find((message) => message.role === 'assistant');
      if (conversation?.status === 'running' && answer) updates.push(answer.content);
    });
    try {
      const id = await fixture.service.create();
      await fixture.service.send(id, 'question');
      const token = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`;
      stream?.enqueue(new TextEncoder().encode(token.repeat(100)));
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.service.snapshot().conversations[0]?.messages.at(-1)?.content).toBe('x'.repeat(100));
      expect(updates).toEqual([]);
      await vi.advanceTimersByTimeAsync(50);
      expect(updates).toEqual(['x'.repeat(100)]);
      stream?.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      stream?.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed');
    } finally {
      await fixture.service.close();
      vi.useRealTimers();
    }
  });

  it('preserves pause and later profile edits while credential deletion is pending', async () => {
    let release: () => void = () => undefined;
    const deleting = new Promise<void>((resolve) => { release = resolve; });
    const fixture = setup(undefined, async () => deleting);
    const removal = fixture.service.deleteProfile('p');
    await fixture.service.configure({ paused: true, visionMinutes: 17, searchEnabled: true });
    await fixture.service.saveProfile({ ...profile, id: 'q', name: 'New' }, 'new-key');
    release();
    await removal;
    const snapshot = fixture.service.snapshot();
    expect(snapshot.config.paused).toBe(true);
    expect(snapshot.config.visionMinutes).toBe(17);
    expect(snapshot.config.searchEnabled).toBe(true);
    expect(snapshot.config.profiles.map((p) => p.id)).toEqual(['q']);
    const id = await fixture.service.create('q');
    await expect(fixture.service.send(id, 'question')).rejects.toThrow('ai_paused');
    await fixture.service.close();
  });

  it('keeps conversations isolated and sends a snapshot of the profile and key', async () => {
    const bodies: string[] = [];
    const fixture = setup(async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({ choices: [{ message: { content: 'Answer' } }] });
    });
    const first = await fixture.service.create();
    await fixture.service.send(first, 'first question');
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed'));
    const second = await fixture.service.create();
    await fixture.service.send(second, 'second question');
    await vi.waitFor(() => expect(fixture.completions).toHaveLength(2));
    expect(bodies[1]).not.toContain('first question');
    expect(fixture.service.snapshot().conversations[0]?.messages).toHaveLength(2);
    expect(JSON.stringify(fixture.saved())).not.toContain('"key"');
    await fixture.service.close();
  });

  it('captures at marking time and never persists screenshots', async () => {
    let body = '';
    const fixture = setup(async (_url, options) => {
      body = String(options?.body);
      return Response.json({ choices: [{ message: { content: 'Article explanation' } }] });
    });
    let captures = 0;
    await fixture.service.analyze(point, async () => { captures++; return image; });
    expect(captures).toBe(1);
    await vi.waitFor(() => expect(fixture.completions).toHaveLength(1));
    expect(body).toContain(image);
    expect(body).toContain('untrusted');
    expect(JSON.stringify(fixture.service.snapshot())).not.toContain('base64');
    expect(JSON.stringify(fixture.saved())).not.toContain('base64');
    await fixture.service.close();
  });

  it('validates pause and visual profile before capture', async () => {
    const { service } = setup();
    let captured = false;
    await service.configure({ paused: true });
    await expect(service.analyze(point, async () => { captured = true; return image; })).rejects.toThrow('ai_paused');
    expect(captured).toBe(false);
    await service.configure({ paused: false, defaultVisionProfileId: null });
    await expect(service.analyze(point, async () => image)).rejects.toThrow('ai_vision_profile_required');
    await service.close();
  });

  it('reserves capacity for pending captures and caps running plus queued work', async () => {
    const { service } = setup(() => new Promise<Response>(() => undefined));
    const resolvers: Array<(value: string) => void> = [];
    const pending: Promise<void>[] = [];
    for (let n = 0; n < 13; n++) pending.push(service.analyze(point, () => new Promise((resolve) => { resolvers.push(resolve); })));
    expect(service.snapshot().conversations.filter((c) => c.status === 'queued')).toHaveLength(10);
    let extraCapture = false;
    await expect(service.analyze(point, async () => { extraCapture = true; return image; })).rejects.toThrow('ai_capacity');
    expect(extraCapture).toBe(false);
    for (const resolve of resolvers) resolve(image);
    await Promise.all(pending);
    expect(service.snapshot().conversations.filter((c) => c.status === 'running')).toHaveLength(3);
    expect(service.snapshot().conversations.filter((c) => c.status === 'queued')).toHaveLength(10);
    await service.close();
  });

  it('ignores late responses after danger pause and never emits completion', async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fixture = setup(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const id = await fixture.service.create();
    await fixture.service.send(id, 'question');
    await fixture.service.configure({ paused: true });
    resolveFetch(Response.json({ choices: [{ message: { content: 'late answer' } }] }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const conversation = fixture.service.snapshot().conversations[0];
    expect(conversation?.status).toBe('cancelled');
    expect(conversation?.messages).toEqual([{ id: expect.any(String), role: 'user', content: 'question' }]);
    expect(fixture.completions).toEqual([]);
    await fixture.service.close();
  });

  it('retains text partials on failure and retry replaces the latest assistant', async () => {
    let request = 0;
    const fixture = setup(async () => {
      request++;
      if (request === 1) return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: bad\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ choices: [{ message: { content: 'complete' } }] });
    });
    const id = await fixture.service.create();
    await fixture.service.send(id, 'question');
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('error'));
    expect(fixture.service.snapshot().conversations[0]?.messages[1]?.content).toBe('partial');
    await fixture.service.retry(id);
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed'));
    expect(fixture.service.snapshot().conversations[0]?.messages.map((m) => m.content)).toEqual(['question', 'complete']);
    await fixture.service.close();
  });

  it('requires recapture to retry an image job after its image is cleared', async () => {
    const { service } = setup(async () => new Response('', { status: 500 }));
    await service.analyze(point, async () => image);
    await vi.waitFor(() => expect(service.snapshot().conversations[0]?.status).toBe('error'));
    const id = service.snapshot().conversations[0]?.id ?? '';
    await expect(service.retry(id)).rejects.toThrow('ai_recapture_required');
    await service.close();
  });

  it('fires each timer once across sleep and keeps timers independent of pause', async () => {
    const fixture = setup();
    const timer = fixture.service.addTimer(point);
    await fixture.service.adjustTimer(timer.id, 2);
    expect(fixture.service.snapshot().config.visionMinutes).toBe(5);
    await fixture.service.configure({ paused: true });
    fixture.advance(180000);
    fixture.service.tick(); fixture.service.tick();
    expect(fixture.fired).toEqual([timer.id]);
    expect(fixture.service.snapshot().timers).toEqual([]);
    await fixture.service.close();
  });

  it('restarts the interval and displayed duration when a timer is adjusted later', async () => {
    const fixture = setup();
    const timer = fixture.service.addTimer(point);
    fixture.advance(240000);
    await fixture.service.adjustTimer(timer.id, 10);
    const adjusted = fixture.service.snapshot().timers[0];
    expect(adjusted.createdAt).toBe(timer.createdAt + 240000);
    expect(adjusted.dueAt - adjusted.createdAt).toBe(600000);
    expect(fixture.service.snapshot().config.visionMinutes).toBe(5);
    fixture.advance(599999);
    fixture.service.tick();
    expect(fixture.fired).toEqual([]);
    fixture.advance(1);
    fixture.service.tick();
    expect(fixture.fired).toEqual([timer.id]);
    await fixture.service.close();
  });

  it('keeps a queued request on its accepted endpoint, model and credential after edits', async () => {
    const accepted: Array<{ url: string; model: string; key: string | null }> = [];
    const blocked: Array<(response: Response) => void> = [];
    const fixture = setup((url, options) => {
      const body: unknown = JSON.parse(String(options?.body));
      const model = typeof body === 'object' && body !== null && 'model' in body ? String(body.model) : '';
      accepted.push({ url: String(url), model, key: new Headers(options?.headers).get('authorization') });
      return new Promise((resolve) => { blocked.push(resolve); });
    });
    for (let n = 0; n < 4; n++) {
      const id = await fixture.service.create();
      await fixture.service.send(id, `question ${n}`);
    }
    await fixture.service.saveProfile({ ...profile, baseUrl: 'https://changed.example/v1', model: 'changed' }, 'new-key');
    blocked[0]?.(Response.json({ choices: [{ message: { content: 'Answer' } }] }));
    await vi.waitFor(() => expect(accepted).toHaveLength(4));
    expect(accepted[3]).toEqual({ url: 'https://example.com/v1/chat/completions', model: 'vision', key: 'Bearer key' });
    await fixture.service.close();
  });

  it('cancels model requests when paused even when the transport ignores AbortSignal', async () => {
    const fixture = setup(() => new Promise<Response>(() => undefined));
    const modelRequest = fixture.service.models('p');
    const rejected = expect(modelRequest).rejects.toThrow('ai_cancelled');
    await fixture.service.configure({ paused: true });
    await rejected;
    await fixture.service.close();
  });

  it('passes cancellation into the desktop capture queue when paused', async () => {
    const fixture = setup();
    let signal: AbortSignal | undefined;
    const analysis = fixture.service.analyze(point, async (current) => {
      signal = current;
      return new Promise<string>(() => undefined);
    });
    await fixture.service.configure({ paused: true });
    await analysis;
    expect(signal?.aborted).toBe(true);
    expect(fixture.service.snapshot().conversations[0]?.status).toBe('cancelled');
    await fixture.service.close();
  });

  it('allows a local provider without a credential and refuses a remote provider without one', async () => {
    const fixture = setup();
    fixture.keys.clear();
    const id = await fixture.service.create();
    await expect(fixture.service.send(id, 'question')).rejects.toThrow('ai_key_required');
    await fixture.service.saveProfile({ ...profile, baseUrl: 'http://localhost:11434/v1' });
    await fixture.service.send(id, 'question');
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed'));
    await fixture.service.close();
  });

  it('searches only generated keywords and attaches safe sources to the visual answer', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fixture = setup(async (url, options) => {
      requests.push({ url: String(url), body: String(options?.body) });
      if (String(url).includes('tavily')) return Response.json({ results: [{ title: 'Fox', url: 'https://example.org/fox' }] });
      return Response.json({ choices: [{ message: { content: requests.length === 1 ? 'A red fox'
        : '{"keywords":"red fox animal"}' } }] });
    });
    await fixture.service.setSearchKey('search-key');
    await fixture.service.configure({ searchEnabled: true });
    await fixture.service.analyze(point, async () => image);
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed'));
    expect(requests).toHaveLength(3);
    expect(requests[2]?.body).toContain('red fox animal');
    expect(requests[2]?.body).not.toContain(image);
    expect(fixture.service.snapshot().conversations[0]?.messages[1]?.sources)
      .toEqual([{ title: 'Fox', url: 'https://example.org/fox' }]);
    await fixture.service.close();
  });

  it('reports search failures while keeping a successful visual explanation', async () => {
    const fixture = setup(async (url) => String(url).includes('tavily') ? new Response('', { status: 500 })
      : Response.json({ choices: [{ message: { content: 'A fox' } }] }));
    await fixture.service.setSearchKey('search-key');
    await fixture.service.configure({ searchEnabled: true });
    await fixture.service.analyze(point, async () => image);
    await vi.waitFor(() => expect(fixture.service.snapshot().conversations[0]?.status).toBe('completed'));
    expect(fixture.service.snapshot().conversations[0]?.messages[1]?.content).toBe('A fox');
    expect(fixture.service.snapshot().conversations[0]?.error).toBe('ai_search_failed');
    await fixture.service.close();
  });
});
