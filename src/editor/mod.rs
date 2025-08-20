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
use std::i32;
use std::path::Path as StdPath;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coordinates {
    pub x: f32, // longitude (deg)
    pub y: f32, // latitude (deg)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: i32,
    pub name: String,
    pub file_path: String,
    pub connections: Vec<Connection>,
    pub initial_view: Option<Coordinates>,
    pub north_direction: Option<f32>,
}
 
// Connection types: transition between scenes or closeup link
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionType {
    Transition,
    Closeup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: i32,
    pub connection_type: ConnectionType,
    pub target_scene_id: i32,
    pub position: Coordinates,
    pub name: Option<String>,
    pub icon_index: Option<i32>,
}

// Actions received from the client/editor UI
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", content = "data")]
pub enum EditorAction {
    AddScene { name: String, file_path: String },
    SwapScene { scene_id: i32, new_file_path: String },
    DeleteScene { scene_id: i32 },
    SetInitialScene { scene_id: i32 },
    UpdateSceneName { scene_id: i32, name: String },
    AddCloseup { name: String, file_path: String, parent_scene_id: i32, position: (f32, f32), icon_type: Option<i32> },
    AddConnection { start_scene_id: i32, asset_id: i32, position: (f32, f32), name: Option<String> },
    EditConnection { connection_id: i32, new_asset_id: i32, new_position: (f32, f32), new_name: Option<String>, new_icon_type: Option<i32>, new_file_path: Option<String> },
    DeleteConnection { connection_id: i32 },
    SetInitialView { scene_id: i32, position: (f32, f32), fov: Option<f32> },
    SetNorthDirection { scene_id: i32, direction: f32 },
    ChangeAddress { address: String },
    AddFloorplan { file_path: String },
    DeleteFloorplan { floorplan_id: i32 },
    AddFloorplanConnection { scene_id: i32 },
    DeleteFloorplanConnection { scene_id: i32 },
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub file_path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct EditorState {
    pub tour_id: i64,
    pub username: String,
    pub scenes: Vec<Scene>,
    pub current_scene_id: Option<i32>,
    #[serde(skip_serializing)]
    pub db: Option<crate::database::Database>,
    #[serde(skip_serializing)]
    pub scenes_index: HashMap<i32, usize>,
    #[serde(skip_serializing)]
    pub connection_index: HashMap<i32, (i32, usize)>,
}

impl EditorState {
    pub fn new(tour_id: i64, username: String, db: Option<crate::database::Database>) -> Self {
        Self {
            tour_id,
            username,
            scenes: Vec::new(),
            current_scene_id: None,
            db,
            scenes_index: HashMap::new(),
            connection_index: HashMap::new(),
        }
    }

    fn rebuild_indices(&mut self) {
        self.scenes_index.clear();
        self.connection_index.clear();
        for (si, scene) in self.scenes.iter().enumerate() {
            self.scenes_index.insert(scene.id, si);
            for (ci, conn) in scene.connections.iter().enumerate() {
                if conn.id != 0 { // avoid indexing placeholder IDs
                    self.connection_index.insert(conn.id, (scene.id, ci));
                }
            }
        }
    }

    fn rebuild_scene_connection_index(&mut self, scene_id: i32) {
        // Reindex connections for a single scene (after delete/reorder)
        if let Some(&si) = self.scenes_index.get(&scene_id) {
            if let Some(scene) = self.scenes.get(si) {
                // Remove existing entries for this scene
                let ids_to_remove: Vec<i32> = self
                    .connection_index
                    .iter()
                    .filter_map(|(cid, (sid, _))| if *sid == scene_id { Some(*cid) } else { None })
                    .collect();
                for cid in ids_to_remove { self.connection_index.remove(&cid); }
                // Reinsert with updated indices
                for (ci, conn) in scene.connections.iter().enumerate() {
                    if conn.id != 0 {
                        self.connection_index.insert(conn.id, (scene_id, ci));
                    }
                }
            }
        }
    }

