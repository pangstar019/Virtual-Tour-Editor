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
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserInfo {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: String,
}

#[derive(Debug, Clone)]
pub struct User {
    pub name: String,
    pub email: Option<String>,
    pub google_id: Option<String>,
    pub profile_picture: Option<String>,
    pub display_name: Option<String>,
    pub auth_method: String,
}


/// Database wrapper that provides an interface for player management.
#[derive(Clone)]
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
    /// 
    /// # Arguments
    /// * `username` - The owner's username.
    /// * `tour_id` - The ID of the tour to delete.
    /// 
    /// # Returns
    /// * `Ok(bool)` - True if the tour was deleted, false if it didn't exist or didn't belong to the user.
    /// * `Err(sqlx::Error)` - If the deletion fails.
    pub async fn delete_tour(&self, username: &str, tour_id: i64) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM tours WHERE id = ?1 AND owner = ?2")
            .bind(tour_id)
            .bind(username)
            .execute(&*self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn get_tour(&self, tour_id: &str, username: &str) -> Result<Tour, sqlx::Error> {
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
}
