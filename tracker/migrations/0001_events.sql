CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  type TEXT NOT NULL,          -- 'view' or 'click'
  visitor TEXT,                -- random id kept in the visitor's browser
  session TEXT,                -- random id per browser tab session
  path TEXT,
  source TEXT,                 -- ?ref= tag from a shared link
  referrer TEXT,
  label TEXT,                  -- clicked link name
  url TEXT,                    -- clicked link target
  country TEXT,
  region TEXT,
  city TEXT,
  org TEXT,                    -- network owner (ISP or company)
  browser TEXT,
  os TEXT,
  device TEXT
);
CREATE INDEX events_ts ON events (ts);
CREATE INDEX events_session ON events (session);