    /// Handle editor actions and return response messages
    pub async fn handle_action(
        &mut self, 
        action: EditorAction,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("Handling editor action: {:?}\n", action);
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
            EditorAction::SetInitialScene { scene_id } => {
                self.set_initial_scene(scene_id).await?;
            }
            EditorAction::UpdateSceneName { scene_id, name } => {
                self.update_scene_name(scene_id, name, tx).await?;
            }
            EditorAction::AddCloseup { name, file_path, parent_scene_id, position, icon_type } => {
                self.add_closeup(name, file_path, parent_scene_id, position, icon_type, tx).await?;
            }
            EditorAction::AddConnection { start_scene_id, asset_id, position, name } => {
                self.add_connection(start_scene_id, asset_id, position, name, tx).await?;
            }
            EditorAction::EditConnection { connection_id, new_asset_id, new_position, new_name, new_icon_type, new_file_path } => {
                self.edit_connection(connection_id, new_asset_id, new_position, new_name, new_icon_type, new_file_path, tx).await?;
            }
            EditorAction::DeleteConnection { connection_id } => {
                self.delete_connection(connection_id, tx).await?;
            }
            EditorAction::SetInitialView { scene_id, position, fov } => {
                self.set_initial_view(scene_id, position, fov, tx).await?;
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
        println!("ADD_SCENE: Creating scene '{}' with file_path: '{}' for tour: {}", name, file_path, self.tour_id);
        
        // Save to database first to get the auto-generated ID
        let scene_id = if let Some(ref db) = self.db {
            match db.save_scene(self.tour_id, &name, &file_path, None, None, None).await {
                Ok(db_id) => {
                    println!("Scene '{}' saved to database with NEW unique ID: {}", name, db_id);
                    db_id
                }
                Err(e) => {
                    eprintln!("Failed to save scene to database: {}", e);
                    let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to save scene to database"}"#.to_string()));
                    return Ok(());
                }
            }
        } else {
            // Fallback if no database - shouldn't happen in normal operation
            0
        };
        
    let scene = Scene {
            id: scene_id as i32,
            name: name.clone(),
            file_path: file_path.clone(),
            connections: Vec::new(),
            initial_view: None,
            north_direction: None,
        };
        
        self.scenes.push(scene);
    // Index the new scene
    self.scenes_index.insert(scene_id as i32, self.scenes.len() - 1);
        
        // If this is the first scene, set it as the initial scene in the database
        if self.scenes.len() == 1 {
            if let Some(ref db) = self.db {
                if let Err(e) = db.set_initial_scene(self.tour_id, scene_id).await {
                    eprintln!("Failed to set initial scene in database: {}", e);
                }
            }
        }

    // No derivative generation; previous behavior restored

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
        scene_id: i32,
        new_file_path: String,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.file_path = new_file_path.clone();
            
            // Update database if available using numeric ID directly
            if let Some(ref db) = self.db {
                if let Err(e) = db.update_scene(scene.id as i64, None, Some(&new_file_path), None, None, None, None).await {
                    eprintln!("Failed to update scene in database: {}", e);
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
        scene_id: i32,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("DELETE_SCENE: Attempting to delete scene with ID: {}", scene_id);
        
        // Delete from database if available using numeric ID directly
        if let Some(ref db) = self.db {
            if let Err(e) = db.delete_scene(scene_id as i64).await {
                eprintln!("Failed to delete scene from database: {}", e);
            } else {
                println!("Scene '{}' deleted from database", scene_id);
            }
        } else {
            eprintln!("DELETE_SCENE: Database not available");
        }
        // Collect connection IDs that will be removed (outgoing from the scene itself and incoming from others)
        let mut removed_connection_ids: Vec<i32> = Vec::new();

        // Outgoing: find the scene first to capture connection ids
        if let Some(&si) = self.scenes_index.get(&scene_id) {
            if let Some(scene) = self.scenes.get(si) {
                for c in &scene.connections {
                    removed_connection_ids.push(c.id);
                }
            }
        }

        // Remove the scene
        self.scenes.retain(|s| s.id != scene_id);

        // Incoming: remove connections in other scenes that target this scene and record their ids
        for scene in &mut self.scenes {
            for c in &scene.connections {
                if c.target_scene_id == scene_id {
                    removed_connection_ids.push(c.id);
                }
            }
            scene.connections.retain(|c| c.target_scene_id != scene_id);
        }

    // Rebuild indices to reflect removals
    self.rebuild_indices();
        
        // If this was the current scene, clear it
        if self.current_scene_id.as_ref() == Some(&scene_id) {
            self.current_scene_id = self.scenes.first().map(|s| s.id);
            // Persist new or cleared initial scene
            if let Some(ref db) = self.db {
                if let Some(new_id) = self.current_scene_id {
                    if let Err(e) = db.set_initial_scene(self.tour_id, new_id as i64).await {
                        eprintln!("Failed to update initial scene after deletion: {}", e);
                    }
                } else {
                    if let Err(e) = db.clear_initial_scene(self.tour_id).await {
                        eprintln!("Failed to clear initial scene after deletion: {}", e);
                    }
                }
            }
        }
        
        let response = format!(
            r#"{{"type": "scene_deleted", "scene_id": "{}"}}"#,
            scene_id
        );
        let _ = tx.send(Message::Text(response));

        // Notify clients of each removed connection so UIs can clean up markers
        for cid in removed_connection_ids {
            let _ = tx.send(Message::Text(format!(
                r#"{{"type": "connection_deleted", "connection_id": "{}"}}"#,
                cid
            )));
        }
        Ok(())
    }

    async fn set_initial_scene(&mut self, scene_id: i32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Set the current scene to the specified one
        if self.scenes.iter().any(|s| s.id == scene_id) {
            if let Some(ref db) = self.db {
                // Update the database with the new initial scene
                if let Err(e) = db.set_initial_scene(self.tour_id, scene_id as i64).await {
                    eprintln!("Failed to set initial scene in database: {}", e);
                }
            }
            Ok(())
        } else {
            Err("Scene not found.".into())
        }
    }

    async fn update_scene_name(&mut self, scene_id: i32, new_name: String, _tx: &mpsc::UnboundedSender<Message>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Update the scene name in the in-memory structure
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.name = new_name.clone();
        }

        // Update the scene name in the database if available
        if let Some(ref db) = self.db {
            if let Err(e) = db.update_scene(scene_id as i64, Some(&new_name), None, None, None, None, None).await {
                eprintln!("Failed to update scene name in database: {}", e);
            }
        }
        Ok(())
    }

    /// Add a closeup to a scene
    async fn add_closeup(
        &mut self,
        name: String,
        file_path: String,
        parent_scene_id: i32,
        position: (f32, f32),
        icon_type: Option<i32>,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        
        // Save closeup to database if available
        if let Some(ref db) = self.db {
            match db.save_closeup(self.tour_id, &name, &file_path, icon_type).await {
                Ok(closeup_db_id) => {
                    println!("Closeup '{}' saved to database with ID: {}", name, closeup_db_id);
                    
                    // Find the parent scene and add the connection
                    if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == parent_scene_id) {
                        // Save connection to the closeup using numeric scene ID
                        match db.save_connection(
                            self.tour_id,
                            scene.id as i64,
                            Some(closeup_db_id),
                            position.0 as f32,
                            position.1 as f32,
                            false,
                            Some(&name),
                            Some(&file_path),
                            icon_type,
                        ).await {
                            Ok(conn_db_id) => {
                                println!("Connection to closeup saved with ID: {}", conn_db_id);
                                
                                // Add connection to in-memory structure using database ID
                                let connection = Connection {
                                    id: conn_db_id as i32,
                                    connection_type: ConnectionType::Closeup,
                                    target_scene_id: closeup_db_id as i32,
                                    position: Coordinates { x: position.0 as f32, y: position.1 as f32 },
                                    name: Some(name.clone()),
                                    icon_index: icon_type,
                                };
                                scene.connections.push(connection);
                                // Update index for this new closeup so edits can find it
                                if let Some(last) = scene.connections.last() {
                                    if last.id != 0 {
                                        self.connection_index.insert(last.id, (parent_scene_id, scene.connections.len() - 1));
                                    }
                                }
                                
                                let response = format!(
                                    r#"{{"type": "closeup_added", "name": "{}", "file_path": "{}", "parent_scene": "{}", "connection_id": "{}", "icon_type": {}}}"#,
                                    name, file_path, parent_scene_id, conn_db_id, icon_type.unwrap_or(1)
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
        start_scene_id: i32,
        target_scene_id: i32,
        position: (f32, f32),
        name: Option<String>,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == start_scene_id) {
            // Determine if provided position is lon/lat
            let (world_lon, world_lat) = (position.0 as f32, position.1 as f32);

            // Save connection to database first to get auto-generated ID
            let connection_db_id = if let Some(ref db) = self.db {
                match db.save_connection(
                    self.tour_id,
                    start_scene_id as i64,
                    Some(target_scene_id as i64),
                    world_lon,
                    world_lat,
                    true,
                    name.as_deref(),
                    None,
                    None
                ).await {
                    Ok(conn_db_id) => {
                        println!("Connection saved to database with ID: {}", conn_db_id);
                        Some(conn_db_id)
                    }
                    Err(e) => {
                        eprintln!("Failed to save connection to database: {}", e);
                        None
                    }
                }
            } else {
                None
            };

            // Use database ID if available, otherwise use fallback
            let connection_id = connection_db_id.map(|id| id as i32).unwrap_or(0);

            let connection = Connection {
                id: connection_id,
                connection_type: ConnectionType::Transition,
                target_scene_id: target_scene_id,
                position: Coordinates { x: position.0 as f32, y: position.1 as f32 },
                name,
                icon_index: None,
            };

            scene.connections.push(connection);
            // Update index for this new connection
            if let Some(last) = scene.connections.last() { 
                if last.id != 0 {
                    self.connection_index.insert(last.id, (start_scene_id, scene.connections.len() - 1));
                }
            }
            
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
        connection_id: i32,
        new_target_id: i32,
        new_position: (f32, f32),
        new_name: Option<String>,
        new_icon_type: Option<i32>,
        new_file_path: Option<String>,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let found = if let Some((start_scene_id, conn_idx)) = self.connection_index.get(&connection_id).cloned() {
            if let Some(&scene_idx) = self.scenes_index.get(&start_scene_id) {
                if let Some(scene) = self.scenes.get_mut(scene_idx) {
                    if let Some(connection) = scene.connections.get_mut(conn_idx) {
                        connection.target_scene_id = new_target_id;
                        connection.position = Coordinates { x: new_position.0 as f32, y: new_position.1 as f32 };
                        if new_name.is_some() { connection.name = new_name.clone(); }
                        if new_icon_type.is_some() { connection.icon_index = new_icon_type; }
                        // Persist update in DB
                        if let Some(ref db) = self.db {
                            let _ = db.update_connection(
                                connection_id as i64,
                                Some(new_target_id as i64),
                                Some(new_position.0 as f32),
                                Some(new_position.1 as f32),
                                new_name.as_deref(),
                                new_icon_type,
                                new_file_path.as_deref()
                            ).await;
                            // If this connection represents a closeup and a new file path was provided,
                            // also update the underlying asset (stored in the assets table) so the
                            // closeup's asset file_path stays in sync with the connection's file_path.
                            if new_file_path.is_some() {
                                // Only attempt asset update for closeup-type connections
                                if let ConnectionType::Closeup = connection.connection_type {
                                    // target_scene_id stores the asset id for closeups
                                    let asset_id = connection.target_scene_id as i64;
                                    if asset_id != 0 {
                                        // Update the asset's file_path column as well
                                        let _ = db.update_scene(asset_id, None, new_file_path.as_deref(), None, None, None, None).await;
                                    }
                                }
                            }
                        }
                        true
                    } else { false }
                } else { false }
            } else { false }
        } else { false };

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
        connection_id: i32,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let found = if let Some((start_scene_id, conn_idx)) = self.connection_index.remove(&connection_id) {
            if let Some(&scene_idx) = self.scenes_index.get(&start_scene_id) {
                if let Some(scene) = self.scenes.get_mut(scene_idx) {
                    if conn_idx < scene.connections.len() {
                        scene.connections.remove(conn_idx);
                        // Reindex that scene's connections
                        self.rebuild_scene_connection_index(start_scene_id);
                        // Persist deletion in DB
                        if let Some(ref db) = self.db {
                            let _ = db.delete_connection(connection_id as i64).await;
                        }
                        true
                    } else { false }
                } else { false }
            } else { false }
        } else { false };

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
        scene_id: i32,
        position: (f32, f32),
        fov: Option<f32>,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.initial_view = Some(Coordinates { x: position.0, y: position.1 });
            print!("{:?}", position);

            // Update database if available
            if let Some(ref db) = self.db {
                if let Err(e) = db.update_scene(scene.id as i64, None, None, Some(position.0 as f32), Some(position.1 as f32), None, fov).await {
                        eprintln!("Failed to update scene initial view in database: {}", e);
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
        scene_id: i32,
        direction: f32,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            if let Some(scene) = self.scenes.iter_mut().find(|s| s.id == scene_id) {
            scene.north_direction = Some(direction);
            
            // Update database if available
            if let Some(ref db) = self.db {
                if let Err(e) = db.update_scene(scene.id as i64, None, None, None, None, Some(direction), None).await {
                        eprintln!("Failed to update scene north direction in database: {}", e);
                    } else {
                        println!("North direction updated for scene '{}' in database", scene.name);
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
        _floorplan_id: i32,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Add a connection to a floorplan
    async fn add_floorplan_connection(
        &mut self,
        _scene_id: i32,
        tx: &mpsc::UnboundedSender<Message>
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement floorplan functionality
        let _ = tx.send(Message::Text(r#"{"type": "success", "message": "Floorplan functionality not yet implemented."}"#.to_string()));
        Ok(())
    }

    /// Delete a floorplan connection
    async fn delete_floorplan_connection(
        &mut self,
        _scene_id: i32,
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
        if let Ok(Some(tour_data)) = database.get_tour_with_scenes(&self.username, self.tour_id).await {
            println!("Loaded tour data from database for tour: {}", self.tour_id);
            
            // Parse the tour data and populate self.scenes from database format
            if let Some(scenes_array) = tour_data["scenes"].as_array() {
                self.scenes.clear(); // Clear any existing scenes
                
                for scene_json in scenes_array {
                    let scene_id = scene_json["id"].as_i64().unwrap_or(0) as i32;
                    let scene_name = scene_json["name"].as_str().unwrap_or("").to_string();
                    let file_path = scene_json["file_path"].as_str().unwrap_or("").to_string();
                    
                    // Parse connections
                    let mut connections = Vec::new();
                    if let Some(connections_array) = scene_json["connections"].as_array() {
                        for conn_json in connections_array {
                            if let Some(target_id) = conn_json["target_scene_id"].as_i64() {
                                let position = if let Some(pos_array) = conn_json["position"].as_array() {
                                    (
                                        pos_array[0].as_f64().unwrap_or(0.0),
                                        pos_array[1].as_f64().unwrap_or(0.0)
                                    )
                                } else {
                                    (0.0, 0.0)
                                };
                                let name = conn_json["name"].as_str().map(|s| s.to_string());
                                let ctype = conn_json["connection_type"].as_str().unwrap_or("Transition");
                                let icon_index = conn_json["icon_index"].as_i64().map(|v| v as i32);
                                
                                connections.push(Connection {
                                    id: conn_json["id"].as_i64().unwrap_or(0) as i32,
                                    connection_type: if ctype.eq_ignore_ascii_case("closeup") { ConnectionType::Closeup } else { ConnectionType::Transition },
                                    target_scene_id: target_id as i32,
                                    position: Coordinates {
                                        x: position.0 as f32,
                                        y: position.1 as f32
                                    },
                                    name,
                                    icon_index,
                                });
                            }
                        }
                    }
                    
                    // Parse initial view
                    let initial_view = if let (Some(x), Some(y)) = (
                        scene_json["initial_view_x"].as_i64(),
                        scene_json["initial_view_y"].as_i64()
                    ) {
                        Some(Coordinates { x: x as f32, y: y as f32 })
                    } else {
                        None
                    };
                    
                    // Parse north direction
                    let north_direction = scene_json["north_dir"].as_i64().map(|n| n as f32);
                    
                    let scene = Scene {
                        id: scene_id,
                        name: scene_name.clone(),
                        file_path,
                        connections,
                        initial_view,
                        north_direction,
                    };
                    
                    println!("Loaded scene from database: ID={}, name={}", scene_id, scene_name);
                    self.scenes.push(scene);
                }
                
                println!("Total scenes loaded: {}", self.scenes.len());
            }
        }
    // Build fast indices after loading
    self.rebuild_indices();
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

    // Collect fields (order is not guaranteed across all clients)
    let mut dest_subdir = String::from("insta360"); // default folder for scenes
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut orig_filename: Option<String> = None;

    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_string();
                println!("Processing field: {}", name);

                if name == "type" {
                    match field.text().await {
                        Ok(t) => {
                            let t = t.trim().to_lowercase();
                            println!("Upload type: {}", t);
                            // Only allow known subdirs
                            if t == "closeups" { dest_subdir = "closeups".to_string(); }
                            else { dest_subdir = "insta360".to_string(); }
                        }
                        Err(e) => {
                            eprintln!("Failed to read type field: {}", e);
                        }
                    }
                } else if name == "file" {
                    let filename = field.file_name().unwrap_or("uploaded_file").to_string();
                    println!("Uploading file: {}", filename);
                    match field.bytes().await {
                        Ok(data) => {
                            println!("File data read successfully, size: {} bytes", data.len());
                            file_bytes = Some(data.to_vec());
                            orig_filename = Some(filename);
                        }
                        Err(e) => {
                            eprintln!("Failed to read file data: Error parsing `multipart/form-data` request: {}", e);
                            return (StatusCode::BAD_REQUEST, format!("Failed to read file data: Error parsing `multipart/form-data` request: {}", e)).into_response();
                        }
                    }
                } else {
                    // Read and discard other fields to advance the stream
                    if let Err(e) = field.bytes().await { eprintln!("Error reading field '{}': {}", name, e); }
                }
            }
            Ok(None) => { break; }
            Err(e) => {
                eprintln!("Failed to get next field: Error parsing `multipart/form-data` request: {}", e);
                return (StatusCode::BAD_REQUEST, format!("Failed to read multipart data: {}", e)).into_response();
            }
        }
    }

    // After collecting fields, save if we have a file
    if let (Some(data), Some(filename)) = (file_bytes, orig_filename) {
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

        // Save under selected subdirectory
        let file_path = format!("assets/{}/{}", dest_subdir, new_filename);

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

    println!("No file field found in multipart request");
    (StatusCode::BAD_REQUEST, "No file uploaded").into_response()
}

// Derivative generation removed
