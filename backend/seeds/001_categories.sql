INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
  ('Text Generation',  'text-generation',  'AI tools for generating text, articles, and content', 'pencil', 1),
  ('Image Generation', 'image-generation', 'AI tools for creating and editing images',             'image', 2),
  ('Writing',          'writing',          'Tools to help you write better',                        'file-text', 3),
  ('Coding',           'coding',           'AI coding assistants and code generators',              'code', 4),
  ('Education',        'education',        'Learning and educational AI tools',                     'graduation-cap', 5),
  ('Productivity',     'productivity',     'Tools to boost your productivity',                      'zap', 6),
  ('Marketing',        'marketing',        'Marketing copy, ads, and campaign tools',               'megaphone', 7),
  ('Design',           'design',           'Design assistance and creative tools',                  'palette', 8),
  ('Audio',            'audio',            'Audio generation and transcription tools',              'music', 9),
  ('Video',            'video',            'Video creation and editing tools',                      'video', 10),
  ('Other',            'other',            'Other AI tools',                                        'cpu', 11)
ON CONFLICT (slug) DO NOTHING;
