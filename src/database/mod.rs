//! Database module to handle player registration, login, and player statistics using SQLite.
//! 
//! This module provides functionality for player management, including:
//! - Registering new players with a unique ID and initial wallet balance.
//! - Logging in players by their username.
//! - Retrieving player statistics (games played, games won, wallet balance).
//! - Updating player statistics after a game.
//! 
//! It uses `sqlx` for asynchronous database interactions and `uuid` for unique player IDs.

use sqlx::{SqlitePool, Row};
use std::sync::Arc;
use bcrypt::{hash, verify, DEFAULT_COST};
use crate::tour::Tour;
use uuid::Uuid;
use tokio::fs;
 


/// Database wrapper that provides an interface for player management.
#[derive(Clone, Debug)]
pub struct Database {
    pub pool: Arc<SqlitePool>,
}

impl Database {
    /// Creates a new database instance with the given connection pool.
    pub fn new(pool: SqlitePool) -> Self {
        Database {
            pool: Arc::new(pool),
        }
    }

    /// Authenticates a user with username and password
    /// 
    /// # Arguments
    /// * `username` - The user's username.
    /// * `password` - The user's password.
    /// 
    /// # Returns
    /// * `Ok(Some(String))` - The username if authentication succeeds.
    /// * `Ok(None)` - If authentication fails.
    /// * `Err(sqlx::Error)` - If a database error occurs.
    pub async fn authenticate_user(&self, username: &str, password: &str) -> Result<Option<String>, sqlx::Error> {
        let row = sqlx::query("SELECT name, password FROM users WHERE name = ?1")
            .bind(username)
            .fetch_optional(&*self.pool)
            .await?;

        match row {
            Some(row) => {
                let stored_password: String = row.try_get("password")?;
                if verify(password, &stored_password).map_err(|_| {
                    sqlx::Error::Protocol("Failed to verify password".to_string())
                })? {
                    Ok(Some(username.to_string()))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    /// Registers a new user with username and password in the users table
    /// 
    /// # Arguments
    /// * `username` - The user's username (must be unique).
    /// * `password` - The user's password (will be hashed).
    /// 
    /// # Returns
    /// * `Ok(())` - If registration succeeds.
    /// * `Err(sqlx::Error)` - If the insertion fails (e.g., duplicate username).
    pub async fn register_user(&self, username: &str, password: &str) -> Result<(), sqlx::Error> {
        let hashed_password = hash(password, DEFAULT_COST).map_err(|_| {
            sqlx::Error::Protocol("Failed to hash password".to_string())
        })?;

        sqlx::query("INSERT INTO users (name, password) VALUES (?1, ?2)")
            .bind(username)
            .bind(&hashed_password)
            .execute(&*self.pool)
            .await?;
        
        Ok(())
    }

    pub async fn login_user(&self, username: &str) -> Result<String, sqlx::Error> {
        // Generate a session token
        let session_token = Uuid::new_v4().to_string();
        
        // Insert new session into sessions table (allow multiple concurrent sessions)
        sqlx::query("INSERT INTO user_sessions (session_token, username, created_at, last_activity, is_active) VALUES (?1, ?2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)")
            .bind(&session_token)
            .bind(username)
            .execute(&*self.pool)
            .await?;
        
        // Update user's last login time
        sqlx::query("UPDATE users SET last_login = CURRENT_TIMESTAMP, logged_in = TRUE WHERE name = ?1")
            .bind(username)
            .execute(&*self.pool)
            .await?;
        
        Ok(session_token)
    }

    /// Validates a session token and returns whether it's valid
    pub async fn validate_session(&self, username: &str, session_token: &str) -> Result<bool, sqlx::Error> {
        // Check if session exists and is active
        let row = sqlx::query("SELECT is_active FROM user_sessions WHERE session_token = ?1 AND username = ?2 AND is_active = 1")
            .bind(session_token)
            .bind(username)
            .fetch_optional(&*self.pool)
            .await?;

        if row.is_some() {
            // Update last activity for this session
            sqlx::query("UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_token = ?1")
                .bind(session_token)
                .execute(&*self.pool)
                .await?;
            
            // Check if user has too many active sessions and clean up if needed
            let session_count = self.get_active_session_count(username).await?;
            if session_count > 2 {
                // Clean up sessions that haven't been active for more than 2 minutes
                sqlx::query("UPDATE user_sessions SET is_active = 0 WHERE username = ?1 AND session_token != ?2 AND last_activity < datetime('now', '-2 minutes')")
                    .bind(username)
                    .bind(session_token)
                    .execute(&*self.pool)
                    .await?;
            }
            
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Clears a specific session token
    pub async fn clear_session(&self, session_token: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE user_sessions SET is_active = 0 WHERE session_token = ?1")
            .bind(session_token)
            .execute(&*self.pool)
            .await?;
        
        Ok(())
    }

    /// Logout user and clear all their sessions
    pub async fn logout_user(&self, username: &str) -> Result<(), sqlx::Error> {
        // Deactivate all sessions for this user
        sqlx::query("UPDATE user_sessions SET is_active = 0 WHERE username = ?1")
            .bind(username)
            .execute(&*self.pool)
            .await?;
        
        // Update user's logged_in status
        sqlx::query("UPDATE users SET logged_in = FALSE, session_token = NULL WHERE name = ?1")
            .bind(username)
            .execute(&*self.pool)
            .await?;
        
        Ok(())
    }

    /// Clean up old inactive sessions (called periodically)
    pub async fn cleanup_old_sessions(&self) -> Result<(), sqlx::Error> {
        // Remove sessions older than 24 hours of inactivity
        sqlx::query("DELETE FROM user_sessions WHERE last_activity < datetime('now', '-1 day')")
            .execute(&*self.pool)
            .await?;
        
        // Also clean up sessions that haven't been active for more than 10 minutes
        // This helps with refresh scenarios where old connections don't get properly closed
        sqlx::query("UPDATE user_sessions SET is_active = 0 WHERE last_activity < datetime('now', '-10 minutes') AND is_active = 1")
            .execute(&*self.pool)
            .await?;
        
        Ok(())
    }

    /// Get the count of active sessions for a user
    pub async fn get_active_session_count(&self, username: &str) -> Result<i64, sqlx::Error> {
        let row = sqlx::query("SELECT COUNT(*) as count FROM user_sessions WHERE username = ?1 AND is_active = 1")
            .bind(username)
            .fetch_one(&*self.pool)
            .await?;
        
        Ok(row.try_get("count")?)
    }

    /// Force cleanup of old sessions for a user (keeping only the most recent one)
    pub async fn cleanup_user_sessions(&self, username: &str, keep_session_token: &str) -> Result<(), sqlx::Error> {
        // Deactivate all sessions for this user except the specified one
        sqlx::query("UPDATE user_sessions SET is_active = 0 WHERE username = ?1 AND session_token != ?2")
            .bind(username)
            .bind(keep_session_token)
            .execute(&*self.pool)
            .await?;
        
        Ok(())
    }

    /// Retrieves the tours created by a user by username.
    /// 
    /// # Arguments
    /// * `username` - The user's username.
    /// 
    /// # Returns
    /// * `Ok(Vec<Tour>)` - A vector of tours created by the user if found.
    /// * `Err(sqlx::Error)` - If the user does not exist or a database error occurs.
    pub async fn get_tours(&self, username: &str) -> Result<Vec<Tour>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, 
                                                    tour_name,
                                                    created_at, 
                                                    modified_at, 
                                                    initial_scene_id,
                                                    location,
                                                    has_floorplan,
                                                    floorplan_id
                                                    FROM tours WHERE owner = ?1")
            .bind(username)
            .fetch_all(&*self.pool)
            .await?;

        let tours = rows.into_iter().map(|row| {
            Tour::new(
                row.get("id"),
                row.get("tour_name"),
                row.get("created_at"),
                row.get("modified_at"),
                row.get("initial_scene_id"),
                row.get("location"),
                row.get("has_floorplan"),
                row.get("floorplan_id"),
            )
        }).collect();

        Ok(tours)
    }

    /// Creates a new tour for a user.
    /// 
    /// # Arguments
    /// * `username` - The owner's username.
    /// * `tour_name` - The name of the tour.
    /// * `location` - The location of the tour.
    /// 
    /// # Returns
    /// * `Ok(i64)` - The ID of the newly created tour.
    /// * `Err(sqlx::Error)` - If the creation fails.
    pub async fn create_tour(&self, username: &str, tour_name: &str, location: &str) -> Result<i64, sqlx::Error> {
        let result = sqlx::query("INSERT INTO tours (tour_name, owner, location, created_at, modified_at, initial_scene_id, has_floorplan, floorplan_id) 
                                  VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), 1, 0, 1)")
            .bind(tour_name)
            .bind(username)
            .bind(location)
            .execute(&*self.pool)
            .await?;

        Ok(result.last_insert_rowid())
    }

    /// Deletes a tour if it belongs to the specified user.
    /// This cascades to delete all associated scenes and connections.
    /// Also deletes associated files from the filesystem.
    /// 
    /// # Arguments
    /// * `username` - The owner's username.
    /// * `tour_id` - The ID of the tour to delete.
    /// 
    /// # Returns
    /// * `Ok(bool)` - True if the tour was deleted, false if it didn't exist or didn't belong to the user.
    /// * `Err(sqlx::Error)` - If the deletion fails.
    pub async fn delete_tour(&self, username: &str, tour_id: i64) -> Result<bool, sqlx::Error> {
        // First check if the tour exists and belongs to the user
        let tour_exists = sqlx::query("SELECT 1 FROM tours WHERE id = ?1 AND owner = ?2")
            .bind(tour_id)
            .bind(username)
            .fetch_optional(&*self.pool)
            .await?;

        if tour_exists.is_none() {
            return Ok(false);
        }

        // Get all file paths for assets belonging to this tour before deleting
        let file_paths: Vec<String> = sqlx::query("SELECT file_path FROM assets WHERE tour_id = ?1 AND file_path IS NOT NULL")
            .bind(tour_id)
            .fetch_all(&*self.pool)
            .await?
            .iter()
            .filter_map(|row| row.get::<Option<String>, _>("file_path"))
            .collect();

        // Delete files from filesystem
        for file_path in file_paths {
            // Remove leading slash if present (file paths in DB may have /assets/... format)
            let clean_path = file_path.strip_prefix("/").unwrap_or(&file_path);
            
            match fs::remove_file(clean_path).await {
                Ok(_) => println!("Deleted file: {}", clean_path),
                Err(e) => eprintln!("Failed to delete file {}: {}", clean_path, e),
            }
        }

        // Delete all connections for this tour
        sqlx::query("DELETE FROM connections WHERE tour_id = ?1")
            .bind(tour_id)
            .execute(&*self.pool)
            .await?;

        // Delete all assets (scenes and closeups) for this tour
        sqlx::query("DELETE FROM assets WHERE tour_id = ?1")
            .bind(tour_id)
            .execute(&*self.pool)
            .await?;

        // Finally delete the tour itself
        let result = sqlx::query("DELETE FROM tours WHERE id = ?1 AND owner = ?2")
            .bind(tour_id)
            .bind(username)
            .execute(&*self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn get_tour(&self, tour_id: i64, username: &str) -> Result<Tour, sqlx::Error> {
        let row = sqlx::query("SELECT id, 
                                                    tour_name,
                                                    created_at, 
                                                    modified_at, 
                                                    initial_scene_id,
                                                    location,
                                                    has_floorplan,
                                                    floorplan_id
                                                    FROM tours WHERE id = ?1 AND owner = ?2")
            .bind(tour_id)
            .bind(username)
            .fetch_one(&*self.pool)
            .await?;

        Ok(Tour::new(
            row.get("id"),
            row.get("tour_name"),
            row.get("created_at"),
            row.get("modified_at"),
            row.get("initial_scene_id"),
            row.get("location"),
            row.get("has_floorplan"),
            row.get("floorplan_id"),
        ))
    }

    /// Gets a tour with all its scenes and connections for the editor
    /// 
    /// # Arguments
    /// * `username` - The owner's username.
    /// * `tour_id` - The ID of the tour to get.
    /// 
    /// # Returns
    /// * `Ok(Some(TourData))` - The tour data with scenes and connections.
    /// * `Ok(None)` - If the tour doesn't exist or doesn't belong to the user.
    /// * `Err(sqlx::Error)` - If the query fails.
    pub async fn get_tour_with_scenes(&self, username: &str, tour_id: i64) -> Result<Option<serde_json::Value>, sqlx::Error> {
        // First get the tour
        let tour_row = sqlx::query("SELECT id, tour_name, created_at, modified_at, initial_scene_id, location, has_floorplan, floorplan_id
                                   FROM tours WHERE id = ?1 AND owner = ?2")
            .bind(tour_id)
            .bind(username)
            .fetch_optional(&*self.pool)
            .await?;

        if let Some(tour_row) = tour_row {
            // Get all scenes for this tour
            let scene_rows = sqlx::query("SELECT id, name, file_path, description, initial_view_x, initial_view_y, north_dir, pov
                                         FROM assets WHERE tour_id = ?1 AND is_scene = 1")
                .bind(tour_id)
                .fetch_all(&*self.pool)
                .await?;

            let mut scenes = Vec::new();
            for scene_row in scene_rows {
                let scene_id: i64 = scene_row.get("id");
                
                // Get connections for this scene
                let connection_rows = sqlx::query("SELECT id, end_id, name, world_lon, world_lat
                                                  FROM connections WHERE tour_id = ?1 AND start_id = ?2")
                    .bind(tour_id)
                    .bind(scene_id)
                    .fetch_all(&*self.pool)
                    .await?;

                let mut connections = Vec::new();
                for conn_row in connection_rows {
                    let id: i64 = conn_row.get("id");
                    let target: Option<i64> = conn_row.get("end_id");
                    let world_lon: f32 = conn_row.get("world_lon");
                    let world_lat: f32 = conn_row.get("world_lat");
                    let name: Option<String> = conn_row.get("name");
                    let json = serde_json::json!({
                        "id": id,
                        "target_scene_id": target,
                        "position": [world_lon, world_lat],
                        "name": name
                    });
                    connections.push(json);
                }

                scenes.push(serde_json::json!({
                    "id": scene_id,
                    "name": scene_row.get::<String, _>("name"),
                    "file_path": scene_row.get::<Option<String>, _>("file_path"),
                    "description": scene_row.get::<Option<String>, _>("description"),
                    "initial_view_x": scene_row.get::<f32, _>("initial_view_x"),
                    "initial_view_y": scene_row.get::<f32, _>("initial_view_y"),
                    "north_dir": scene_row.get::<Option<f32>, _>("north_dir"),
                    "initial_fov": scene_row.get::<Option<f32>, _>("pov"),
                    "connections": connections
                }));
            }

            let tour_data = serde_json::json!({
                "id": tour_row.get::<i64, _>("id"),
                "name": tour_row.get::<String, _>("tour_name"),
                "location": tour_row.get::<Option<String>, _>("location"),
                "created_at": tour_row.get::<String, _>("created_at"),
                "modified_at": tour_row.get::<String, _>("modified_at"),
                "initial_scene_id": tour_row.get::<i64, _>("initial_scene_id"),
                "scenes": scenes
            });

            Ok(Some(tour_data))
        } else {
            Ok(None)
        }
    }

    /// Saves a scene to the database
    /// 
    /// # Arguments
    /// * `tour_id` - The ID of the tour this scene belongs to
    /// * `name` - The scene name
    /// * `file_path` - The path to the scene image file
    /// * `initial_view_x` - Initial view X coordinate (optional)
    /// * `initial_view_y` - Initial view Y coordinate (optional) 
    /// * `north_direction` - North direction in degrees (optional)
    /// 
    /// # Returns
    /// * `Ok(i64)` - The database ID of the inserted scene
    /// * `Err(sqlx::Error)` - If the insertion fails
    pub async fn save_scene(&self, tour_id: i64, name: &str, file_path: &str, 
                           initial_view_x: Option<f32>, initial_view_y: Option<f32>, 
                           north_direction: Option<f32>) -> Result<i64, sqlx::Error> {
        println!("Creating new asset entry for tour_id: {}, name: '{}', file_path: '{}'", tour_id, name, file_path);
        
        let result = sqlx::query("INSERT INTO assets (tour_id, name, file_path, is_scene, initial_view_x, initial_view_y, north_dir) 
                                 VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)")
            .bind(tour_id)
            .bind(name)
            .bind(file_path)
            .bind(initial_view_x.unwrap_or(0.0))
            .bind(initial_view_y.unwrap_or(0.0))
            .bind(north_direction.map(|d| d as f32))
            .execute(&*self.pool)
            .await?;

        let new_id = result.last_insert_rowid();
        println!("New asset created with database ID: {}", new_id);
        Ok(new_id)
    }

    /// Updates an existing scene in the database
    pub async fn update_scene(&self, scene_db_id: i64, name: Option<&str>, file_path: Option<&str>, 
                             initial_view_x: Option<f32>, initial_view_y: Option<f32>, 
                             north_direction: Option<f32>, pov: Option<f32>) -> Result<(), sqlx::Error> {
        let mut query = "UPDATE assets SET modified_at = CURRENT_TIMESTAMP".to_string();
        let mut bindings = Vec::new();
        let mut param_count = 1;

        if let Some(name) = name {
            query.push_str(&format!(", name = ?{}", param_count));
            bindings.push(name.to_string());
            param_count += 1;
        }
        if let Some(file_path) = file_path {
            query.push_str(&format!(", file_path = ?{}", param_count));
            bindings.push(file_path.to_string());
            param_count += 1;
        }
        if let Some(x) = initial_view_x {
            query.push_str(&format!(", initial_view_x = ?{}", param_count));
            bindings.push(x.to_string());
            param_count += 1;
        }
        if let Some(y) = initial_view_y {
            query.push_str(&format!(", initial_view_y = ?{}", param_count));
            bindings.push(y.to_string());
            param_count += 1;
        }
        if let Some(dir) = north_direction {
            query.push_str(&format!(", north_dir = ?{}", param_count));
            bindings.push((dir as i64).to_string());
            param_count += 1;
        }
        if let Some(pov_val) = pov {
            query.push_str(&format!(", pov = ?{}", param_count));
            bindings.push(pov_val.to_string());
            param_count += 1;
        }

        query.push_str(&format!(" WHERE id = ?{}", param_count));
        bindings.push(scene_db_id.to_string());

        let mut sql_query = sqlx::query(&query);
        for binding in bindings.iter().take(bindings.len() - 1) {
            sql_query = sql_query.bind(binding);
        }
        sql_query = sql_query.bind(scene_db_id);

        sql_query.execute(&*self.pool).await?;
        Ok(())
    }

    /// Deletes a scene from the database and filesystem
    pub async fn delete_scene(&self, scene_db_id: i64) -> Result<(), sqlx::Error> {
        // First delete all connections involving this scene
        sqlx::query("DELETE FROM connections WHERE start_id = ?1 OR end_id = ?1")
            .bind(scene_db_id)
            .execute(&*self.pool)
            .await?;

        // Then delete the scene
        sqlx::query("DELETE FROM assets WHERE id = ?1")
            .bind(scene_db_id)
            .execute(&*self.pool)
            .await?;

        Ok(())
    }

    pub async fn set_initial_scene(&self, tour_id: i64, scene_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE tours SET initial_scene_id = ?1, modified_at = CURRENT_TIMESTAMP WHERE id = ?2")
            .bind(scene_id)
            .bind(tour_id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    /// Clears the initial scene for a tour (sets it to NULL)
    pub async fn clear_initial_scene(&self, tour_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE tours SET initial_scene_id = NULL, modified_at = CURRENT_TIMESTAMP WHERE id = ?1")
            .bind(tour_id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    /// Gets the file path of the initial scene for a tour
    pub async fn get_initial_scene_thumbnail(&self, tour_id: i64, initial_scene_id: Option<i64>) -> Result<Option<String>, sqlx::Error> {
        if let Some(scene_id) = initial_scene_id {
            let row = sqlx::query("SELECT file_path FROM assets WHERE id = ?1 AND tour_id = ?2 AND is_scene = 1")
                .bind(scene_id)
                .bind(tour_id)
                .fetch_optional(&*self.pool)
                .await?;

            Ok(row.and_then(|r| r.get("file_path")))
        } else {
            Ok(None)
        }
    }

    /// Saves a connection to the database
    /// 
    /// # Arguments
    /// * `tour_id` - The ID of the tour this connection belongs to
    /// * `start_scene_db_id` - The database ID of the starting scene
    /// * `end_scene_db_id` - The database ID of the target scene (optional for closeups)
    /// * `screen_loc_x` - X coordinate of the connection on screen
    /// * `screen_loc_y` - Y coordinate of the connection on screen
    /// * `is_transition` - Whether this is a scene transition (true) or closeup (false)
    /// 
    /// # Returns
    /// * `Ok(i64)` - The database ID of the inserted connection
    /// * `Err(sqlx::Error)` - If the insertion fails
    pub async fn save_connection(&self, tour_id: i64, start_scene_db_id: i64, end_scene_db_id: Option<i64>,
                                world_lon: f32, world_lat: f32, is_transition: bool, name: Option<&str>, file_path: Option<&str>) -> Result<i64, sqlx::Error> {
        let result = sqlx::query("INSERT INTO connections (tour_id, start_id, end_id, is_transition, name, world_lon, world_lat, file_path)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
            .bind(tour_id)
            .bind(start_scene_db_id)
            .bind(end_scene_db_id)
            .bind(is_transition)
            .bind(name)
            .bind(world_lon)
            .bind(world_lat)
            .bind(file_path)
            .execute(&*self.pool)
            .await?;

        Ok(result.last_insert_rowid())
    }

    /// Updates an existing connection in the database
    pub async fn update_connection(&self, connection_db_id: i64, end_scene_db_id: Option<i64>,
                                  world_lon: Option<f32>, world_lat: Option<f32>, name: Option<&str>) -> Result<(), sqlx::Error> {
        let mut set_clauses: Vec<String> = Vec::new();
        let mut bindings: Vec<String> = Vec::new();
        let mut param_count = 1;

        if let Some(end_id) = end_scene_db_id {
            set_clauses.push(format!("end_id = ?{}", param_count));
            bindings.push(end_id.to_string());
            param_count += 1;
        }
        if let Some(lon) = world_lon {
            set_clauses.push(format!("world_lon = ?{}", param_count));
            bindings.push(lon.to_string());
            param_count += 1;
        }
        if let Some(lat) = world_lat {
            set_clauses.push(format!("world_lat = ?{}", param_count));
            bindings.push(lat.to_string());
            param_count += 1;
        }
        if let Some(n) = name {
            set_clauses.push(format!("name = ?{}", param_count));
            bindings.push(n.to_string());
            param_count += 1;
        }

        let set_sql = set_clauses.join(", ");
        let query = format!("UPDATE connections SET {} WHERE id = ?{}", set_sql, param_count);
        bindings.push(connection_db_id.to_string());

        let mut sql_query = sqlx::query(&query);
        for binding in bindings.iter().take(bindings.len() - 1) {
            sql_query = sql_query.bind(binding);
        }
        sql_query = sql_query.bind(connection_db_id);

        sql_query.execute(&*self.pool).await?;
        Ok(())
    }

    /// Deletes a connection from the database
    pub async fn delete_connection(&self, connection_db_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM connections WHERE id = ?1")
            .bind(connection_db_id)
            .execute(&*self.pool)
            .await?;

        Ok(())
    }

    /// Saves a closeup asset to the database
    pub async fn save_closeup(&self, tour_id: i64, name: &str, file_path: &str, description: &str) -> Result<i64, sqlx::Error> {
        let result = sqlx::query("INSERT INTO assets (tour_id, name, file_path, description, is_scene) 
                                 VALUES (?1, ?2, ?3, ?4, 0)")
            .bind(tour_id)
            .bind(name)
            .bind(file_path)
            .bind(description)
            .execute(&*self.pool)
            .await?;

        Ok(result.last_insert_rowid())
    }

    /// Gets a scene database ID by tour ID and scene UUID
    pub async fn get_scene_db_id(&self, tour_id: i64, scene_name: &str) -> Result<Option<i64>, sqlx::Error> {
        let row = sqlx::query("SELECT id FROM assets WHERE tour_id = ?1 AND name = ?2 AND is_scene = 1")
            .bind(tour_id)
            .bind(scene_name)
            .fetch_optional(&*self.pool)
            .await?;

        Ok(row.map(|r| r.get("id")))
    }
}
