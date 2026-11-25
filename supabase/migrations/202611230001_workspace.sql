begin;

create table public.roadmaps (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 240),
  purpose text not null default '',
  starting_point text not null default '',
  outcome text not null default '',
  start_date date not null,
  target_date date check (target_date >= start_date),
  archived boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id)
);

create table public.phases (
  user_id uuid not null,
  id uuid not null,
  roadmap_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null default '',
  position integer not null check (position >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id),
  unique (user_id, roadmap_id, id),
  foreign key (user_id, roadmap_id) references public.roadmaps(user_id, id) on delete cascade
);

create table public.objectives (
  user_id uuid not null,
  id uuid not null,
  phase_id uuid not null,
  roadmap_id uuid not null,
  parent_id uuid,
  is_main boolean generated always as (parent_id is null) stored,
  requires_main_parent boolean generated always as (case when parent_id is not null then true end) stored,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null default '',
  position integer not null check (position >= 0),
  completed boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id),
  unique (user_id, phase_id, id, is_main),
  unique (user_id, roadmap_id, id),
  foreign key (user_id, roadmap_id, phase_id) references public.phases(user_id, roadmap_id, id) on delete cascade,
  foreign key (user_id, phase_id, parent_id, requires_main_parent)
    references public.objectives(user_id, phase_id, id, is_main) on delete cascade,
  check (id <> parent_id)
);

create table public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  roadmap_id uuid,
  objective_id uuid,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null default '',
  due_date date,
  planned_date date,
  priority text not null default 'none' check (priority in ('none','low','medium','high')),
  status text not null default 'active' check (status in ('active','completed','archived')),
  completed_at timestamptz,
  inbox boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id),
  foreign key (user_id, roadmap_id) references public.roadmaps(user_id, id) on delete cascade,
  foreign key (user_id, roadmap_id, objective_id) references public.objectives(user_id, roadmap_id, id) on delete set null (objective_id),
  check (objective_id is null or roadmap_id is not null),
  check (not inbox or roadmap_id is null),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'active' or completed_at is null)
);

create table public.checklist_items (
  user_id uuid not null,
  id uuid not null,
  task_id uuid,
  objective_id uuid,
  title text not null check (length(btrim(title)) between 1 and 240),
  completed boolean not null default false,
  position integer not null check (position >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id),
  foreign key (user_id, task_id) references public.tasks(user_id, id) on delete cascade,
  foreign key (user_id, objective_id) references public.objectives(user_id, id) on delete cascade,
  check (num_nonnulls(task_id, objective_id) = 1)
);

create table public.milestones (
  user_id uuid not null,
  id uuid not null,
  roadmap_id uuid not null,
  phase_id uuid,
  title text not null check (length(btrim(title)) between 1 and 240),
  target_date date,
  completed_at timestamptz,
  position integer not null check (position >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id),
  foreign key (user_id, roadmap_id) references public.roadmaps(user_id, id) on delete cascade,
  foreign key (user_id, roadmap_id, phase_id) references public.phases(user_id, roadmap_id, id) on delete set null (phase_id)
);

create table public.settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null check (id = user_id),
  theme text not null check (theme in ('light','dark','system')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision uuid not null,
  primary key (user_id, id)
);

create table public.workspace_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0
);

create table public.workspace_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  committed_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);

create index phases_roadmap_idx on public.phases(user_id, roadmap_id, position);
create index objectives_phase_idx on public.objectives(user_id, phase_id, position);
create index objectives_parent_idx on public.objectives(user_id, phase_id, parent_id);
create index tasks_association_idx on public.tasks(user_id, roadmap_id, objective_id);
create index tasks_due_idx on public.tasks(user_id, due_date) where status = 'active';
create index tasks_planned_idx on public.tasks(user_id, planned_date) where status = 'active';
create index milestones_phase_idx on public.milestones(user_id, roadmap_id, phase_id);
create index checklist_task_idx on public.checklist_items(user_id, task_id);
create index checklist_objective_idx on public.checklist_items(user_id, objective_id);

do $$
declare relation text;
begin
  foreach relation in array array[
    'roadmaps', 'phases', 'objectives', 'tasks', 'checklist_items', 'milestones', 'settings',
    'workspace_revisions', 'workspace_receipts'
  ]
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on table public.%I from public, anon, authenticated', relation);
    if relation <> 'workspace_receipts' then
      execute format('grant select on table public.%I to authenticated', relation);
      execute format(
        'create policy own_rows on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
        relation
      );
    end if;
  end loop;
end $$;

create function public.mark_disassociated_record() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.revision = old.revision then
    new.revision := coalesce(nullif(current_setting('whereami.batch', true), '')::uuid, gen_random_uuid());
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.mark_disassociated_record() from public, anon, authenticated;

create trigger task_association_changed before update of objective_id on public.tasks
for each row when (new.objective_id is distinct from old.objective_id)
execute function public.mark_disassociated_record();

create trigger milestone_association_changed before update of phase_id on public.milestones
for each row when (new.phase_id is distinct from old.phase_id)
execute function public.mark_disassociated_record();

