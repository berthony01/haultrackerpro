DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.loads'::regclass
      AND conname = 'loads_total_miles_component_consistency_check'
  ) THEN
    ALTER TABLE public.loads
      ADD CONSTRAINT loads_total_miles_component_consistency_check
      CHECK (
        total_miles IS NULL
        OR (
          total_miles >= 0
          AND (
            (loaded_miles + deadhead_miles) = 0
            OR abs(total_miles - (loaded_miles + deadhead_miles)) <= 2
          )
        )
      );
  END IF;
END
$$;