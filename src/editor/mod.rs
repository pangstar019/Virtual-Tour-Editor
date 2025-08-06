// //! Editor Module to store information about the tour the user is editing
// //! 
// //! This module provides functionality for tour editing, including:
// //! - Adding, editing, and deleting scenes
// //! - Managing connections between scenes
// //! - Inserting and updating closeups
// //! - Setting initial views and directions
// //! 
// //! It uses a backend graph structure to represent the tour and its scenes/closeups, which
// //! will be stored into the database upon save or disconnection of the user.
// //! 
// //! Each connection contains information about the 2 assets in connects and the pixel coordinates
// //! of the connection in the scene.

// use crate::tour::Tour;
// use super::*;

// #[derive(Debug, Clone)]
// pub struct Coordinates {
//     pub x: f32,
//     pub y: f32,
// }

// #[derive(Clone)]
// pub struct Scenes {
//     pub id: String,
//     pub connections: Vec<(String, Coordinates)>,
    
//     pub name: String,
//     pub picture: String,
// }

// #[derive(Debug, Clone)]
// pub struct User {
//     pub name: String,
//     pub email: Option<String>,
//     pub google_id: Option<String>,
//     pub profile_picture: Option<String>,
//     pub display_name: Option<String>,
//     pub auth_method: String,
// }


// /// Database wrapper that provides an interface for player management.
// #[derive(Clone)]
// pub struct Database {
//     pub pool: Arc<SqlitePool>,
// }

// impl Database {
//     /// Creates a new database instance with the given connection pool.
//     pub fn new(pool: SqlitePool) -> Self {
//         Database {
//             pool: Arc::new(pool),
//         }
//     }

//     /// Authenticates a user with username and password
//     /// 
//     /// # Arguments
//     /// * `username` - The user's username.
//     /// * `password` - The user's password.
//     /// 
//     /// # Returns
//     /// * `Ok(Some(String))` - The username if authentication succeeds.
//     /// * `Ok(None)` - If authentication fails.
//     /// * `Err(sqlx::Error)` - If a database error occurs.
//     pub async fn authenticate_user(&self, username: &str, password: &str) -> Result<Option<String>, sqlx::Error> {
//         let row = sqlx::query("SELECT name, password FROM users WHERE name = ?1 AND logged_in = FALSE")
//             .bind(username)
//             .fetch_optional(&*self.pool)
//             .await?;

//         match row {
//             Some(row) => {
//                 let stored_password: String = row.try_get("password")?;
//                 if verify(password, &stored_password).map_err(|_| {
//                     sqlx::Error::Protocol("Failed to verify password".to_string())
//                 })? {
//                     Ok(Some(username.to_string()))
//                 } else {
//                     Ok(None)
//                 }
//             }
//             None => Ok(None),
//         }
//     }

//     /// Registers a new user with username and password in the users table
//     /// 
//     /// # Arguments
//     /// * `username` - The user's username (must be unique).
//     /// * `password` - The user's password (will be hashed).
//     /// 
//     /// # Returns
//     /// * `Ok(())` - If registration succeeds.
//     /// * `Err(sqlx::Error)` - If the insertion fails (e.g., duplicate username).
//     pub async fn register_user(&self, username: &str, password: &str) -> Result<(), sqlx::Error> {
//         let hashed_password = hash(password, DEFAULT_COST).map_err(|_| {
//             sqlx::Error::Protocol("Failed to hash password".to_string())
//         })?;
        
//         sqlx::query("INSERT INTO users (name, password, auth_method) VALUES (?1, ?2, 'local')")
//             .bind(username)
//             .bind(&hashed_password)
//             .execute(&*self.pool)
//             .await?;
        
//         Ok(())
//     }

//     /// Registers or updates a Google OAuth user
//     /// 
//     /// # Arguments
//     /// * `google_user` - Google user information from OAuth
//     /// 
//     /// # Returns
//     /// * `Ok(User)` - The user record
//     /// * `Err(sqlx::Error)` - If the operation fails
//     pub async fn register_or_update_google_user(&self, google_user: &GoogleUserInfo) -> Result<User, sqlx::Error> {
//         // Check if user already exists by Google ID
//         let existing_user = sqlx::query(
//             "SELECT name, email, google_id, profile_picture, display_name, auth_method 
//              FROM users WHERE google_id = ?1"
//         )
//         .bind(&google_user.id)
//         .fetch_optional(&*self.pool)
//         .await?;

//         match existing_user {
//             Some(row) => {
//                 // Update existing user
//                 sqlx::query(
//                     "UPDATE users SET email = ?1, profile_picture = ?2, display_name = ?3, last_login = CURRENT_TIMESTAMP 
//                      WHERE google_id = ?4"
//                 )
//                 .bind(&google_user.email)
//                 .bind(&google_user.picture)
//                 .bind(&google_user.name)
//                 .bind(&google_user.id)
//                 .execute(&*self.pool)
//                 .await?;

//                 Ok(User {
//                     name: row.get("name"),
//                     email: Some(google_user.email.clone()),
//                     google_id: Some(google_user.id.clone()),
//                     profile_picture: Some(google_user.picture.clone()),
//                     display_name: Some(google_user.name.clone()),
//                     auth_method: row.get("auth_method"),
//                 })
//             }
//             None => {
//                 // Create new user with Google info
//                 let username = self.generate_unique_username(&google_user.name).await?;
                
//                 sqlx::query(
//                     "INSERT INTO users (name, email, google_id, profile_picture, display_name, auth_method) 
//                      VALUES (?1, ?2, ?3, ?4, ?5, 'google')"
//                 )
//                 .bind(&username)
//                 .bind(&google_user.email)
//                 .bind(&google_user.id)
//                 .bind(&google_user.picture)
//                 .bind(&google_user.name)
//                 .execute(&*self.pool)
//                 .await?;

