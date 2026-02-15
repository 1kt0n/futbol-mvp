-- 008_player_cards_index.sql
-- Mejora de performance para consulta de mini rating en player cards.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_player_ratings_target_visible
  ON public.player_ratings (target_user_id, is_hidden);

COMMIT;