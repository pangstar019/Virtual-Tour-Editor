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

    /// Add a function to logout a user
    pub async fn logout_user(&self, username: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE players SET logged_in = FALSE WHERE name = ?1")
            .bind(username)
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
}
