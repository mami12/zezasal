import {MANAGER_CASINO_SQL} from '../casino/manager-settings.mjs';
import {ORIGINAL_WALLET_SQL} from '../casino/original-wallet-schema.mjs';
import {SETTLEMENT_REVIEW_SQL} from './settlement-review.mjs';
import {MATCH_EVENT_FACT_SQL} from './match-event-facts.mjs';
import {ZIZOBET_MATCH_HISTORY_SQL} from './zizobet-match-history.mjs';
import {HALFTIME_RESULT_SQL} from './halftime-results.mjs';
import {PROVIDER_OFFER_ARCHIVE_SQL} from './provider-offer-archive.mjs';
import {LIVE_OBSERVATION_SQL} from './live-observation-store.mjs';
import {FOOTBALL_INFORMATION_SQL} from '../stats-providers/football-information.mjs';
/**
 * Ledger schema - users, money, tickets.
 *
 * The live board (matches + odds) stays in memory and never touches these tables, so a
 * database outage still leaves the board serving. This is only what must survive a
 * restart for the betting part: who the users are, how their money moved, and the
 * tickets they placed (with the price frozen at placement time).
 *
 * Every statement is idempotent and CREATE-only: nothing that already exists is altered.
 * Tables are prefixed `app_` so they cannot collide with the board's own tables.
 */
