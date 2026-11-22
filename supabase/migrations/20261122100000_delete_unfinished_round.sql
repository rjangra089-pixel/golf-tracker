-- Delete the scorecard and its round in one transaction, restricted to the owner.
create function public.delete_unfinished_round(p_round_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    status text;
begin
    if owner_id is null then
        raise exception 'Sign in to delete a round';
    end if;

    select r.round_status into status
    from public.rounds r
    where r.id = p_round_id and r.user_id = owner_id
    for update;

    if not found then
        return 'missing';
    end if;
    if status is distinct from 'in_progress' then
        return 'finished';
    end if;

    delete from public.shots where round_id = p_round_id;
    delete from public.rounds
    where id = p_round_id and user_id = owner_id and round_status = 'in_progress';
    if not found then
        raise exception 'Could not delete the unfinished round';
    end if;
    return 'deleted';
end;
$$;

revoke all on function public.delete_unfinished_round(uuid) from public, anon;
grant execute on function public.delete_unfinished_round(uuid) to authenticated;
