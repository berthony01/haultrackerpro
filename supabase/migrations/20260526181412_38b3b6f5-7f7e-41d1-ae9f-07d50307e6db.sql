CREATE POLICY "Driver deletes own application"
ON public.opportunity_applications
FOR DELETE
TO authenticated
USING (auth.uid() = driver_user_id);