-- Baseline matching the original database.sql dump. IF NOT EXISTS lets an
-- existing development database created from that dump adopt the ledger.

CREATE TABLE IF NOT EXISTS public.categories (
    id serial PRIMARY KEY,
    name varchar(50) NOT NULL,
    color varchar(7) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id serial PRIMARY KEY,
    title varchar(255) NOT NULL,
    completed boolean DEFAULT false,
    date date NOT NULL,
    category_id integer,
    CONSTRAINT fk_category FOREIGN KEY (category_id)
        REFERENCES public.categories(id) ON DELETE SET NULL
);
