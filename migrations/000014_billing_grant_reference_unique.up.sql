CREATE UNIQUE INDEX workspace_plan_grants_reference_unique
    ON public.workspace_plan_grants(workspace_id, source_type, reference_no)
    WHERE reference_no IS NOT NULL AND source_type IN ('device_order', 'service_contract');
