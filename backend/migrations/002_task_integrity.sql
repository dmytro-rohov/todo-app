-- The original dump declared the same foreign key twice; keep fk_category.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_category_id_fkey;

-- The old API could insert NULL when "completed" was omitted.
UPDATE public.tasks SET completed = false WHERE completed IS NULL;
ALTER TABLE public.tasks ALTER COLUMN completed SET NOT NULL;