//                 Ok(User {
//                     name: username,
//                     email: Some(google_user.email.clone()),
//                     google_id: Some(google_user.id.clone()),
//                     profile_picture: Some(google_user.picture.clone()),
//                     display_name: Some(google_user.name.clone()),
//                     auth_method: "google".to_string(),
//                 })
//             }
//         }
//     }

//     /// Generate a unique username based on display name
//     async fn generate_unique_username(&self, display_name: &str) -> Result<String, sqlx::Error> {
//         let base_name = display_name
//             .to_lowercase()
//             .chars()
//             .filter(|c| c.is_alphanumeric())
//             .collect::<String>();
        
//         let mut username = base_name.clone();
//         let mut counter = 1;
        
//         // Keep trying until we find a unique username
//         loop {
//             let exists = sqlx::query("SELECT COUNT(*) as count FROM users WHERE name = ?1")
//                 .bind(&username)
//                 .fetch_one(&*self.pool)
//                 .await?;
            
//             let count: i64 = exists.get("count");
//             if count == 0 {
//                 return Ok(username);
//             }
            
//             counter += 1;
//             username = format!("{}{}", base_name, counter);
//         }
//     }

//     /// Get user by Google ID
//     pub async fn get_user_by_google_id(&self, google_id: &str) -> Result<Option<User>, sqlx::Error> {
//         let row = sqlx::query(
//             "SELECT name, email, google_id, profile_picture, display_name, auth_method 
//              FROM users WHERE google_id = ?1"
//         )
//         .bind(google_id)
//         .fetch_optional(&*self.pool)
//         .await?;

//         match row {
//             Some(row) => Ok(Some(User {
//                 name: row.get("name"),
//                 email: row.try_get("email").ok(),
//                 google_id: row.try_get("google_id").ok(),
//                 profile_picture: row.try_get("profile_picture").ok(),
//                 display_name: row.try_get("display_name").ok(),
//                 auth_method: row.get("auth_method"),
//             })),
//             None => Ok(None),
//         }
//     }

//     pub async fn login_user(&self, username: &str) -> Result<(), sqlx::Error> {
//         sqlx::query("UPDATE users SET logged_in = TRUE, last_login = CURRENT_TIMESTAMP WHERE name = ?1")
//             .bind(username)
//             .execute(&*self.pool)
//             .await?;
        
//         Ok(())
//     }

//     /// Add a function to logout a user
//     pub async fn logout_user(&self, username: &str) -> Result<(), sqlx::Error> {
//         sqlx::query("UPDATE users SET logged_in = FALSE WHERE name = ?1")
//             .bind(username)
//             .execute(&*self.pool)
//             .await?;
        
//         Ok(())
//     }

//     /// Retrieves the tours created by a user by username.
//     /// 
//     /// # Arguments
//     /// * `username` - The user's username.
//     /// 
//     /// # Returns
//     /// * `Ok(Vec<Tour>)` - A vector of tours created by the user if found.
//     /// * `Err(sqlx::Error)` - If the user does not exist or a database error occurs.
//     pub async fn get_tours(&self, username: &str) -> Result<Vec<Tour>, sqlx::Error> {
//         let rows = sqlx::query("SELECT id, 
//                                                     tour_name,
//                                                     created_at, 
//                                                     modified_at, 
//                                                     initial_scene_id,
//                                                     location,
//                                                     has_floorplan,
//                                                     floorplan_id
//                                                     FROM tours WHERE owner = ?1")
//             .bind(username)
//             .fetch_all(&*self.pool)
//             .await?;

//         let tours = rows.into_iter().map(|row| {
//             Tour::new(
//                 row.get("id"),
//                 row.get("tour_name"),
//                 row.get("created_at"),
//                 row.get("modified_at"),
//                 row.get("initial_scene_id"),
//                 row.get("location"),
//                 row.get("has_floorplan"),
//                 row.get("floorplan_id"),
//             )
//         }).collect();

//         Ok(tours)
//     }

//     /// Creates a new tour for a user.
//     /// 
//     /// # Arguments
//     /// * `username` - The owner's username.
//     /// * `tour_name` - The name of the tour.
//     /// * `location` - The location of the tour.
//     /// 
//     /// # Returns
//     /// * `Ok(i64)` - The ID of the newly created tour.
//     /// * `Err(sqlx::Error)` - If the creation fails.
//     pub async fn create_tour(&self, username: &str, tour_name: &str, location: &str) -> Result<i64, sqlx::Error> {
//         let result = sqlx::query("INSERT INTO tours (tour_name, owner, location, created_at, modified_at, initial_scene_id, has_floorplan, floorplan_id) 
//                                   VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), 1, 0, 1)")
//             .bind(tour_name)
//             .bind(username)
//             .bind(location)
//             .execute(&*self.pool)
//             .await?;

//         Ok(result.last_insert_rowid())
//     }

//     /// Deletes a tour if it belongs to the specified user.
//     /// 
//     /// # Arguments
//     /// * `username` - The owner's username.
//     /// * `tour_id` - The ID of the tour to delete.
//     /// 
//     /// # Returns
//     /// * `Ok(bool)` - True if the tour was deleted, false if it didn't exist or didn't belong to the user.
//     /// * `Err(sqlx::Error)` - If the deletion fails.
//     pub async fn delete_tour(&self, username: &str, tour_id: i64) -> Result<bool, sqlx::Error> {
//         let result = sqlx::query("DELETE FROM tours WHERE id = ?1 AND owner = ?2")
//             .bind(tour_id)
//             .bind(username)
//             .execute(&*self.pool)
//             .await?;

//         Ok(result.rows_affected() > 0)
//     }
// }
