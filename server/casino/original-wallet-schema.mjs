export const ORIGINAL_WALLET_SQL=`
create table if not exists app_casino_original_state (
 user_id uuid not null references app_user(id) on delete cascade,
 game_id text not null,session_id uuid not null,state jsonb not null,
 updated_at timestamptz not null default now(),primary key(user_id,game_id)
);
create table if not exists app_casino_original_event (
 user_id uuid not null references app_user(id) on delete cascade,
 session_id uuid not null,request_id text not null,fingerprint text not null,
 response jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,session_id,request_id)
);`;
