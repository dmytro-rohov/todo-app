-- Additive domain expansion: preserve legacy ids, titles, dates and completion.
ALTER TABLE public.tasks
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN status text NOT NULL DEFAULT 'todo',
  ADD COLUMN priority text NOT NULL DEFAULT 'P2',
  ADD COLUMN due_date date,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN position bigint,
  ADD COLUMN archived_at timestamptz;
UPDATE public.tasks SET status = CASE WHEN completed THEN 'done' ELSE 'todo' END,
  completed_at = CASE WHEN completed THEN now() ELSE NULL END,
  due_date = date, position = id;
ALTER TABLE public.tasks ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo','in_progress','done')),
  ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('P0','P1','P2','P3')),
  ADD CONSTRAINT tasks_position_check CHECK (position >= 0);
CREATE INDEX tasks_board_order ON public.tasks(status, position, id) WHERE archived_at IS NULL;
-- Historical creation/completion timestamps are unknown: migration time is used.

-- Keep old writers compatible while the domain has a single source of truth.
CREATE OR REPLACE FUNCTION public.tasks_kanban_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.position := COALESCE(NEW.position, NEW.id);
    IF NEW.completed THEN NEW.status := 'done'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed := NEW.status = 'done';
  ELSIF NEW.completed IS DISTINCT FROM OLD.completed THEN
    NEW.status := CASE WHEN NEW.completed THEN 'done' ELSE 'todo' END;
  END IF;
  NEW.completed := NEW.status = 'done';
  NEW.completed_at := CASE WHEN NEW.status = 'done' THEN COALESCE(NEW.completed_at, now()) ELSE NULL END;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_kanban_defaults BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_kanban_defaults();
