-- Additive V2 metadata. No task IDs, historical text or timestamps are rewritten.
CREATE TABLE public.projects (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80)
);
CREATE TABLE public.assignees (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80)
);
ALTER TABLE public.tasks
  ADD COLUMN project_id integer REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN assignee_id integer REFERENCES public.assignees(id) ON DELETE SET NULL;
ALTER TABLE public.tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo','in_progress','needs_review','done'));
CREATE INDEX tasks_project ON public.tasks(project_id) WHERE archived_at IS NULL;
CREATE INDEX tasks_assignee ON public.tasks(assignee_id) WHERE archived_at IS NULL;
-- category_id remains the primary legacy label. Only additional labels live here.
CREATE TABLE public.task_labels (
  task_id integer NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  category_id integer NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, category_id)
);
CREATE INDEX task_labels_category ON public.task_labels(category_id, task_id);
