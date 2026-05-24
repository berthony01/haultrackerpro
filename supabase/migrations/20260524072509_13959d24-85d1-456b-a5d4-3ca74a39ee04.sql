
-- Fix 1: Attach trigger preventing drivers from self-promoting via profiles billing fields.
DROP TRIGGER IF EXISTS prevent_profile_billing_field_updates_trg ON public.profiles;
CREATE TRIGGER prevent_profile_billing_field_updates_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_billing_field_updates();

-- Fix 2: Explicit UPDATE/DELETE storage policies for contract-documents,
-- scoped to the owning (non-suspended) recruiter; admins remain covered by ALL policy.
DROP POLICY IF EXISTS "Contract objects: recruiter updates own" ON storage.objects;
CREATE POLICY "Contract objects: recruiter updates own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'contract-documents'
  AND (storage.foldername(name))[1] = 'contracts'
  AND EXISTS (
    SELECT 1 FROM public.opportunity_applications oa
    JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.id = ((storage.foldername(objects.name))[2])::uuid
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
)
WITH CHECK (
  bucket_id = 'contract-documents'
  AND (storage.foldername(name))[1] = 'contracts'
  AND EXISTS (
    SELECT 1 FROM public.opportunity_applications oa
    JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.id = ((storage.foldername(objects.name))[2])::uuid
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);

DROP POLICY IF EXISTS "Contract objects: recruiter deletes own" ON storage.objects;
CREATE POLICY "Contract objects: recruiter deletes own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'contract-documents'
  AND (storage.foldername(name))[1] = 'contracts'
  AND EXISTS (
    SELECT 1 FROM public.opportunity_applications oa
    JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.id = ((storage.foldername(objects.name))[2])::uuid
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);
