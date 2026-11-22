/**
 * WP6 executor & portal adapters — acceptance tests from docs/TASKS.md (WP6).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { GeminiCuModel } from '../src/portal/cu';

describe('WP6 executor & portal adapters', () => {
  it('sends v1 Computer Use inputs and records usage for each interaction', async () => {
    const ai = new GoogleGenAI({ apiKey: 'offline-test-key' });
    const create = vi
      .spyOn(ai.interactions, 'create')
      .mockResolvedValueOnce({
        id: 'first',
        status: 'completed',
        steps: [{ type: 'function_call', id: 'action', name: 'click', arguments: { x: 30, y: 50 } }],
        usage: { total_input_tokens: 11, total_output_tokens: 3, total_thought_tokens: 2 },
      })
      .mockResolvedValueOnce({ id: 'second', status: 'completed', steps: [], usage: { total_input_tokens: 13, total_output_tokens: 2 } });
    const usage = vi.fn();
    const model = new GeminiCuModel(ai, 'test-model', usage);
    const png = Buffer.from('test screenshot');
    const url = 'http://localhost/appeal/start';
    const [action] = await model.start('Find the ticket field', png, url);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        input: [
          {
            type: 'user_input',
            content: [
              { type: 'text', text: `Find the ticket field\nCurrent URL: ${url}` },
              { type: 'image', mime_type: 'image/png', data: png.toString('base64') },
            ],
          },
        ],
      }),
    );
    await model.next([{ action, ok: true, url, png }]);
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previous_interaction_id: 'first',
        input: [
          {
            type: 'function_result',
            name: 'click',
            call_id: 'action',
            result: [
              { type: 'text', text: JSON.stringify({ url }) },
              { type: 'image', mime_type: 'image/png', data: png.toString('base64') },
            ],
          },
        ],
      }),
    );
    expect(usage.mock.calls).toEqual([
      [11, 5],
      [13, 2],
    ]);
  });

  it('hands a provider safety block back to the user', async () => {
    const ai = new GoogleGenAI({ apiKey: 'offline-test-key' });
    vi.spyOn(ai.interactions, 'create').mockRejectedValue(new Error('400 Request blocked due to safety violations (harmful content).'));
    const model = new GeminiCuModel(ai, 'test-model', vi.fn());
    await expect(model.start('Fill a field', Buffer.from('test screenshot'), 'http://localhost/appeal/start')).rejects.toMatchObject({ code: 'CU_SAFETY' });
  });

  it.todo('wp6: every v0.2 portal scenario still passes on the v2 flow');
  it.todo('wp6: session_expired re-runs safely and still files exactly one appeal');
  it.todo('wp6: upload_rejected ends in NEEDS_USER with a clear reason');
  it.todo('wp6: injected page text never changes executor actions');
  it.todo('wp6: fake CU hits every /calibrate target within 1% of the viewport');
});
