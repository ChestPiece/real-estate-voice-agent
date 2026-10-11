import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AgentConfig = {
  id: string;
  client_id: string;
  persona_name: string;
  brokerage_name: string;
  agent_name: string;
  voice: string;
  prompt_vars: Record<string, string>;
  calling_start: string;
  calling_end: string;
  transfer_number: string | null;
};

export type Lead = {
  id: string;
  client_id: string;
  name: string | null;
  phone: string;
  property: string | null;
  source: string;
};

export type Qualification = {
  intent: 'buy' | 'rent';
  budget_aed: number | null;
  areas: string[];
  bedrooms: number | null;
  timeline: string | null;
  notes: string | null;
};

export type CallStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'no_answer';

let client: SupabaseClient | undefined;
function db(): SupabaseClient {
  return (client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }));
}

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export async function getAgentByClientSlug(slug: string): Promise<AgentConfig | null> {
  const c = unwrap(await db().from('clients').select('id').eq('slug', slug).maybeSingle());
  if (!c) return null;
  return unwrap(await db().from('agents').select('*').eq('client_id', c.id).limit(1).maybeSingle());
}

export async function insertLead(input: Omit<Lead, 'id'>): Promise<Lead> {
  const lead = unwrap(await db().from('leads').insert(input).select('id, client_id, name, phone, property, source').single());
  return lead!; // .single() errors (thrown by unwrap) when no row comes back
}

export async function getLeadWithAgent(leadId: string): Promise<{ lead: Lead; agent: AgentConfig } | null> {
  const lead = unwrap(
    await db().from('leads').select('id, client_id, name, phone, property, source').eq('id', leadId).maybeSingle(),
  );
  if (!lead) return null;
  const agent = unwrap(await db().from('agents').select('*').eq('client_id', lead.client_id).limit(1).maybeSingle());
  return agent ? { lead, agent } : null;
}

export async function upsertCall(call: {
  lead_id: string;
  twilio_sid: string;
  status: CallStatus;
  ended_at?: string;
  transcript?: unknown;
}): Promise<void> {
  unwrap(await db().from('calls').upsert(call, { onConflict: 'twilio_sid' }));
}

export async function saveQualification(leadId: string, q: Qualification): Promise<void> {
  unwrap(await db().from('leads').update({ qualification: q }).eq('id', leadId));
}

export async function saveViewing(leadId: string, v: { preferred_time: string; property: string | null }): Promise<void> {
  unwrap(await db().from('leads').update({ viewing: v }).eq('id', leadId));
}
