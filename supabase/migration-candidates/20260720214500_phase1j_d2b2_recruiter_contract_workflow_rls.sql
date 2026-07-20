-- Phase 1J-D2B-2: recruiter contract-workflow RLS enforcement.
--
-- Growth is the minimum paid recruiter tier for recruiter-side contract creation,
-- contract mutation, version upload, and recruiter-authored contract reviews.
-- Existing SELECT policies remain unchanged so downgrade preserves read access.
-- Driver, admin, and service-role behavior remains unchanged.

ALTER POLICY "Recruiter inserts contracts on own applications"
  ON public.contracts
  WITH CHECK (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND auth.uid() = recruiter_user_id
    AND public.current_user_has_recruiter_minimum_paid_plan('growth')
    AND EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      WHERE oa.id = application_id
        AND oa.recruiter_id = contracts.recruiter_id
        AND oa.opportunity_id = contracts.opportunity_id
        AND oa.driver_user_id = contracts.driver_user_id
    )
  );

ALTER POLICY "Recruiter updates own contracts"
  ON public.contracts
  USING (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND public.current_user_has_recruiter_minimum_paid_plan('growth')
  )
  WITH CHECK (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND public.current_user_has_recruiter_minimum_paid_plan('growth')
  );

ALTER POLICY "Recruiter inserts versions on own contracts"
  ON public.contract_versions
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.current_user_has_recruiter_minimum_paid_plan('growth')
    AND EXISTS (
      SELECT 1
      FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

ALTER POLICY "Recruiter inserts own review"
  ON public.contract_reviews
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'recruiter'
    AND public.current_user_has_recruiter_minimum_paid_plan('growth')
    AND EXISTS (
      SELECT 1
      FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );
