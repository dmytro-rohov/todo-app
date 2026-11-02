-- Disposable test database mirroring the production role layout.
-- Test-only credentials; never reuse outside deploy/compose.test.yaml.
CREATE ROLE tasks_owner LOGIN PASSWORD 'owner-test-only';
CREATE ROLE tasks_app LOGIN PASSWORD 'app-test-only';

CREATE DATABASE tasks_test OWNER tasks_owner;
REVOKE ALL ON DATABASE tasks_test FROM PUBLIC;
GRANT CONNECT ON DATABASE tasks_test TO tasks_app;

\connect tasks_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO tasks_owner;

CREATE ROLE tasks_restore_owner LOGIN PASSWORD 'restore-test-only';
CREATE DATABASE tasks_restore_test OWNER tasks_restore_owner;
REVOKE ALL ON DATABASE tasks_restore_test FROM PUBLIC;
\connect tasks_restore_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO tasks_restore_owner;
