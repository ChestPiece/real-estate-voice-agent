import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { historyToTranscript, makeTools, mapTwilioStatus } from './tools.js';

export type Deps = {
  getAgentByClientSlug: typeof db.getAgentByClientSlug;
  insertLead: typeof db.insertLead;
  getLeadWithAgent: typeof db.getLeadWithAgent;
  upsertCall: typeof db.upsertCall;
  saveTranscript: typeof db.saveTranscript;
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

/** Unguessable path segment so only the TwiML we served can open a media stream. */
const streamToken = (leadId: string, callSid: string) =>
  createHmac('sha256', env('DIAL_API_KEY')).update(`${leadId}:${callSid}`).digest('hex');

const tokenMatches = (token: string, leadId: string, callSid: string) => {
  const expected = Buffer.from(streamToken(leadId, callSid));
  const given = Buffer.from(token);
  return !!env('DIAL_API_KEY') && given.length === expected.length && timingSafeEqual(given, expected);
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
    try {
      buildAgent(agent, { id: '', client_id: agent.client_id, name: null, phone, property: null, source: 'api' });
    } catch (err) {
      req.log.error({ err }, 'agent config cannot fill the prompt');
      return reply.code(500).send({ reason: 'agent_misconfigured' });
    }

    const lead = await deps.insertLead({
      client_id: agent.client_id,
      name: body.data.name ?? null,
      phone,
      property: body.data.property ?? null,
      source: 'api',
    });
    let callSid: string;
    try {
      callSid = await deps.placeCall(phone, lead.id);
    } catch (err) {
      req.log.error({ err }, 'twilio call create failed');
      return reply.code(502).send({ reason: 'dial_failed', leadId: lead.id, message: (err as Error).message });
    }
    await deps.upsertCall({ lead_id: lead.id, twilio_sid: callSid, status: 'queued' });
    return reply.code(202).send({ leadId: lead.id, callSid });
  });

  app.post<{ Params: { leadId: string } }>('/twiml/:leadId', async (req, reply) => {
    if (!isFromTwilio(req)) return reply.code(403).send();
    const callSid = ((req.body ?? {}) as Record<string, string>).CallSid;
    if (!callSid) return reply.code(400).send();
    const host = new URL(env('PUBLIC_URL')).host;
    const { leadId } = req.params;
    reply.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://${host}/media-stream/${leadId}/${callSid}/${streamToken(leadId, callSid)}" /></Connect></Response>`,
    );
  });

  app.post<{ Params: { leadId: string } }>('/call-status/:leadId', async (req, reply) => {
    if (!isFromTwilio(req)) return reply.code(403).send();
    const { CallSid, CallStatus } = (req.body ?? {}) as Record<string, string>;
    const status = mapTwilioStatus(CallStatus ?? '');
    if (status && CallSid) {
      const terminal = status !== 'in_progress';
      await deps.upsertCall({
        lead_id: req.params.leadId,
        twilio_sid: CallSid,
        status,
        ...(terminal && { ended_at: deps.now().toISOString() }),
      });
    }
    return reply.code(204).send();
  });

  app.register(async (scoped) => {
    scoped.get<{ Params: { leadId: string; callSid: string; token: string } }>(
      '/media-stream/:leadId/:callSid/:token',
      { websocket: true },
      async (socket, req) => {
        const { leadId, callSid, token } = req.params;
        if (!tokenMatches(token, leadId, callSid)) return socket.close();
        // Attach the transport before any await: it must see Twilio's 'start' frame to learn the streamSid.
        const transport = new TwilioRealtimeTransportLayer({ twilioWebSocket: socket });
        const found = await deps.getLeadWithAgent(leadId).catch(() => null);
        if (!found) return socket.close();
        let agent;
        try {
          agent = buildAgent(found.agent, found.lead, makeTools({ leadId: found.lead.id }));
        } catch (err) {
          req.log.error({ err }, 'agent config cannot fill the prompt');
          return socket.close();
        }

        const session = new RealtimeSession(agent, {
          transport,
          model: env('REALTIME_MODEL') || 'gpt-realtime-2.1',
          config: {
            audio: {
              input: {
                transcription: { model: 'gpt-live-transcribe' },
                turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: true },
              },
              output: { voice: found.agent.voice },
            },
          },
        });
        // Persist the transcript once, whichever way the call ends; never let this crash the worker.
        // Status is owned by Twilio's /call-status callbacks, so this writes the transcript only.
        let saved = false;
        const finish = async () => {
          if (saved) return;
          saved = true;
          try {
            session.close();
            await deps.saveTranscript(callSid, historyToTranscript(session.history));
          } catch (err) {
            req.log.error({ err }, 'failed to finish call');
          }
        };
        socket.on('close', () => void finish());
        socket.on('error', () => void finish());
        session.on('error', (e) => req.log.error({ err: e }, 'realtime session error'));

        try {
          await session.connect({ apiKey: env('OPENAI_API_KEY') });
        } catch (err) {
          req.log.error({ err }, 'realtime connect failed');
          socket.close();
          return finish();
        }
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
