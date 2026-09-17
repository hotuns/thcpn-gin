-- The multi-account demo model is intentionally not automatically reversible.
DO $$ BEGIN RAISE EXCEPTION 'migration 000034_demo_accounts cannot be rolled back automatically'; END $$;
