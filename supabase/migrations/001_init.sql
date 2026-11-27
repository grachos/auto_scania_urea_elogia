create table if not exists vehicles (
  vin text primary key,
  plate text,
  name text,
  updated_at timestamptz not null default now()
);

create table if not exists urea_readings (
  id bigint generated always as identity primary key,
  vin text not null references vehicles(vin) on delete cascade,
  urea_level numeric,
  fuel_level numeric,
  received_at timestamptz not null,
  lat double precision,
  lon double precision,
  odometer_m bigint,
  created_at timestamptz not null default now(),
  unique (vin, received_at)
);
create index if not exists urea_readings_vin_received_idx on urea_readings (vin, received_at desc);

create table if not exists recipients (
  id bigint generated always as identity primary key,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error')),
  detail text
);
create index if not exists job_runs_status_started_idx on job_runs (status, started_at desc);

-- RLS on, no policies: only the service role key (bypasses RLS) can access.
alter table vehicles enable row level security;
alter table urea_readings enable row level security;
alter table recipients enable row level security;
alter table job_runs enable row level security;
