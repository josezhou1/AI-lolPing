import { describe, expect, it } from 'vitest';
import { AiProvider } from '../../src/main/aiProvider';

const profile = { id: 'p', name: 'test', baseUrl: 'https://example.com/v1', model: 'model', supportsVision: true };
const stream = (parts: string[]) => new Response(new ReadableStream<Uint8Array>({
  start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); },
}), { headers: { 'content-type': 'text/event-stream' } });

describe('AiProvider', () => {
  it('decodes SSE across arbitrary chunks and CRLF boundaries', async () => {
    const provider = new AiProvider(async () => stream(['data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\r', '\n\r\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n']));
    let answer = '';
    await provider.chat(profile, 'secret', [{ role: 'user', content: 'hello' }], new AbortController().signal,
      (delta) => { answer += delta; });
    expect(answer).toBe('Hello world');
  });

  it('accepts JSON fallback without exposing provider errors or keys', async () => {
    let provider = new AiProvider(async () => Response.json({ choices: [{ message: { content: 'Answer' } }] }));
    let answer = '';
    await provider.chat(profile, 'secret', [], new AbortController().signal, (delta) => { answer += delta; });
    expect(answer).toBe('Answer');
    provider = new AiProvider(async () => new Response('secret provider body', { status: 401 }));
    await expect(provider.models(profile, 'secret', new AbortController().signal)).rejects.toThrow('ai_auth_failed');
  });

  it('rejects malformed stream events and bounded response overflow', async () => {
    const provider = new AiProvider(async () => stream(['data: not json\n\n']));
    await expect(provider.chat(profile, 'key', [], new AbortController().signal, () => undefined))
      .rejects.toThrow('ai_invalid_response');
    const large = new AiProvider(async () => new Response('x'.repeat(1025)), { maxBytes: 1024 });
    await expect(large.models(profile, 'key', new AbortController().signal)).rejects.toThrow('ai_response_too_large');
  });

  it('times out even when fetch ignores cancellation', async () => {
    const provider = new AiProvider(() => new Promise<Response>(() => undefined), { timeoutMs: 5 });
    await expect(provider.models(profile, 'key', new AbortController().signal)).rejects.toThrow('ai_timeout');
  });

  it('finishes at DONE even if the server keeps its response stream open', async () => {
    const provider = new AiProvider(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n'));
      },
    }), { headers: { 'content-type': 'text/event-stream' } }), { timeoutMs: 10 });
    let answer = '';
    await provider.chat(profile, 'key', [], new AbortController().signal, (delta) => { answer += delta; });
    expect(answer).toBe('done');
  });

  it('extracts only bounded keywords and validates Tavily source URLs', async () => {
    const requests: string[] = [];
    const provider = new AiProvider(async (url, options) => {
      requests.push(String(options?.body));
      return String(url).includes('tavily') ? Response.json({ results: [{ title: 'Source', url: 'https://example.org' },
        { title: 'Unsafe', url: 'file:///secret' }] }) : Response.json({ choices: [{ message: { content: '{"keywords":"red fox animal"}' } }] });
    });
    const query = await provider.keywords(profile, 'key', 'A fox is visible', new AbortController().signal);
    const sources = await provider.search('search-secret', query, new AbortController().signal);
    expect(query).toBe('red fox animal');
    expect(sources).toEqual([{ title: 'Source', url: 'https://example.org' }]);
    expect(requests[1]).not.toContain('A fox is visible');
  });

  it('omits authorization for a local provider with no API key', async () => {
    let authorization: string | null = 'unset';
    const provider = new AiProvider(async (_url, options) => {
      authorization = new Headers(options?.headers).get('authorization');
      return Response.json({ data: [{ id: 'local-model' }] });
    });
    expect(await provider.models({ ...profile, baseUrl: 'http://localhost:11434/v1' }, '', new AbortController().signal))
      .toEqual(['local-model']);
    expect(authorization).toBeNull();
  });

  it('includes safe image sources when Tavily also returns web pages', async () => {
    const provider = new AiProvider(async () => Response.json({ results: Array.from({ length: 5 }, (_, index) =>
      ({ title: `Page ${index}`, url: `https://example.org/${index}` })),
    images: [{ url: 'https://example.org/fox.jpg', description: 'Red fox' }, { url: 'file:///bad', description: 'Bad' }] }));
    const sources = await provider.search('key', 'red fox', new AbortController().signal);
    expect(sources).toHaveLength(5);
    expect(sources).toContainEqual({ title: 'Red fox', url: 'https://example.org/fox.jpg' });
  });
});
