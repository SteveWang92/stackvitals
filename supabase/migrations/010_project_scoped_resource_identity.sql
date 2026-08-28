alter table public.resources
  drop constraint resources_provider_id_resource_type_external_id_key;

alter table public.resources
  add constraint resources_project_provider_type_external_id_key
  unique nulls not distinct (project_id, provider_id, resource_type, external_id);