export const LEDGER_SQL = `
create table if not exists app_user (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  role          text not null default 'PLAYER',   -- ADMIN | MANAGER | PLAYER
  status        text not null default 'ACTIVE',   -- ACTIVE | FROZEN | BANNED
  balance       numeric(14,2) not null default 0,
  currency      text not null default 'LEK',
  manager_id    uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists app_user_role_idx    on app_user (role);
create index if not exists app_user_manager_idx on app_user (manager_id);
alter table app_user add column if not exists deleted_at timestamptz;
alter table app_user add column if not exists deleted_by uuid references app_user(id) on delete set null;
create index if not exists app_user_deleted_idx on app_user(deleted_at,id) where deleted_at is not null;
alter table app_user add column if not exists agent_id uuid references app_user(id) on delete set null;
create index if not exists app_user_agent_idx on app_user(agent_id);
alter table app_user add column if not exists financial_epoch bigint not null default 0;
create table if not exists app_financial_reset (
 request_id uuid primary key,
 actor_id uuid not null references app_user(id) on delete restrict,
 response jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists app_staff_transfer (
 actor_id uuid not null references app_user(id) on delete restrict,
 request_id uuid not null,
 payload text not null,
 response jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
-- Latest observed provider facts survive a restart; only confirmed FT facts settle bets.
create table if not exists app_match_snapshot (
 match_id bigint primary key,
 snapshot jsonb not null,
 observed_at timestamptz not null default now()
);

create table if not exists app_commission_config (
  id         smallint primary key check (id = 1),
  single_pct numeric(5,2) not null default 3 check (single_pct >= 0 and single_pct <= 100),
  double_pct numeric(5,2) not null default 5 check (double_pct >= 0 and double_pct <= 100),
  multi_pct  numeric(5,2) not null default 7 check (multi_pct >= 0 and multi_pct <= 100),
  updated_by uuid references app_user(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into app_commission_config (id) values (1) on conflict (id) do nothing;
alter table app_commission_config add column if not exists casino_pct numeric(5,2) not null default 0 check (casino_pct >= 0 and casino_pct <= 100);

create table if not exists app_player_controls (
  user_id                uuid primary key references app_user(id) on delete cascade,
  daily_limit            numeric(14,2),
  weekly_limit           numeric(14,2),
  monthly_limit          numeric(14,2),
  pending_limits         jsonb,
  limits_effective_at    timestamptz,
  self_excluded_until    timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists app_player_controls_exclusion_idx on app_player_controls (self_excluded_until);

-- The single locked row also serializes liability calculations across players.
create table if not exists app_live_risk_settings (
  id smallint primary key check (id = 1),
  settings jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_user(id) on delete set null
);

create table if not exists app_admin_audit (
  id            bigserial primary key,
  actor_id      uuid references app_user(id) on delete set null,
  actor_name    text not null,
  actor_role    text not null,
  action        text not null,
  target_type   text not null,
  target_id     text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create table if not exists app_board_settings (
 id smallint primary key check(id=1),settings jsonb not null default '{"prematchLimit":0}'::jsonb,
 updated_by uuid references app_user(id) on delete set null,updated_at timestamptz not null default now()
);
insert into app_board_settings(id) values(1) on conflict(id) do nothing;
create index if not exists app_admin_audit_created_idx on app_admin_audit (created_at desc);
create index if not exists app_admin_audit_actor_idx on app_admin_audit (actor_id, created_at desc);

-- every balance movement is recorded with the balance it produced (auditable wallet)
create table if not exists app_transaction (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_user(id) on delete cascade,
  amount        numeric(14,2) not null,
  type          text not null,                    -- DEPOSIT | WITHDRAWAL | BET_PLACED | BET_WON | BET_REFUND | TICKET_REVERT
  reference_id  uuid,
  balance_after numeric(14,2) not null,
  description   text,
  created_at    timestamptz not null default now()
);
create index if not exists app_transaction_user_idx on app_transaction (user_id, created_at desc);
create index if not exists app_transaction_ref_type_idx on app_transaction (reference_id, type);

create table if not exists app_ticket (
  id               uuid primary key default gen_random_uuid(),
  booking_code     text unique,
  user_id          uuid references app_user(id) on delete set null,
  stake            numeric(14,2) not null,
  total_odds       numeric(14,4) not null,
  potential_payout numeric(14,2) not null,
  ticket_type      text not null default 'SINGLE', -- SINGLE | COMBO | SYSTEM
  system_type      text,
  status           text not null default 'PENDING',-- PENDING | WON | LOST | CANCELLED | VOID | REVERTED
  placed_at        timestamptz not null default now(),
  settled_at       timestamptz
);
-- Preserve the accepted quote independently from the historical settled payout.
create table if not exists app_market_scope_policy(id serial primary key,country text not null default '',league text not null default '',categories text[] not null default '{}',families text[] not null default '{}',updated_at timestamptz not null default now());
alter table app_ticket add column if not exists original_potential_payout numeric(14,2);
alter table app_ticket add column if not exists potential_quote_reconstructed boolean not null default false;
update app_ticket set original_potential_payout=case when status in ('PENDING','WON') then potential_payout
 else round(stake*total_odds,2) end,
 potential_quote_reconstructed=(status not in ('PENDING','WON'))
 where original_potential_payout is null;
create or replace function app_preserve_ticket_quote() returns trigger language plpgsql as $quote$ begin
 if TG_OP='INSERT' then NEW.original_potential_payout=NEW.potential_payout;NEW.potential_quote_reconstructed=false;
 else NEW.original_potential_payout=OLD.original_potential_payout;NEW.potential_quote_reconstructed=OLD.potential_quote_reconstructed;end if;
 return NEW;
end $quote$;
drop trigger if exists app_ticket_quote on app_ticket;
create trigger app_ticket_quote before insert or update on app_ticket for each row execute function app_preserve_ticket_quote();
-- A request from the browser may be retried or delivered twice. Enforce exactly
-- one real ticket per player + request key at the database boundary.
alter table app_ticket add column if not exists client_request_id uuid;
alter table app_ticket add column if not exists request_payload_hash text;
create unique index if not exists app_ticket_user_request_uidx
  on app_ticket (user_id, client_request_id)
  where client_request_id is not null;

create index if not exists app_ticket_user_idx   on app_ticket (user_id, placed_at desc);
create index if not exists app_ticket_status_idx on app_ticket (status);
create index if not exists app_ticket_compact_id_idx on app_ticket ((replace(id::text,'-','')) text_pattern_ops);

-- Rejected placement attempts are not tickets: no balance movement occurs.
-- Saved separately so "Refuzuarat" shows real server refusals, not fabricated
-- LOST/CANCELLED tickets. The optional idempotency ID prevents duplicate logs.
create table if not exists app_bet_rejection (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references app_user(id) on delete cascade,
  client_request_id uuid,
  stake             numeric(14,2),
  selection_count   int not null default 0,
  reason            text not null,
  created_at        timestamptz not null default now()
);
create index if not exists app_bet_rejection_user_date_idx
  on app_bet_rejection (user_id, created_at desc);
create unique index if not exists app_bet_rejection_idempotency_idx
  on app_bet_rejection (user_id, client_request_id)
  where client_request_id is not null;

-- Atomic, idempotent multi-column bets: all tickets and the wallet debit commit together.
create table if not exists app_ticket_batch (
  user_id uuid not null references app_user(id) on delete cascade,
  client_request_id uuid not null,
  request_payload_hash text not null,
  ticket_ids uuid[] not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_request_id)
);
-- One globally unique public ticket identity, including historical column batches.
alter table app_ticket_batch add column if not exists id uuid not null default gen_random_uuid();
alter table app_ticket_batch add column if not exists selection_order text[];
create unique index if not exists app_ticket_batch_id_uidx on app_ticket_batch(id);
create index if not exists app_ticket_batch_members_idx on app_ticket_batch using gin(ticket_ids);
create index if not exists app_ticket_batch_compact_id_idx on app_ticket_batch ((replace(id::text,'-','')) text_pattern_ops);

-- Universal admin-defined same-game builders. Each leg is a supported outcome contract.
create table if not exists app_bet_builder_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legs jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- names and odds are snapshotted here, so settlement never depends on the live feed
create table if not exists app_ticket_line (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references app_ticket(id) on delete cascade,
  match_id         bigint not null,
  market_key       text not null,
  line             text not null default '',
  outcome_key      text not null,
  outcome_name     text not null,
  market_name      text not null,
  match_name       text not null,
  odds_at_placement numeric(14,4) not null,
  status           text not null default 'PENDING' -- PENDING | WON | LOST | VOID
);
alter table app_ticket_line add column if not exists builder_legs jsonb;
-- Frozen goal/corner/window/count contract accepted with the exact ticket quote.
alter table app_ticket_line add column if not exists live_contract jsonb;
-- Always retain the original provider offer and the exact accepted structured terms.
alter table app_ticket_line add column if not exists accepted_contract jsonb;
-- Informational only: a missing evidence reason never authorizes a payout.
alter table app_ticket_line add column if not exists settlement_reason text;
create index if not exists app_ticket_line_ticket_idx on app_ticket_line (ticket_id);
create index if not exists app_ticket_line_match_idx  on app_ticket_line (match_id);

-- final results, persisted the moment a match is seen finished: settlement must work even
-- if the process restarts or the match later leaves the feed
${HALFTIME_RESULT_SQL}
create table if not exists app_match_result (
  match_id     bigint primary key,
  home_team    text,
  away_team    text,
  home_score   int not null,
  away_score   int not null,
  corners_home int,
  corners_away int,
  cards_home   int,
  cards_away   int,
  finished_at  timestamptz not null default now(),
  settled_at   timestamptz
);
alter table app_match_result add column if not exists statistics jsonb not null default '{}';

alter table app_match_result add column if not exists half_home_score int;
alter table app_match_result add column if not exists half_away_score int;
-- FEED snapshots can refresh ungraded results; verified manual corrections
-- must never be replaced by a subsequent stale provider replay.
alter table app_match_result add column if not exists source text not null default 'FEED';

-- admin overrides survive the next feed frame (suspend a match/market/outcome, pin a price)
create table if not exists app_feed_override (
  kind        text not null,      -- match | market | outcome
  ref         text not null,      -- matchId | matchId|market|line | matchId|market|line|outcome
  suspended   boolean,
  price       numeric(14,4),
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (kind, ref)
);


alter table app_feed_override add column if not exists hidden boolean not null default false;

create table if not exists app_casino_round (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references app_user(id) on delete restrict,
 client_request_id uuid not null,
 game_id text not null,
 game_version text not null,
 bet numeric(14,2) not null check (bet > 0),
 denomination numeric(18,6) not null check (denomination > 0),
 lines int not null check (lines > 0),
 stake numeric(14,2) not null check (stake > 0),
 payout numeric(14,2) not null check (payout >= 0),
 balance_after numeric(14,2) not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 unique(user_id,client_request_id)
);
create index if not exists app_casino_round_user_date_idx on app_casino_round(user_id,created_at desc);
-- Frozen report for manual settlement: commissions never move wallet funds.
create table if not exists app_manager_commission (
 id uuid primary key default gen_random_uuid(),
 manager_id uuid not null references app_user(id) on delete cascade,
 player_id uuid not null references app_user(id) on delete cascade,
 kind text not null check(kind in ('SPORT','CASINO')),
 ticket_id uuid unique references app_ticket(id) on delete cascade,
 round_id uuid unique references app_casino_round(id) on delete cascade,
 stake numeric(14,2) not null check(stake >= 0),
 selection_count integer,
 rate_pct numeric(5,2) not null check(rate_pct >= 0 and rate_pct <= 100),
 amount numeric(14,2) not null check(amount >= 0),
 created_at timestamptz not null default now(),
 check ((kind='SPORT' and ticket_id is not null and round_id is null) or
        (kind='CASINO' and round_id is not null and ticket_id is null))
);
create index if not exists app_manager_commission_owner_idx on app_manager_commission(manager_id,kind,created_at);
create index if not exists app_manager_commission_player_idx on app_manager_commission(player_id,kind);
${MANAGER_CASINO_SQL}
create or replace function app_record_casino_commission() returns trigger language plpgsql as $$
declare owner_id uuid; agent_owner_id uuid; pct numeric(5,2);
begin
 select manager_id into owner_id from app_user where id=NEW.user_id;
 if owner_id is not null then
   select agent_id into agent_owner_id from app_user where id=owner_id;
   select coalesce(a.commission_pct,m.commission_pct,c.casino_pct) into pct from app_commission_config c left join app_manager_casino_settings m on m.manager_id=owner_id left join app_manager_casino_settings a on a.manager_id=agent_owner_id where c.id=1;
   insert into app_manager_commission(manager_id,player_id,kind,round_id,stake,rate_pct,amount)
   values(owner_id,NEW.user_id,'CASINO',NEW.id,NEW.stake,coalesce(pct,0),round(NEW.stake*coalesce(pct,0)/100,2))
   on conflict(round_id) do nothing;
 end if;
 return NEW;
end $$;
drop trigger if exists app_casino_commission_report on app_casino_round;
create trigger app_casino_commission_report after insert on app_casino_round
 for each row execute function app_record_casino_commission();
-- Credit units can be sub-cent while every wallet debit remains whole cents.
-- Avoid repeating a table type change and its lock on subsequent startups.
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema=current_schema()
   and table_name='app_casino_round' and column_name='denomination' and numeric_scale<6) then
  alter table app_casino_round alter column denomination type numeric(18,6);
 end if;
end $$;
-- The original cabinet can gamble an already credited spin win. Persist the
-- current pending win and card so restarts and concurrent requests remain safe.
create table if not exists app_casino_gamble_state (
 user_id uuid primary key references app_user(id) on delete cascade,
 round_id uuid not null references app_casino_round(id) on delete cascade,
 pending numeric(14,2) not null default 0 check (pending >= 0),
 step integer not null default 0 check (step >= 0 and step <= 5),
 player_card jsonb,
 updated_at timestamptz not null default now()
);
-- Retries of gamble/collect must return the original result without affecting
-- the sportsbook wallet a second time.
create table if not exists app_casino_gamble_event (
 user_id uuid not null references app_user(id) on delete cascade,
 request_id uuid not null,
 action text not null,
 response jsonb not null,
 created_at timestamptz not null default now(),
 primary key (user_id,request_id)
);
create index if not exists app_casino_gamble_event_date_idx
 on app_casino_gamble_event (created_at desc);
create table if not exists app_casino_settings (
 id smallint primary key check (id=1),
 enabled boolean not null default true,
 profile text not null default 'SIZZLING_STANDARD_V1',
 updated_by uuid references app_user(id) on delete set null,
 updated_at timestamptz not null default now(),
 wallet_rollout_applied boolean not null default false
);
alter table app_casino_settings add column if not exists wallet_rollout_applied boolean not null default false;
alter table app_casino_settings add column if not exists game_profiles jsonb not null default '{}';
alter table app_casino_settings add column if not exists game_controls jsonb not null default '{}';
alter table app_casino_settings add column if not exists hidden_games jsonb not null default '[]';
create table if not exists app_casino_freespin_state (
  user_id uuid primary key references app_user(id) on delete cascade,
  round_id uuid not null references app_casino_round(id) on delete cascade,
  left_spins integer not null,
  done_spins integer not null default 0,
  mud integer not null,
  bet numeric(14,2) not null,
  lines integer not null,
  updated_at timestamptz not null default now()
);
alter table app_casino_freespin_state add column if not exists math_profile text;
alter table app_casino_freespin_state add column if not exists custom_round jsonb;

${ORIGINAL_WALLET_SQL}
${SETTLEMENT_REVIEW_SQL}
create table if not exists app_manual_review_notice (
  line_id uuid primary key references app_ticket_line(id) on delete cascade,
  first_seen_at timestamptz not null
);
${LIVE_OBSERVATION_SQL}
${FOOTBALL_INFORMATION_SQL}
${MATCH_EVENT_FACT_SQL}
${ZIZOBET_MATCH_HISTORY_SQL}
${PROVIDER_OFFER_ARCHIVE_SQL}
insert into app_casino_settings(id) values (1) on conflict(id) do nothing;
-- Migrate the old disabled-by-default casino exactly once. Afterwards the
-- administrator's OFF switch is persistent even across future restarts.
update app_casino_settings
   set enabled = true, wallet_rollout_applied = true, updated_at = now()
 where id = 1 and wallet_rollout_applied = false;
`;