create function public.get_workspace() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'owner_id', owner.id,
    'version', coalesce((select r.version from public.workspace_revisions r where r.user_id = owner.id), 0),
    'roadmaps', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id') from public.roadmaps r where r.user_id = owner.id), '[]'),
    'phases', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id') from public.phases p where p.user_id = owner.id), '[]'),
    'objectives', coalesce((
      select jsonb_agg(to_jsonb(o) - array['user_id','roadmap_id','is_main','requires_main_parent'])
      from public.objectives o where o.user_id = owner.id
    ), '[]'),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id') from public.tasks t where t.user_id = owner.id), '[]'),
    'checklist_items', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id') from public.checklist_items c where c.user_id = owner.id), '[]'),
    'milestones', coalesce((select jsonb_agg(to_jsonb(m) - 'user_id') from public.milestones m where m.user_id = owner.id), '[]'),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id') from public.settings s where s.user_id = owner.id), '[]')
  ) from (select auth.uid() as id) owner;
$$;

create function public.commit_workspace(p_expected_owner uuid, p_batch_id uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  change jsonb;
  payload jsonb;
  relation text;
  entity_id uuid;
  actual_revision uuid;
  expected_revision uuid;
  roadmap_for_objective uuid;
  fields text[];
  editable_fields text[];
  field_names text;
  assignments text;
begin
  if owner_id is null or owner_id is distinct from p_expected_owner then
    raise exception using errcode = '42501', message = 'Sign in before writing workspace data.';
  end if;
  if p_batch_id is null or jsonb_typeof(p_changes) is distinct from 'array'
      or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Provide between 1 and 500 changes.';
  end if;

  -- Serialize checks and edits for one account. A repeated batch is a read after its first commit.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if exists (
    select 1 from public.workspace_receipts where user_id = owner_id and batch_id = p_batch_id
  ) then
    return public.get_workspace();
  end if;

  perform set_config('whereami.batch', p_batch_id::text, true);
  for change in select value from jsonb_array_elements(p_changes)
  loop
    relation := change->>'table';
    fields := case relation
      when 'roadmaps' then array['title','purpose','starting_point','outcome','start_date','target_date','archived']
      when 'phases' then array['roadmap_id','title','description','position']
      when 'objectives' then array['phase_id','roadmap_id','parent_id','title','description','position','completed']
      when 'tasks' then array['roadmap_id','objective_id','title','description','due_date','planned_date','priority','status','completed_at','inbox']
      when 'checklist_items' then array['task_id','objective_id','title','completed','position']
      when 'milestones' then array['roadmap_id','phase_id','title','target_date','completed_at','position']
      when 'settings' then array['theme']
    end;
    if fields is null then
      raise exception using errcode = '22023', message = 'Unsupported workspace record.';
    end if;

    entity_id := (change->>'id')::uuid;
    expected_revision := (change->>'expected_revision')::uuid;
    if entity_id is null then
      raise exception using errcode = '22023', message = 'Provide a record ID.';
    end if;

    execute format('select revision from public.%I where user_id = $1 and id = $2', relation)
      into actual_revision using owner_id, entity_id;

    if change->>'op' = 'delete' and actual_revision is null then
      continue;
    end if;
    if actual_revision is distinct from expected_revision then
      raise exception using errcode = '40001', message = 'This record changed on another device.';
    end if;

    if change->>'op' = 'delete' then
      execute format('delete from public.%I where user_id = $1 and id = $2', relation) using owner_id, entity_id;
    elsif change->>'op' = 'put' and jsonb_typeof(change->'record') = 'object' then
      payload := (change->'record') || jsonb_build_object('user_id', owner_id, 'id', entity_id, 'revision', p_batch_id);
      if relation = 'objectives' then
        select roadmap_id into roadmap_for_objective from public.phases
          where user_id = owner_id and id = (payload->>'phase_id')::uuid;
        payload := payload || jsonb_build_object('roadmap_id', roadmap_for_objective);
      end if;

      editable_fields := fields || array['updated_at', 'revision'];
      fields := editable_fields || array['user_id', 'id', 'created_at'];
      select string_agg(format('%I', field), ', ') into field_names from unnest(fields) as field;
      select string_agg(format('%1$I = excluded.%1$I', field), ', ') into assignments
        from unnest(editable_fields) as field;

      execute format(
        'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
         on conflict (user_id, id) do update set %3$s',
        relation, field_names, assignments
      ) using payload;
    else
      raise exception using errcode = '22023', message = 'Invalid workspace change.';
    end if;
  end loop;

  insert into public.workspace_receipts (user_id, batch_id) values (owner_id, p_batch_id);
  insert into public.workspace_revisions as r (user_id, version) values (owner_id, 1)
    on conflict (user_id) do update set version = r.version + 1;

  return public.get_workspace();
end;
$$;

revoke execute on function public.get_workspace() from public, anon, authenticated;
revoke execute on function public.commit_workspace(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_workspace() to authenticated;
grant execute on function public.commit_workspace(uuid, uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.workspace_revisions;
  end if;
end $$;

commit;


