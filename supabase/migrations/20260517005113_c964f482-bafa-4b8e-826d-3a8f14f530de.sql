CREATE OR REPLACE FUNCTION public.notify_contract_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.create_notification(
      NEW.driver_user_id,
      'contract_uploaded',
      'Contract needs review',
      'A recruiter uploaded a contract for your application.',
      jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'uploaded' AND OLD.status <> 'uploaded' THEN
      PERFORM public.create_notification(
        NEW.driver_user_id, 'contract_uploaded',
        'Updated contract needs review',
        'A recruiter uploaded a new version of the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'approved' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_approved',
        'Contract approved',
        'The driver approved the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
      PERFORM public.create_notification(
        NEW.driver_user_id, 'contract_approved',
        'Contract approval recorded',
        'Your contract approval was recorded.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_rejected',
        'Contract rejected',
        'The driver rejected the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_changes_requested',
        'Contract changes requested',
        'The driver requested changes to the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'signed' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_signed',
        'Contract signed',
        'The driver signed the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
      PERFORM public.create_notification(
        NEW.driver_user_id, 'contract_signed',
        'Signature recorded',
        'Your in-app contract signature was recorded.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_contract_change() FROM PUBLIC, anon, authenticated;