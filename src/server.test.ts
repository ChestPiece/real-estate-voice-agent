import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer, type Deps } from './server.js';
import type { AgentConfig, Lead } from './db.js';

const agent: AgentConfig = {
  id: 'a1', client_id: 'c1', persona_name: 'Sara', brokerage_name: 'Marina Bay Realty', agent_name: 'Omar',
  voice: 'verse', prompt_vars: {}, calling_start: '09:00', calling_end: '18:00', transfer_number: null,
};

let placed: { to: string; leadId: string }[];
let calls: unknown[];

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    getAgentByClientSlug: async (slug) => (slug === 'demo' ? agent : null),
    insertLead: async (l) => ({ ...l, id: 'lead-1' }) as Lead,
    getLeadWithAgent: async () => null,
    upsertCall: async (c) => void calls.push(c),
    placeCall: async (to, leadId) => (placed.push({ to, leadId }), 'CA123'),
    validateTwilio: () => false,
    now: () => new Date('2026-10-11T08:00:00Z'), // 12:00 Dubai
    ...overrides,
  };
}

const dial = (app: ReturnType<typeof buildServer>, body: object, key = 'secret') =>
  app.inject({ method: 'POST', url: '/dial', headers: { 'x-api-key': key }, payload: body });

beforeEach(() => {
  placed = [];
  calls = [];
  process.env.DIAL_API_KEY = 'secret';
  process.env.PUBLIC_URL = 'https://example.ngrok.app';
});

describe('POST /dial', () => {
  it('401 without the api key', async () => {
    const res = await dial(buildServer(deps()), { clientSlug: 'demo', phone: '0501234567' }, 'wrong');
    expect(res.statusCode).toBe(401);
    expect(placed).toHaveLength(0);
  });

  it('400 invalid_phone for garbage numbers', async () => {
    const res = await dial(buildServer(deps()), { clientSlug: 'demo', phone: '123' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ reason: 'invalid_phone' });
    expect(placed).toHaveLength(0);
  });

  it('400 invalid_body when phone is missing', async () => {
    const res = await dial(buildServer(deps()), { clientSlug: 'demo' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ reason: 'invalid_body' });
  });

  it('404 unknown_client', async () => {
    const res = await dial(buildServer(deps()), { clientSlug: 'nope', phone: '0501234567' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ reason: 'unknown_client' });
  });

  it('409 outside calling hours and places no call', async () => {
    const app = buildServer(deps({ now: () => new Date('2026-10-11T15:00:00Z') })); // 19:00 Dubai
    const res = await dial(app, { clientSlug: 'demo', phone: '0501234567' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ reason: 'outside_calling_hours' });
    expect(placed).toHaveLength(0);
  });

  it('202 places the call to the normalized number and records it queued', async () => {
    const res = await dial(buildServer(deps()), { clientSlug: 'demo', name: 'Anas', phone: '050 123 4567', property: '2BR Marina' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ leadId: 'lead-1', callSid: 'CA123' });
    expect(placed).toEqual([{ to: '+971501234567', leadId: 'lead-1' }]);
    expect(calls).toEqual([{ lead_id: 'lead-1', twilio_sid: 'CA123', status: 'queued' }]);
  });
});

describe('Twilio webhooks', () => {
  it('403 on unsigned /twiml', async () => {
    const res = await buildServer(deps()).inject({ method: 'POST', url: '/twiml/lead-1' });
    expect(res.statusCode).toBe(403);
  });

  it('signed /twiml streams to the lead media socket', async () => {
    const res = await buildServer(deps({ validateTwilio: () => true })).inject({ method: 'POST', url: '/twiml/lead-1', payload: 'CallSid=CA123', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Stream url="wss://example.ngrok.app/media-stream/lead-1/CA123"');
  });
});
