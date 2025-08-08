//! Editor Module to handle all tour editing functionality
//! 
//! This module provides functionality for tour editing, including:
//! - Adding, editing, and deleting scenes
//! - Managing connections between scenes
//! - Inserting and updating closeups
//! - Setting initial views and directions
//! 
//! It uses a backend graph structure to represent the tour and its scenes/closeups, which
//! will be stored into the database upon save or disconnection of the user.
//! 
//! Each connection contains information about the 2 assets it connects and the pixel coordinates
//! of the connection in the scene.

use serde::{Deserialize, Serialize};
use axum::extract::ws::Message;
use axum::extract::Multipart;
use axum::response::IntoResponse;
use axum::Json;
use axum::http::StatusCode;
use tokio::sync::mpsc;
use tokio::fs;
use std::path::Path as StdPath;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coordinates {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub connections: Vec<Connection>,
    pub initial_view: Option<Coordinates>,
    pub north_direction: Option<i8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionType {
    Transition,
    Closeup
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub connection_type: ConnectionType,
    pub target_scene_id: String,
    pub position: Coordinates,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorState {
    pub tour_id: String,
    pub tour_db_id: i64,
    pub username: String,
    pub scenes: Vec<Scene>,
    pub current_scene_id: Option<String>,
    #[serde(skip)]
    pub db: Option<crate::database::Database>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", content = "data")]
pub enum EditorAction {
    AddScene { name: String, file_path: String },
    SwapScene { scene_id: String, new_file_path: String },
    DeleteScene { scene_id: String },
    AddCloseup { name: String, file_path: String, parent_scene_id: String, position: (i8, i8), description: String },
    AddConnection { start_scene_id: String, asset_id: String, position: (i8, i8) },
    EditConnection { connection_id: String, new_asset_id: String, new_position: (i8, i8) },
    DeleteConnection { connection_id: String },
    SetInitialView { scene_id: String, position: (i8, i8) },
    SetNorthDirection { scene_id: String, direction: i8 },
    ChangeAddress { address: String },
    AddFloorplan { file_path: String },
    DeleteFloorplan { floorplan_id: String },
    AddFloorplanConnection { scene_id: String },
    DeleteFloorplanConnection { scene_id: String },
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub file_path: String,
    pub message: String,
}

impl EditorState {
    pub fn new(tour_id: String, tour_db_id: i64, username: String, db: Option<crate::database::Database>) -> Self {
        Self {
            tour_id,
            tour_db_id,
            username,
            scenes: Vec::new(),
            current_scene_id: None,
            db,
        }
    }

    /// Handle editor actions and return response messages
    pub async fn handle_action(
        &mut self, 
        action: EditorAction,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match action {
            EditorAction::AddScene { name, file_path } => {
                self.add_scene(name, file_path, tx).await?;
            }
            EditorAction::SwapScene { scene_id, new_file_path } => {
                self.swap_scene(scene_id, new_file_path, tx).await?;
            }
            EditorAction::DeleteScene { scene_id } => {
                self.delete_scene(scene_id, tx).await?;
            }
            EditorAction::AddCloseup { name, file_path, parent_scene_id, position, description } => {
                self.add_closeup(name, file_path, parent_scene_id, position, description, tx).await?;
            }
            EditorAction::AddConnection { start_scene_id, asset_id, position } => {
                self.add_connection(start_scene_id, asset_id, position, tx).await?;
            }
            EditorAction::EditConnection { connection_id, new_asset_id, new_position } => {
                self.edit_connection(connection_id, new_asset_id, new_position, tx).await?;
            }
            EditorAction::DeleteConnection { connection_id } => {
                self.delete_connection(connection_id, tx).await?;
            }
            EditorAction::SetInitialView { scene_id, position } => {
                self.set_initial_view(scene_id, position, tx).await?;
            }
            EditorAction::SetNorthDirection { scene_id, direction } => {
                self.set_north_direction(scene_id, direction, tx).await?;
            }
            EditorAction::ChangeAddress { address } => {
                self.change_address(address, tx).await?;
            }
            EditorAction::AddFloorplan { file_path } => {
                self.add_floorplan(file_path, tx).await?;
            }
            EditorAction::DeleteFloorplan { floorplan_id } => {
                self.delete_floorplan(floorplan_id, tx).await?;
            }
            EditorAction::AddFloorplanConnection { scene_id } => {
                self.add_floorplan_connection(scene_id, tx).await?;
            }
            EditorAction::DeleteFloorplanConnection { scene_id } => {
                self.delete_floorplan_connection(scene_id, tx).await?;
            }
        }
        Ok(())
    }
    /// Add a new scene to the tour
    async fn add_scene(
        &mut self,
        name: String,
        file_path: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let scene_id = format!("scene_{}", uuid::Uuid::new_v4());
        
        // Save to database if available
        if let Some(ref db) = self.db {
            match db.save_scene(self.tour_db_id, &name, &file_path, None, None, None).await {
                Ok(db_id) => {
                    println!("Scene '{}' saved to database with ID: {}", name, db_id);
                }
                Err(e) => {
                    eprintln!("Failed to save scene to database: {}", e);
                    let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to save scene to database"}"#.to_string()));
                    return Ok(());
                }
            }
        }
        
        let scene = Scene {
            id: scene_id.clone(),
            name: name.clone(),
            file_path: file_path.clone(),
            connections: Vec::new(),
            initial_view: None,
            north_direction: None,
        };
        
        self.scenes.push(scene);
        
        // If this is the first scene, set it as current
        if self.current_scene_id.is_none() {
            self.current_scene_id = Some(scene_id.clone());
        }
        
        let response = format!(
            r#"{{"type": "scene_added", "scene": {{"name": "{}", "file_path": "{}", "id": "{}"}}}}"#,
            name, file_path, scene_id
        );
        let _ = tx.send(Message::Text(response));
        Ok(())
    }

    /// Swap the image file of an existing scene
    async fn swap_scene(
        &mut self,
        scene_id: String,
        new_file_path: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.file_path = new_file_path.clone();
            
            // Update database if available
            if let Some(ref db) = self.db {
                if let Ok(Some(scene_db_id)) = db.get_scene_db_id(self.tour_db_id, &scene.name).await {
                    if let Err(e) = db.update_scene(scene_db_id, None, Some(&new_file_path), None, None, None).await {
                        eprintln!("Failed to update scene in database: {}", e);
                    }
                }
            }
            
            let response = format!(
                r#"{{"type": "scene_swapped", "scene_id": "{}", "new_file_path": "{}"}}"#,
                scene_id, new_file_path
            );
            let _ = tx.send(Message::Text(response));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Scene not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Delete a scene from the tour
    async fn delete_scene(
        &mut self,
        scene_id: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Find the scene to get its name for database lookup
        let scene_name = self.scenes.iter()
            .find(|s| s.id == scene_id)
            .map(|s| s.name.clone());
        
        // Delete from database if available
        if let Some(ref db) = self.db {
            if let Some(name) = &scene_name {
                if let Ok(Some(scene_db_id)) = db.get_scene_db_id(self.tour_db_id, name).await {
                    if let Err(e) = db.delete_scene(scene_db_id).await {
                        eprintln!("Failed to delete scene from database: {}", e);
                    } else {
                        println!("Scene '{}' deleted from database", name);
                    }
                }
            }
        }
        
        // Remove the scene
        self.scenes.retain(|s| s.id != scene_id);
        
        // Remove all connections to this scene
        for scene in &mut self.scenes {
            scene.connections.retain(|c| c.target_scene_id != scene_id);
        }
        
        // If this was the current scene, clear it
        if self.current_scene_id.as_ref() == Some(&scene_id) {
            self.current_scene_id = self.scenes.first().map(|s| s.id.clone());
        }
        
        let response = format!(
            r#"{{"type": "scene_deleted", "scene_id": "{}"}}"#,
            scene_id
        );
        let _ = tx.send(Message::Text(response));
        Ok(())
    }

    /// Add a closeup to a scene
    async fn add_closeup(
        &mut self,
        name: String,
        file_path: String,
        parent_scene_id: String,
        position: (i8, i8),
        description: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        
        // Save closeup to database if available
        if let Some(ref db) = self.db {
            match db.save_closeup(self.tour_db_id, &name, &file_path, &description).await {
                Ok(closeup_db_id) => {
                    println!("Closeup '{}' saved to database with ID: {}", name, closeup_db_id);
                    
                    // Find the parent scene and add the connection
                    if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == parent_scene_id) {
                        // Get parent scene database ID for connection
                        if let Ok(Some(scene_db_id)) = db.get_scene_db_id(self.tour_db_id, &scene.name).await {
                            // Save connection to the closeup
                            match db.save_connection(self.tour_db_id, scene_db_id, Some(closeup_db_id), position.0 as i32, position.1 as i32, false).await {
                                Ok(conn_db_id) => {
                                    println!("Connection to closeup saved with ID: {}", conn_db_id);
                                    
                                    // Add connection to in-memory structure
                                    let connection_id = format!("conn_{}", uuid::Uuid::new_v4());
                                    let connection = Connection {
                                        id: connection_id.clone(),
                                        connection_type: ConnectionType::Closeup,
                                        target_scene_id: format!("closeup_{}", closeup_db_id),
                                        position: Coordinates { x: position.0 as f32, y: position.1 as f32 },
                                    };
                                    scene.connections.push(connection);
                                    
                                    let response = format!(
                                        r#"{{"type": "closeup_added", "name": "{}", "file_path": "{}", "parent_scene": "{}", "connection_id": "{}"}}"#,
                                        name, file_path, parent_scene_id, connection_id
                                    );
                                    let _ = tx.send(Message::Text(response));
                                }
                                Err(e) => {
                                    eprintln!("Failed to save closeup connection to database: {}", e);
                                    let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to save closeup connection"}"#.to_string()));
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to save closeup to database: {}", e);
                    let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to save closeup to database"}"#.to_string()));
                }
            }
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Database not available for closeup storage"}"#.to_string()));
        }
        
        Ok(())
    }

    /// Add a connection between scenes
    async fn add_connection(
        &mut self,
        start_scene_id: String,
        target_scene_id: String,
        position: (i8, i8),
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Get scene names first to avoid borrowing issues
        let start_scene_name = self.scenes.iter()
            .find(|s| s.id == start_scene_id)
            .map(|s| s.name.clone());
        let target_scene_name = self.scenes.iter()
            .find(|s| s.id == target_scene_id)
            .map(|s| s.name.clone());
        
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == start_scene_id) {
            // Save connection to database if available
            if let Some(ref db) = self.db {
                if let (Some(start_name), Some(target_name)) = (&start_scene_name, &target_scene_name) {
                    // Get start scene database ID
                    if let Ok(Some(start_scene_db_id)) = db.get_scene_db_id(self.tour_db_id, start_name).await {
                        // Get target scene database ID
                        if let Ok(Some(target_scene_db_id)) = db.get_scene_db_id(self.tour_db_id, target_name).await {
                            match db.save_connection(self.tour_db_id, start_scene_db_id, Some(target_scene_db_id), position.0 as i32, position.1 as i32, true).await {
                                Ok(conn_db_id) => {
                                    println!("Connection saved to database with ID: {}", conn_db_id);
                                }
                                Err(e) => {
                                    eprintln!("Failed to save connection to database: {}", e);
                                }
                            }
                        }
                    }
                }
            }
            
            let connection_id = format!("conn_{}", uuid::Uuid::new_v4());
            let connection = Connection {
                id: connection_id.clone(),
                connection_type: ConnectionType::Transition,
                target_scene_id: target_scene_id.clone(),
                position: Coordinates { x: position.0 as f32, y: position.1 as f32 },
            };

            scene.connections.push(connection);
            
            let response = format!(
                r#"{{"type": "connection_added", "connection_id": "{}", "start_scene": "{}", "target_scene": "{}"}}"#,
                connection_id, start_scene_id, target_scene_id
            );
            let _ = tx.send(Message::Text(response));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Start scene not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Edit an existing connection
    async fn edit_connection(
        &mut self,
        connection_id: String,
        new_target_id: String,
        new_position: (i8, i8),
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut found = false;
        for scene in &mut self.scenes {
            if let Some(connection) = scene.connections.iter_mut().find(|c| c.id == connection_id) {
                connection.target_scene_id = new_target_id.clone();
                connection.position = Coordinates { x: new_position.0 as f32, y: new_position.1 as f32 };
                found = true;
                break;
            }
        }
        
        if found {
            let response = format!(
                r#"{{"type": "connection_edited", "connection_id": "{}"}}"#,
                connection_id
            );
            let _ = tx.send(Message::Text(response));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Connection not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Delete a connection
    async fn delete_connection(
        &mut self,
        connection_id: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut found = false;
        for scene in &mut self.scenes {
            let original_len = scene.connections.len();
            scene.connections.retain(|c| c.id != connection_id);
            if scene.connections.len() < original_len {
                found = true;
                break;
            }
        }
        
        if found {
            let response = format!(
                r#"{{"type": "connection_deleted", "connection_id": "{}"}}"#,
                connection_id
            );
            let _ = tx.send(Message::Text(response));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Connection not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Set the initial view position for a scene
    async fn set_initial_view(
        &mut self,
        scene_id: String,
        position: (i8, i8),
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.initial_view = Some(Coordinates { x: position.0 as f32, y: position.1 as f32 });
            
            // Update database if available
            if let Some(ref db) = self.db {
                if let Ok(Some(scene_db_id)) = db.get_scene_db_id(self.tour_db_id, &scene.name).await {
                    if let Err(e) = db.update_scene(scene_db_id, None, None, Some(position.0 as i32), Some(position.1 as i32), None).await {
                        eprintln!("Failed to update scene initial view in database: {}", e);
                    } else {
                        println!("Initial view updated for scene '{}' in database", scene.name);
                    }
                }
            }
            
            let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Initial view position saved."}"#.to_string()));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Scene not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Set the north direction for a scene
    async fn set_north_direction(
        &mut self,
        scene_id: String,
        direction: i8,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.north_direction = Some(direction);
            
            // Update database if available
            if let Some(ref db) = self.db {
                if let Ok(Some(scene_db_id)) = db.get_scene_db_id(self.tour_db_id, &scene.name).await {
                    if let Err(e) = db.update_scene(scene_db_id, None, None, None, None, Some(direction)).await {
                        eprintln!("Failed to update scene north direction in database: {}", e);
                    } else {
                        println!("North direction updated for scene '{}' in database", scene.name);
                    }
                }
            }
            
            let _ = tx.send(Message::Text(r#"{"type": "success", "message": "North direction saved."}"#.to_string()));
        } else {
            let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Scene not found."}"#.to_string()));
        }
        Ok(())
    }

    /// Change the tour address/location
    async fn change_address(
        &mut self,
        _address: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Store address in tour metadata
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Address updated."}"#.to_string()));
        Ok(())
    }

    /// Add a floorplan to the tour
    async fn add_floorplan(
        &mut self,
        _file_path: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Delete a floorplan
    async fn delete_floorplan(
        &mut self,
        _floorplan_id: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Add a connection to a floorplan
    async fn add_floorplan_connection(
        &mut self,
        _scene_id: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Delete a floorplan connection
    async fn delete_floorplan_connection(
        &mut self,
        _scene_id: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Get the current state as JSON for the client
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// Load scenes from the database
    pub async fn load_from_database(&mut self, database: &crate::database::Database) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Load tour data from database into the editor state
        if let Ok(Some(_tour_data)) = database.get_tour_with_scenes(&self.username, self.tour_db_id).await {
            println!("Loaded tour data from database for tour: {}", self.tour_id);
            // TODO: Parse tour_data and populate self.scenes from database format
            // For now, we'll work with the in-memory scenes created during editor actions
        }
        Ok(())
    }

    /// Save scenes to the database
    pub async fn save_to_database(&self, _database: &crate::database::Database) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Save any pending changes to the database
        // Since we're saving changes immediately in each action, this is primarily for cleanup
        println!("Tour data saved for tour: {}", self.tour_id);
        Ok(())
    }
}

/// Handle file upload for assets
pub async fn upload_asset_handler(mut multipart: Multipart) -> impl IntoResponse {
    println!("Upload handler called");
    
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_string();
                println!("Processing field: {}", name);
                
                if name == "file" {
                    let filename = field.file_name().unwrap_or("uploaded_file").to_string();
                    println!("Uploading file: {}", filename);
                    
                    match field.bytes().await {
                        Ok(data) => {
                            println!("File data read successfully, size: {} bytes", data.len());
                            
                            // Generate unique filename
                            let timestamp = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs();
                            
                            // Remove extension from original filename to avoid double extensions
                            let base_name = StdPath::new(&filename)
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("uploaded_file");
                            let ext = StdPath::new(&filename)
                                .extension()
                                .and_then(|s| s.to_str())
                                .unwrap_or("jpg");
                            let new_filename = format!("uploaded_{}_{}.{}", timestamp, base_name.replace(" ", "_"), ext);
                            
                            // Save to assets/insta360 directory
                            let file_path = format!("assets/insta360/{}", new_filename);
                            
                            // Ensure the directory exists
                            if let Some(parent) = StdPath::new(&file_path).parent() {
                                if let Err(e) = fs::create_dir_all(parent).await {
                                    eprintln!("Failed to create directory: {}", e);
                                }
                            }
                            
                            match fs::write(&file_path, &data).await {
                                Ok(_) => {
                                    println!("File saved successfully to: {}", file_path);
                                    let response = UploadResponse {
                                        file_path: format!("/{}", file_path),
                                        message: "File uploaded successfully".to_string(),
                                    };
                                    return (StatusCode::OK, Json(response)).into_response();
                                }
                                Err(e) => {
                                    eprintln!("Failed to save file: {}", e);
                                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file").into_response();
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to read file data: Error parsing `multipart/form-data` request: {}", e);
                            return (StatusCode::BAD_REQUEST, format!("Failed to read file data: Error parsing `multipart/form-data` request: {}", e)).into_response();
                        }
                    }
                } else {
                    // Skip non-file fields
                    match field.bytes().await {
                        Ok(_) => println!("Skipped field: {}", name),
                        Err(e) => {
                            eprintln!("Error reading field '{}': {}", name, e);
                        }
                    }
                }
            }
            Ok(None) => {
                println!("No more fields in multipart request");
                break;
            }
            Err(e) => {
                eprintln!("Failed to get next field: Error parsing `multipart/form-data` request: {}", e);
                return (StatusCode::BAD_REQUEST, format!("Failed to read file data: Error parsing `multipart/form-data` request: {}", e)).into_response();
            }
        }
    }
    
    println!("No file field found in multipart request");
    (StatusCode::BAD_REQUEST, "No file uploaded").into_response()
}
