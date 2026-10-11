import { tool, type RealtimeItem } from '@openai/agents/realtime';
import { z } from 'zod';
import * as db from './db.js';

type Store = Pick<typeof db, 'saveQualification' | 'saveViewing'>;

export function makeTools(ctx: { leadId: string }, store: Store = db): ReturnType<typeof tool>[] {
  return [
    tool({
      name: 'save_qualification',
      description:
        'Save what you have learned about the lead. Call it once you know buy/rent, budget and area, and call it again whenever you learn more. Use null for anything not yet known.',
      parameters: z.object({
        intent: z.enum(['buy', 'rent']),
        budget_aed: z.number().nullable().describe('Budget in AED as a plain number, e.g. 1.5 million = 1500000'),
        areas: z.array(z.string()),
        bedrooms: z.number().int().nullable(),
        timeline: z.string().nullable(),
        notes: z.string().nullable(),
      }),
      execute: async (q) => {
        await store.saveQualification(ctx.leadId, q);
        return 'Saved.';
      },
    }),
    tool({
      name: 'book_viewing',
      description:
        'Book a viewing or callback with the property consultant. Only call this after reading the day and time back to the lead and hearing them confirm.',
      parameters: z.object({
        preferred_time: z.string().describe('The agreed day and time in the lead\'s words, e.g. "Saturday at 4pm"'),
        property: z.string().nullable(),
      }),
      execute: async (v) => {
        await store.saveViewing(ctx.leadId, v);
        return 'Booked. Tell the lead the consultant will confirm by message.';
      },
    }),
  ];
}

const statusMap: Record<string, db.CallStatus> = {
  'in-progress': 'in_progress',
  completed: 'completed',
  'no-answer': 'no_answer',
  busy: 'no_answer',
  failed: 'failed',
  canceled: 'failed',
};

/** Twilio CallStatus → our status; null for transient states we don't store. */
export function mapTwilioStatus(twilioStatus: string): db.CallStatus | null {
  return statusMap[twilioStatus] ?? null;
}

export function historyToTranscript(history: RealtimeItem[]): { role: string; text: string }[] {
  return history.flatMap((item) => {
    if (item.type !== 'message') return [];
    const text = item.content
      .map((c) => ('transcript' in c ? c.transcript : 'text' in c ? c.text : null))
      .filter(Boolean)
      .join(' ');
    return text ? [{ role: item.role, text }] : [];
  });
}
