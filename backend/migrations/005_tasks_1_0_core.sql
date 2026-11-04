-- Mytko Tasks 1.0 core. Additive only: no task id, title, text or timestamp is rewritten.
--
-- space:    "work" / "private". Existing rows become PRIVATE: private data is never exposed to integrations or
--           agents unless the owner moves it to "work", so the default fails closed.
-- subtasks: checklist items of a task.
-- history:  tamper-evident change log written by a trigger, so EVERY write path (API, drag-and-drop, future
--           integrations) is recorded; the application role can read it but cannot write or alter it.
ALTER TABLE public.tasks
  ADD COLUMN space varchar(10) NOT NULL DEFAULT 'private'
    CONSTRAINT tasks_space_check CHECK (space IN ('work', 'private')),
  ADD COLUMN start_date date,
  ADD COLUMN estimate_minutes integer
    CONSTRAINT tasks_estimate_check CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 1 AND 10080),
  ADD CONSTRAINT tasks_start_before_due CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);
CREATE INDEX tasks_space_status ON public.tasks(space, status) WHERE archived_at IS NULL;

CREATE TABLE public.task_subtasks (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX task_subtasks_task ON public.task_subtasks(task_id, position, id);

CREATE TABLE public.task_history (
  id bigserial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field varchar(32) NOT NULL,
  old_value text,
  new_value text,
  actor varchar(40) NOT NULL DEFAULT 'owner',
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_history_task ON public.task_history(task_id, id DESC);

-- Long text is truncated: history records THAT something changed, not a second copy of the data.
CREATE FUNCTION public.record_task_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who text := COALESCE(NULLIF(current_setting('mytko.actor', true), ''), 'owner');
  t text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_history(task_id, field, new_value, actor) VALUES (NEW.id, 'created', left(NEW.title, 200), left(who, 40));
    RETURN NEW;
  END IF;
  FOR t IN SELECT unnest(ARRAY['title','description','status','priority','category_id','project_id','assignee_id',
                               'due_date','start_date','estimate_minutes','space','archived_at']) LOOP
    IF to_jsonb(NEW) -> t IS DISTINCT FROM to_jsonb(OLD) -> t THEN
      INSERT INTO task_history(task_id, field, old_value, new_value, actor)
      VALUES (NEW.id, t, left(to_jsonb(OLD) ->> t, 200), left(to_jsonb(NEW) ->> t, 200), left(who, 40));
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_task_history() FROM PUBLIC;
CREATE TRIGGER tasks_history AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.record_task_history();
