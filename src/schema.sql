CREATE TABLE IF NOT EXISTS users (
    name TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logged_in BOOLEAN NOT NULL DEFAULT 0,
    session_token TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    FOREIGN KEY (username) REFERENCES users(name)
);

CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner TEXT NOT NULL,
    tour_name TEXT NOT NULL,
    -- location removed per feature request
    longitude REAL,
    latitude REAL,
    initial_scene_id INTEGER DEFAULT 1,
    has_floorplan BOOLEAN NOT NULL DEFAULT 0,
    floorplan_id INTEGER DEFAULT 1,
    sort_mode TEXT NOT NULL DEFAULT 'created_at', -- alphabetical | created_at | modified_at
    sort_direction TEXT NOT NULL DEFAULT 'asc',     -- asc | desc
    FOREIGN KEY (owner) REFERENCES users(name)
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name TEXT NOT NULL,
    tour_id INTEGER NOT NULL,
    file_path TEXT,
    description TEXT,
    is_scene BOOLEAN NOT NULL DEFAULT 0,
    is_floorplan BOOLEAN NOT NULL DEFAULT 0,
    initial_view_x FLOAT NOT NULL DEFAULT 0,
    initial_view_y FLOAT NOT NULL DEFAULT 0,
    north_dir FLOAT DEFAULT 0,
    pov FLOAT DEFAULT 75,
    FOREIGN KEY (tour_id) REFERENCES tours(id)
);

CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tour_id INTEGER NOT NULL,
    start_id INTEGER NOT NULL,
    end_id INTEGER,
    floorplan_id INTEGER,
    is_floorplan BOOLEAN NOT NULL DEFAULT 0,
    name TEXT,
    world_lon FLOAT NOT NULL,
    world_lat FLOAT NOT NULL,
    is_transition BOOLEAN NOT NULL DEFAULT 0,
    file_path TEXT,
    icon_type INTEGER,
    FOREIGN KEY (tour_id) REFERENCES tours(id),
    FOREIGN KEY (start_id) REFERENCES assets(id),
    FOREIGN KEY (end_id) REFERENCES assets(id),
    FOREIGN KEY (floorplan_id) REFERENCES assets(id)
);