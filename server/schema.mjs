/** Idempotent schema. Runs on every boot. */
export const SCHEMA_SQL = `
create table if not exists matches (
  match_id        bigint primary key,
  sport_id        int not null,
  sport_tag       text,
  category_id     int,
  category_slug   text,
  category_name   text,
  tournament_id   int,
  tournament_slug text,
  tournament_name text,
  home            text not null,
  away            text not null,
  service         text not null,
  start_at        timestamptz not null,
  is_hot          boolean not null default false,
  is_real         boolean not null default true,
  live_minute     int,
  phase           text,
  status          text not null default 'scheduled',
  active          boolean not null default true,
  raw             jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists matches_service_start_idx on matches (service, start_at);
create index if not exists matches_category_idx      on matches (category_slug);
create index if not exists matches_active_idx        on matches (active);
alter table matches add column if not exists live_first_seen_at timestamptz;
alter table matches add column if not exists prematch_first_seen_at timestamptz;
alter table matches add column if not exists listing_stale boolean not null default false;
update matches set live_first_seen_at=first_seen_at where service='LIVE' and live_first_seen_at is null;
update matches set prematch_first_seen_at=first_seen_at where service='PREMATCH' and prematch_first_seen_at is null;

create table if not exists odds_current (
  match_id     bigint not null,
  market_key   text not null,
  market_name  text not null,
  line         text not null default '',
  outcome_key  text not null,
  outcome_name text not null,
  price        numeric(10,3),
  suspended    boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (match_id, market_key, line, outcome_key)
);
create index if not exists odds_current_match_idx on odds_current (match_id);

create table if not exists odds_history (
  id          bigserial primary key,
  match_id    bigint not null,
  market_key  text not null,
  line        text not null default '',
  outcome_key text not null,
  price       numeric(10,3),
  suspended   boolean not null default false,
  at          timestamptz not null default now()
);
create index if not exists odds_history_match_idx on odds_history (match_id, at desc);

create table if not exists raw_frames (
  id      bigserial primary key,
  source  text not null,
  payload jsonb,
  at      timestamptz not null default now()
);
create index if not exists raw_frames_at_idx on raw_frames (at desc);

-- added later: live score coming from the push channel (match-info)
alter table matches add column if not exists home_score    int;
alter table matches add column if not exists away_score    int;
alter table matches add column if not exists periods_score jsonb;
alter table matches add column if not exists odds_count    int;
alter table matches add column if not exists stats         jsonb;
alter table odds_current add column if not exists subgames text;

-- from match-info: the real clock, feed state and stream link
alter table matches add column if not exists match_time_ms  bigint;
alter table matches add column if not exists feed_status   text;
alter table matches add column if not exists has_open_odds boolean;
alter table matches add column if not exists broadcast_url text;

-- freshness anchors: when the feed last really reported the clock / the score.
-- match_time_ms and home_score only change on snapshot frames, so these timestamps
-- are what let the board tell "1-0 five minutes ago" apart from "1-0 right now".
alter table matches add column if not exists clock_at timestamptz;
alter table matches add column if not exists score_at timestamptz;
alter table matches add column if not exists feed_status_at timestamptz;

-- added later: full market tree (every odds group the feed sends, not just the board columns)
alter table odds_current add column if not exists is_base     boolean not null default false;
alter table odds_current add column if not exists grp_order   int     not null default 0;
alter table odds_current add column if not exists render_type text;
alter table odds_current add column if not exists period      int     not null default 0;
alter table odds_current add column if not exists board_column text;
`;
