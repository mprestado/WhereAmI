begin;

alter table public.roadmaps
  add column presentation text not null default 'journey' check (presentation in ('journey', 'list'));

alter table public.objectives
  add column optional boolean not null default false,
  add column goal_position integer check (goal_position >= 0);

alter table public.tasks
  add column optional boolean not null default false,
  add column position integer check (position >= 0);

alter table public.checklist_items
  add column optional boolean not null default false;

-- A versioned write RPC lets a current client detect an unupgraded server
-- before a batch can be accepted without the new fields.
create function public.commit_workspace_v2(p_expected_owner uuid, p_batch_id uuid, p_changes jsonb) returns jsonb
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

      -- Omitted extension fields use the SQL defaults on insert and keep their
      -- existing values on update, including writes queued by earlier clients.
      if relation = 'roadmaps' and payload ? 'presentation' then
        fields := array_append(fields, 'presentation');
      end if;
      if relation in ('objectives', 'tasks', 'checklist_items') and payload ? 'optional' then
        fields := array_append(fields, 'optional');
      end if;
      if relation = 'tasks' and payload ? 'position' then
        fields := array_append(fields, 'position');
      end if;
      if relation = 'objectives' and payload ? 'goal_position' then
        fields := array_append(fields, 'goal_position');
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

revoke execute on function public.commit_workspace_v2(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_workspace_v2(uuid, uuid, jsonb) to authenticated;

create or replace function public.commit_workspace(p_expected_owner uuid, p_batch_id uuid, p_changes jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$
  select public.commit_workspace_v2(p_expected_owner, p_batch_id, p_changes);
$$;

commit;
