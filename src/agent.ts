import { readFileSync } from 'node:fs';
import { RealtimeAgent, type tool } from '@openai/agents/realtime';
import { fillPrompt } from './core.js';
import type { AgentConfig, Lead } from './db.js';

const template = readFileSync(new URL('../prompts/broker-base.md', import.meta.url), 'utf8');

const fallbacks = { lead_name: 'there', property: 'a property with us' };

export function buildAgent(agent: AgentConfig, lead: Lead, tools: ReturnType<typeof tool>[] = []): RealtimeAgent {
  const instructions = fillPrompt(
    template,
    {
      ...agent.prompt_vars,
      persona_name: agent.persona_name,
      brokerage_name: agent.brokerage_name,
      agent_name: agent.agent_name,
      lead_name: lead.name,
      property: lead.property,
    },
    fallbacks,
  );
  return new RealtimeAgent({ name: agent.persona_name, instructions, tools });
}
