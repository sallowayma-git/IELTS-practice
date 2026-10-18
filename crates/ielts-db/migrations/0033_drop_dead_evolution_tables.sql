-- Version 33: drop the tables nothing reads or writes any more.
--
-- Teaching-strategy evolution (0020, 0023), prompt/skill release management
-- and offline eval (0021, 0025), the retrieval index registry and runs (0016)
-- and the daily dream candidates (0018) lost their last caller when the M10/M11
-- modules, the retrieval sidecar and the daily proposal path were deleted. No
-- table that stays references any of them. Children are dropped before their
-- parents so the implicit DELETE of each DROP never cascades into a live table.
-- The pre-migration snapshot (backups/pre-migrate-*.db) keeps their rows.
DROP TABLE IF EXISTS prompt_skill_release_heads;
-- A release names its predecessor in the same table ON DELETE RESTRICT, so the
-- implicit DELETE of DROP TABLE fails on any release chain: unlink it first.
-- The stand-in table only keeps this file re-runnable once the table is gone.
CREATE TABLE IF NOT EXISTS prompt_skill_releases (predecessor_release_id TEXT);
UPDATE prompt_skill_releases SET predecessor_release_id = NULL;
DROP TABLE IF EXISTS prompt_skill_releases;
DROP TABLE IF EXISTS shadow_runs;
DROP TABLE IF EXISTS eval_results;
DROP TABLE IF EXISTS eval_runs;
DROP TABLE IF EXISTS eval_cases;
DROP TABLE IF EXISTS candidate_promotions;
DROP TABLE IF EXISTS prompt_versions;
DROP TABLE IF EXISTS prompt_templates;
DROP TABLE IF EXISTS skill_versions;
DROP TABLE IF EXISTS skill_definitions;
DROP TABLE IF EXISTS strategy_candidate_evaluations;
DROP TABLE IF EXISTS strategy_candidate_batches;
DROP TABLE IF EXISTS teaching_strategy_outcomes;
DROP TABLE IF EXISTS teaching_strategy_feedback;
DROP TABLE IF EXISTS teaching_strategy_assignments;
DROP TABLE IF EXISTS user_strategy_state;
DROP TABLE IF EXISTS teaching_strategy_catalog;
DROP TABLE IF EXISTS retrieval_runs;
DROP TABLE IF EXISTS retrieval_index_registry;
DROP TABLE IF EXISTS dream_candidates;
