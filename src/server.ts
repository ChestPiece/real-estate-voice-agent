import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { RealtimeSession } from '@openai/agents/realtime';
import { TwilioRealtimeTransportLayer } from '@openai/agents-extensions';
import twilio from 'twilio';
import { z } from 'zod';
import { buildAgent } from './agent.js';
import { isWithinCallingHours, normalizePhone } from './core.js';
import * as db from './db.js';

export type Deps = {
  getAgentByClientSlug: typeof db.getAgentByClientSlug;
  insertLead: typeof db.insertLead;
  getLeadWithAgent: typeof db.getLeadWithAgent;
  upsertCall: typeof db.upsertCall;
  placeCall: (to: string, leadId: string) => Promise<string>;
  validateTwilio: (signature: string | undefined, url: string, params: Record<string, string>) => boolean;
  now: () => Date;
};

const env = (key: string) => process.env[key] ?? '';

const defaultDeps: Deps = {
  ...db,
  placeCall: async (to, leadId) => {
    const call = await twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN')).calls.create({
      to,
      from: env('TWILIO_FROM_NUMBER'),
      url: `${env('PUBLIC_URL')}/twiml/${leadId}`,
      statusCallback: `${env('PUBLIC_URL')}/call-status/${leadId}`,
      statusCallbackEvent: ['initiated', 'answered', 'completed'],
    });
    return call.sid;
  },
  validateTwilio: (signature, url, params) =>
    !!signature && twilio.validateRequest(env('TWILIO_AUTH_TOKEN'), signature, url, params),
  now: () => new Date(),
};

const DialBody = z.object({
  clientSlug: z.string().min(1),
  name: z.string().optional(),
  phone: z.string(),
  property: z.string().optional(),
});

export function buildServer(deps: Deps = defaultDeps): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST });
  app.register(fastifyFormBody);
  app.register(fastifyWs);

  const isFromTwilio = (req: FastifyRequest) =>
    deps.validateTwilio(
      req.headers['x-twilio-signature'] as string | undefined,
      env('PUBLIC_URL') + req.url,
      (req.body ?? {}) as Record<string, string>,
    );

  app.post('/dial', async (req, reply) => {
    if (!env('DIAL_API_KEY') || req.headers['x-api-key'] !== env('DIAL_API_KEY')) return reply.code(401).send();
    const body = DialBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ reason: 'invalid_body' });
    const phone = normalizePhone(body.data.phone);
    if (!phone) return reply.code(400).send({ reason: 'invalid_phone' });
    const agent = await deps.getAgentByClientSlug(body.data.clientSlug);
    if (!agent) return reply.code(404).send({ reason: 'unknown_client' });
    if (!isWithinCallingHours(deps.now(), { start: agent.calling_start, end: agent.calling_end }))
      return reply.code(409).send({ reason: 'outside_calling_hours' });

    const lead = await deps.insertLead({
      client_id: agent.client_id,
      name: body.data.name ?? null,
      phone,
      property: body.data.property ?? null,
      source: 'api',
    });
    const callSid = await deps.placeCall(phone, lead.id);
    await deps.upsertCall({ lead_id: lead.id, twilio_sid: callSid, status: 'queued' });
    return reply.code(202).send({ leadId: lead.id, callSid });
  });

  app.all<{ Params: { leadId: string } }>('/twiml/:leadId', async (req, reply) => {
    if (!isFromTwilio(req)) return reply.code(403).send();
    const callSid = ((req.body ?? {}) as Record<string, string>).CallSid ?? 'unknown';
    const host = new URL(env('PUBLIC_URL')).host;
    reply.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://${host}/media-stream/${req.params.leadId}/${callSid}" /></Connect></Response>`,
    );
  });

  app.register(async (scoped) => {
    scoped.get<{ Params: { leadId: string; callSid: string } }>(
      '/media-stream/:leadId/:callSid',
      { websocket: true },
      async (socket, req) => {
        const found = await deps.getLeadWithAgent(req.params.leadId).catch(() => null);
        if (!found) return socket.close();

        const session = new RealtimeSession(buildAgent(found.agent, found.lead), {
          transport: new TwilioRealtimeTransportLayer({ twilioWebSocket: socket }),
          model: env('REALTIME_MODEL') || 'gpt-realtime-2.1',
          config: {
            audio: {
              input: { turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: true } },
              output: { voice: found.agent.voice },
            },
          },
        });
        await session.connect({ apiKey: env('OPENAI_API_KEY') });
        // Outbound call: the agent speaks first (the prompt's opening line).
        session.transport.sendEvent({ type: 'response.create' });
      },
    );
  });

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildServer()
    .listen({ port: Number(env('PORT')) || 5050, host: '0.0.0.0' })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
