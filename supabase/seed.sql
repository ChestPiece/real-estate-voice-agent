with c as (
  insert into clients (slug, name) values ('demo', 'Marina Bay Realty') returning id
)
insert into agents (client_id, persona_name, brokerage_name, agent_name, prompt_vars)
select id, 'Sara', 'Marina Bay Realty', 'Omar',
  '{"areas":"Dubai Marina, JBR, Business Bay","specialty":"apartments for sale and rent"}'::jsonb
from c;
