CREATE TABLE IF NOT EXISTS users (
    name TEXT PRIMARY KEY,
    password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner TEXT NOT NULL,
    tour_name TEXT NOT NULL,
    location TEXT,
    initial_scene_id INTEGER,
    has_floorplan BOOLEAN NOT NULL DEFAULT 0,
    floorplan_id INTEGER,
    FOREIGN KEY (owner) REFERENCES users(name),
    FOREIGN KEY (initial_scene_id) REFERENCES assets(id)
    FOREIGN KEY (floorplan_id) REFERENCES assets(id)
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name TEXT NOT NULL,
    tour_id INTEGER NOT NULL,
    file_path TEXT,
    description TEXT,
    is_scene BOOLEAN NOT NULL DEFAULT 0,
    is_floorplan BOOLEAN NOT NULL DEFAULT 0,
    initial_view_x INTEGER NOT NULL DEFAULT 0,
    initial_view_y INTEGER NOT NULL DEFAULT 0,
    north_dir INTEGER DEFAULT 0,
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
    screen_loc_x INTEGER NOT NULL DEFAULT 0,
    screen_loc_y INTEGER NOT NULL DEFAULT 0,
    is_transition BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (tour_id) REFERENCES tours(id),
    FOREIGN KEY (start_id) REFERENCES assets(id),
    FOREIGN KEY (end_id) REFERENCES assets(id),
    FOREIGN KEY (floorplan_id) REFERENCES assets(id)
);