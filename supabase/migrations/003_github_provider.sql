insert into public.providers (key, name)
values ('github', 'GitHub Actions')
on conflict (key) do update set name = excluded.name;
