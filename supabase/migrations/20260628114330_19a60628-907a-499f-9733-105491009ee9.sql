
DO $$
DECLARE _fn text;
BEGIN
  FOREACH _fn IN ARRAY ARRAY[
    'is_agency_owner_or_admin(uuid,uuid)',
    'clean_assistant_permissions(jsonb)',
    'create_agency_package(uuid,text,text,text,text,jsonb,jsonb,integer)',
    'update_agency_package(uuid,text,text,text,text,jsonb,jsonb,boolean,integer)',
    'list_agency_packages_public(uuid)',
    'get_agency_public_view(uuid)',
    'submit_agency_client_request(uuid,uuid,text,text,text,boolean)',
    'list_agency_client_requests(uuid)',
    'list_my_agency_client_requests()',
    'set_agency_client_request_status(uuid,public.agency_client_request_status,uuid)',
    'create_agency_delegation_request(uuid,uuid,jsonb)',
    'list_my_pending_delegations()',
    'list_agency_delegations(uuid)',
    'driver_decide_delegation(uuid,boolean)',
    'list_agency_clients(uuid)',
    'create_agency_work_item(uuid,uuid,text,text,public.agency_work_item_type,public.agency_work_item_priority,uuid,uuid,date)',
    'update_agency_work_item(uuid,public.agency_work_item_status,uuid,text,text,public.agency_work_item_priority,date)',
    'list_agency_work_items(uuid,public.agency_work_item_status,uuid,uuid)',
    'list_agency_audit_log(uuid,integer)',
    'list_my_driver_agency_audit_log(integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, public', _fn);
  END LOOP;
END $$;
