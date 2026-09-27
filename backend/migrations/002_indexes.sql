CREATE INDEX IF NOT EXISTS idx_tools_creator    ON tools(creator_id);
CREATE INDEX IF NOT EXISTS idx_tools_category   ON tools(category_id);
CREATE INDEX IF NOT EXISTS idx_tools_published  ON tools(is_published, is_approved);
CREATE INDEX IF NOT EXISTS idx_tools_featured   ON tools(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_tools_run_count  ON tools(run_count DESC);
CREATE INDEX IF NOT EXISTS idx_tools_avg_rating ON tools(avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_tool   ON tool_runs(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_runs_user   ON tool_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_runs_status ON tool_runs(status);
CREATE INDEX IF NOT EXISTS idx_reviews_tool     ON reviews(tool_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user   ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_tools_fts ON tools
  USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')));
