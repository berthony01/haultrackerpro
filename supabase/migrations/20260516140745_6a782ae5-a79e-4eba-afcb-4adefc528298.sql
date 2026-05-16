
ALTER TABLE public.recruiter_profiles DISABLE TRIGGER USER;

UPDATE public.recruiter_profiles
SET verification_status = 'approved',
    status = 'active',
    verified_at = now(),
    admin_notes = 'Seeded owner test account for Recruiter Console QA.',
    updated_at = now()
WHERE user_id = 'df860876-4c44-4f93-b31c-72ca9dbd9f3d';

ALTER TABLE public.recruiter_profiles ENABLE TRIGGER USER;
