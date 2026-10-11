import { describe, it, expect } from 'vitest';
import { RunContext } from '@openai/agents';
import { makeTools, historyToTranscript, mapTwilioStatus } from './tools.js';
import { mergeQualification } from './db.js';

const invoke = (t: any, args: object) => t.invoke(new RunContext({}), JSON.stringify(args));

describe('makeTools', () => {
  it('save_qualification stores the structured qualification for the lead', async () => {
    const saved: unknown[] = [];
    const tools = makeTools({ leadId: 'l1' }, {
      saveQualification: async (id, q) => void saved.push([id, q]),
      saveViewing: async () => {},
    });
    const q = { intent: 'buy', budget_aed: 1500000, areas: ['Dubai Marina'], bedrooms: 2, timeline: '3 months', notes: null };
    const out = await invoke(tools.find((t) => t.name === 'save_qualification'), q);
    expect(saved).toEqual([['l1', q]]);
    expect(typeof out).toBe('string');
  });

  it('book_viewing stores the agreed time', async () => {
    const saved: unknown[] = [];
    const tools = makeTools({ leadId: 'l1' }, {
      saveQualification: async () => {},
      saveViewing: async (id, v) => void saved.push([id, v]),
    });
    await invoke(tools.find((t) => t.name === 'book_viewing'), { preferred_time: 'Saturday 4pm', property: null });
    expect(saved).toEqual([['l1', { preferred_time: 'Saturday 4pm', property: null }]]);
  });
});

describe('mapTwilioStatus', () => {
  it.each([
    ['in-progress', 'in_progress'],
    ['completed', 'completed'],
    ['no-answer', 'no_answer'],
    ['busy', 'no_answer'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
    ['initiated', null],
    ['ringing', null],
  ])('%s → %s', (twilio, ours) => expect(mapTwilioStatus(twilio)).toBe(ours));
});

describe('historyToTranscript', () => {
  it('keeps spoken turns in order and drops non-message items', () => {
    const history = [
      { type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Hi Anas!' }] },
      { type: 'function_call', name: 'save_qualification' },
      { type: 'message', role: 'user', content: [{ type: 'input_audio', transcript: 'Hi, yes.' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_audio', transcript: null }] },
    ];
    expect(historyToTranscript(history as any)).toEqual([
      { role: 'assistant', text: 'Hi Anas!' },
      { role: 'user', text: 'Hi, yes.' },
    ]);
  });
});

describe('mergeQualification', () => {
  it('keeps earlier answers when a later save sends nulls or empty areas', () => {
    const first = mergeQualification(null, { intent: 'buy', budget_aed: 1500000, areas: ['Dubai Marina'], bedrooms: null, timeline: null, notes: null });
    const second = mergeQualification(first, { intent: null, budget_aed: null, areas: [], bedrooms: 2, timeline: null, notes: null });
    expect(second).toEqual({ intent: 'buy', budget_aed: 1500000, areas: ['Dubai Marina'], bedrooms: 2, timeline: null, notes: null });
  });
});
