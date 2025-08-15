//! # Virtual Tour Editor Server
//! 
//! This module contains the main function for the Virtual Tour Editor server.
//! 
//! The server is implemented using the `axum` web framework and provides a WebSocket
//! interface for clients to connect to. The server manages user registration, login,
//! and tour creation/management.

mod database;
mod editor;
mod tour;
mod config;
mod user;

use tour::Tour;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State, Path, DefaultBodyLimit,
    },
    response::{Html, IntoResponse},
    Json,
    routing::{get, post, delete},
    Router,
    http::{StatusCode, HeaderValue},
};
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
};
use std::sync::Arc;
use std::collections::HashMap;
use sqlx::SqlitePool;
use tokio::sync::{mpsc, RwLock, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use serde::Deserialize;
use futures::{StreamExt, SinkExt};

use database::Database;
use user::User;

// Global connection counter
static ACTIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);

// Lazy database instance
static DATABASE: RwLock<Option<Arc<Database>>> = RwLock::const_new(None);

// Global editor sessions store - key format: "username_tourid"
static EDITOR_SESSIONS: RwLock<Option<HashMap<String, editor::EditorState>>> = RwLock::const_new(None);

#[derive(Clone)]
pub struct AppState {
    pub database: Arc<Database>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct CreateTourRequest {
    name: String,
    location: String,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "action", content = "data")]
enum ClientMessage {
    Disconnect,
    Login { username: String, password: String },
    Register { username: String, password: String },
    RestoreSession { username: String, session_token: String, redirect: String },
    Heartbeat,
    Quit,
    Logout,
    Help,
    ShowTours,
    CreateTour { name: String, location: String },
    EditTour { tour_id: i32, editor_action: Option<editor::EditorAction> },
    DeleteTour { tour_id: i32 },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load configuration
    let config = config::Config::load().unwrap_or_else(|e| {
        eprintln!("Failed to load configuration: {}. Using defaults.", e);
        config::Config::default()
    });

    println!("Starting {} v{}", config.app.name, config.app.version);
    println!("Server configuration: {}", config.server_address());
    println!("Database will be initialized when first client connects");

    // Get database instance
    let database = get_database().await;
    let app_state = AppState { database };

    // Start periodic session cleanup task
    let cleanup_db = app_state.database.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300)); // Every 5 minutes
        loop {
            interval.tick().await;
            
            // Clean up old sessions
            if let Err(e) = cleanup_db.cleanup_old_sessions().await {
                eprintln!("Failed to cleanup old sessions: {}", e);
            } else {
                println!("Periodic session cleanup completed");
            }
        }
    });

    // Build the application with routes
    let app = Router::new()
        // WebSocket route
        .route("/connect", get(websocket_handler))
        // API routes
        .route("/api/login", post(login_handler))
        .route("/api/register", post(register_handler))
        .route("/api/tours", get(get_tours_handler))
        .route("/api/tours", post(create_tour_handler))
        .route("/api/tours/:id", delete(delete_tour_handler))
        // Upload route
        .route("/upload-asset", post(editor::upload_asset_handler))
        // Assets list route  
        .route("/api/assets", get(list_assets_handler))
        // Static HTML pages
        .route("/", get(index_page))
        .route("/login", get(login_page))
        .route("/homepage", get(homepage))
        .route("/editor", get(editor_page))
        // Static file serving with caching headers for better performance
        .nest_service("/static", 
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL, 
                    HeaderValue::from_static("public, max-age=86400") // Cache for 24 hours
                ))
                .service(ServeDir::new("static"))
        )
        .nest_service("/assets", 
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL, 
                    HeaderValue::from_static("public, max-age=3600") // Cache assets for 1 hour
                ))
                .service(ServeDir::new("assets"))
        )
        .layer(
            ServiceBuilder::new()
                .layer(DefaultBodyLimit::max(120 * 1024 * 1024)) // 100MB limit
                .layer(CorsLayer::permissive())
        )
        .with_state(app_state);

    println!("Server starting on http://{}:{}", config.server.host, config.server.port);
    
    // Parse host address for server binding
    let host: std::net::IpAddr = config.server.host.parse()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)));
    
    let listener = tokio::net::TcpListener::bind((host, config.server.port)).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}

async fn initialize_db() -> SqlitePool {
    use std::path::Path;
    use std::fs;
    use sqlx::sqlite::SqlitePoolOptions;
    
    let db_path = "tours.db";
    let schema_sql = include_str!("./schema.sql");
    
    // Create database file if it doesn't exist
    if !Path::new(db_path).exists() {
        fs::File::create(db_path).expect("Failed to create database file");
        println!("Created new database file: {}", db_path);
    }
    
    // Create connection pool
    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&format!("sqlite:{}", db_path))
        .await
        .expect("Failed to create database pool");
    
    // Execute schema to create tables
    sqlx::raw_sql(schema_sql)
        .execute(&pool)
        .await
        .expect("Failed to execute schema");

    // No legacy migration needed: fresh DBs only; world_lon/world_lat are part of schema
    
    println!("Database initialized successfully");
    pool
}

// Get or initialize the database connection lazily
async fn get_database() -> Arc<Database> {
    let db_read = DATABASE.read().await;
    if let Some(ref db) = *db_read {
        return db.clone();
    }
    drop(db_read);
    
    // Initialize database
    let pool = initialize_db().await;
    let database = Arc::new(Database::new(pool));
    
    // Store in global
    let mut db_write = DATABASE.write().await;
    *db_write = Some(database.clone());
    drop(db_write);
    
    database
}

// Get or create an editor session for a user+tour combination
async fn get_or_create_editor_session(
    username: &str,
    tour_id: i64,
    db: &Arc<Database>
) -> Result<editor::EditorState, Box<dyn std::error::Error + Send + Sync>> {
    let session_key = format!("{}_{}", username, tour_id);
    
    // First, try to get existing session
    {
        let sessions_read = EDITOR_SESSIONS.read().await;
        if let Some(ref sessions) = *sessions_read {
            if let Some(editor_state) = sessions.get(&session_key) {
                println!("Reusing existing editor session for {}", session_key);
                return Ok(editor_state.clone());
            }
        }
    }
    
    // Create new session if it doesn't exist
    println!("Creating new editor session for {}", session_key);
    let mut editor_state = editor::EditorState::new(tour_id, username.to_string(), Some((**db).clone()));
    editor_state.load_from_database(db).await?;
    
    // Store in global sessions
    let mut sessions_write = EDITOR_SESSIONS.write().await;
    if sessions_write.is_none() {
        *sessions_write = Some(HashMap::new());
    }
    if let Some(ref mut sessions) = *sessions_write {
        sessions.insert(session_key, editor_state.clone());
    }
    
    Ok(editor_state)
}

// Update an existing editor session
async fn update_editor_session(
    username: &str,
    tour_id: i64,
    editor_state: editor::EditorState
) {
    let session_key = format!("{}_{}", username, tour_id);
    
    let mut sessions_write = EDITOR_SESSIONS.write().await;
    if sessions_write.is_none() {
        *sessions_write = Some(HashMap::new());
    }
    if let Some(ref mut sessions) = *sessions_write {
        sessions.insert(session_key, editor_state);
    }
}

// Clean up editor sessions for a user (called on logout/disconnect)
async fn cleanup_user_editor_sessions(username: &str) {
    let mut sessions_write = EDITOR_SESSIONS.write().await;
    if let Some(ref mut sessions) = *sessions_write {
        sessions.retain(|key, _| !key.starts_with(&format!("{}_", username)));
    }
}

// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_websocket(socket, state))
}

async fn handle_websocket(socket: WebSocket, state: AppState) {
    // Increment connection counter
    let connection_count = ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed) + 1;
    println!("New client connected. Active connections: {}", connection_count);
    
    let (sender, receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    
    // Forward messages from our channel to the websocket
    let send_task = tokio::spawn(async move {
        let mut sender = sender;
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });
    
    let curr_user = User {
        name: "".to_string(),
        tx: tx.clone(),
        rx: Arc::new(Mutex::new(receiver)),
        tours_list: Vec::new(),
        session_token: None,
    };

    // Send initial welcome message
    let _ = tx.send(Message::Text(r#"{"message": "Welcome to Virtual Tour Editor!"}"#.to_string()));
    
    loop {
        // Handle login phase
        println!("Waiting for user to log in...");
        let logged_in_user = handle_login_phase(curr_user.clone(), state.database.clone()).await;
        
        // If login was successful, proceed to main client handling
        if let Some(user) = logged_in_user {
            println!("User logged in successfully.");
            // handle_client returns: true = disconnect, false = logout (back to login)
            if handle_client(user.clone(), state.database.clone()).await {
                break; // Disconnect
            }
            // If false, continue loop to go back to login phase
        } else {
            println!("User login failed or disconnected.");
            break;
        }
    }

    let _ = state.database.cleanup_old_sessions().await;
    println!("Cleaned up session on connection close");

    // Clean up editor sessions for the disconnected user
    if !curr_user.name.is_empty() {
        cleanup_user_editor_sessions(&curr_user.name).await;
        println!("Cleaned up editor sessions for user: {}", curr_user.name);
    }

    // Decrement connection counter and cleanup if needed
    let remaining_connections = ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed) - 1;
    println!("Client disconnected. Active connections: {}", remaining_connections);
    
    send_task.abort();
}

// Login phase handler
async fn handle_login_phase(mut user: User, db: Arc<Database>) -> Option<User> {
    let tx = user.tx.clone();
    
    while let Some(result) = user.rx.lock().await.next().await {
        if let Ok(msg) = result {
            if let Message::Text(text) = msg {
                // Parse incoming message
                println!("Received message: {}", text);
                let client_msg: Result<ClientMessage, serde_json::Error> = serde_json::from_str(&text);
                println!("Received message: {:?}", client_msg);
                match client_msg {
                    Ok(ClientMessage::Login { username, password }) => {
                        // Attempt login
                        if let Ok(Some(_username)) = db.authenticate_user(&username, &password).await {
                            // Generate session token
                            match db.login_user(&username).await {
                                Ok(session_token) => {
                                    let _ = tx.send(Message::Text(
                                        format!(r#"{{"message": "Welcome back, {}!", "redirect": "homepage", "sessionToken": "{}", "username": "{}"}}"#, username, session_token, username)
                                    ));
                                    // Update user data
                                    user.name = username.clone();
                                    user.session_token = Some(session_token);
                                    return Some(user.clone());
                                }
                                Err(e) => {
                                    eprintln!("Failed to generate session token: {}", e);
                                    let _ = tx.send(Message::Text(r#"{"message": "Login failed. Server error."}"#.to_string()));
                                }
                            }
                        } else {
                            let _ = tx.send(Message::Text(r#"{"message": "Login failed. Invalid username or password."}"#.to_string()));
                        }
                    }
                    Ok(ClientMessage::Register { username, password }) => {
                        match db.register_user(&username, &password).await {
                            Ok(_) => {
                                let _ = tx.send(Message::Text(
                                    format!(r#"{{"message": "Registration successful! Welcome, {}!", "redirect": "login"}}"#, username)
                                ));
                            }
                            Err(e) => {
                                eprintln!("Registration failed: {}", e);
                                let _ = tx.send(Message::Text(r#"{"message": "Registration failed. Username might already be taken."}"#.to_string()));
                            }
                        }
                    }
                    Ok(ClientMessage::RestoreSession { username, session_token, redirect }) => {
                        match db.validate_session(&username, &session_token).await {
                            Ok(true) => {
                                // Only send redirect if user needs to be redirected to a different page
                                let response = if redirect == "homepage" || redirect == "editor" {
                                    format!(r#"{{"message": "Session restored successfully!", "sessionRestored": true, "username": "{}"}}"#, username)
                                } else {
                                    format!(r#"{{"message": "Session restored successfully!", "sessionRestored": true, "username": "{}", "redirect": "homepage"}}"#, username)
                                };
                                let _ = tx.send(Message::Text(response));
                                user.name = username.clone();
                                user.session_token = Some(session_token);
                                return Some(user.clone());
                            }
                            Ok(false) => {
                                let _ = tx.send(Message::Text(r#"{"message": "Session expired. Please log in again.", "redirect": "login"}"#.to_string()));
                            }
                            Err(_) => {
                                let _ = tx.send(Message::Text(r#"{"message": "Session validation failed. Please log in again.", "redirect": "login"}"#.to_string()));
                            }
                        }
                    }
                    Ok(ClientMessage::Disconnect) | Ok(ClientMessage::Quit) => {
                        return None;
                    }
                    Ok(ClientMessage::Heartbeat) => {
                        // Ignore heartbeat during login phase
                    }
                    _ => {
                        let _ = tx.send(Message::Text(r#"{"message": "Please log in first."}"#.to_string()));
                    }
                }
            }
        } else {
            // Connection error
            return None;
        }
    }
    
    None
}

// Main client handler after login
// Returns: true = disconnect, false = logout (go back to login phase)
async fn handle_client(user: User, db: Arc<Database>) -> bool {
    let tx = user.tx.clone();
    
    // Send tours list on login
    let tours_json = get_tours_json(db.clone(), user.name.clone()).await;
    let _ = tx.send(Message::Text(tours_json));
    
    while let Some(result) = user.rx.lock().await.next().await {
        if let Ok(msg) = result {
            if let Message::Text(text) = msg {
                println!("Received message: {}", text);
                let client_msg: Result<ClientMessage, serde_json::Error> = serde_json::from_str(&text);
                println!("Parsed message: {:?}", client_msg);
                match client_msg {
                    Ok(ClientMessage::ShowTours) => {
                        let tours_json = get_tours_json(db.clone(), user.name.clone()).await;
                        let _ = tx.send(Message::Text(tours_json));
                    }
                    Ok(ClientMessage::CreateTour { name, location }) => {
                        match db.create_tour(&user.name, &name, &location).await {
                            Ok(tour_id) => {
                                let _ = tx.send(Message::Text(
                                    format!(r#"{{"message": "Tour '{}' created successfully!", "tour_id": {}}}"#, name, tour_id)
                                ));
                                // Send updated tours list
                                let tours_json = get_tours_json(db.clone(), user.name.clone()).await;
                                let _ = tx.send(Message::Text(tours_json));
                            }
                            Err(e) => {
                                eprintln!("Failed to create tour: {}", e);
                                let _ = tx.send(Message::Text(r#"{"message": "Failed to create tour. Server error."}"#.to_string()));
                            }
                        }
                    }
                    Ok(ClientMessage::DeleteTour { tour_id }) => {
                        let tour_id_i64 = tour_id as i64;
                        match db.delete_tour(&user.name, tour_id_i64).await {
                            Ok(true) => {
                                let _ = tx.send(Message::Text(r#"{"message": "Tour deleted successfully!"}"#.to_string()));
                                // Send updated tours list
                                let tours_json = get_tours_json(db.clone(), user.name.clone()).await;
                                let _ = tx.send(Message::Text(tours_json));
                            }
                            Ok(false) => {
                                let _ = tx.send(Message::Text(r#"{"message": "Tour not found or access denied."}"#.to_string()));
                            }
                            Err(e) => {
                                eprintln!("Failed to delete tour: {}", e);
                                let _ = tx.send(Message::Text(r#"{"message": "Failed to delete tour. Server error."}"#.to_string()));
                            }
                        }
                    }
                    Ok(ClientMessage::Logout) => {
                        let _ = db.logout_user(&user.name).await;
                        // Clean up editor sessions for the logging out user
                        cleanup_user_editor_sessions(&user.name).await;
                        let _ = tx.send(Message::Text(r#"{"message": "Logged out successfully.", "redirect": "login"}"#.to_string()));
                        return false; // Go back to login phase
                    }
                    Ok(ClientMessage::Disconnect) | Ok(ClientMessage::Quit) => {
                        return true; // Exit connection
                    }
                    Ok(ClientMessage::Heartbeat) => {
                        // Update session activity
                        if let Some(ref session_token) = user.session_token {
                            let _ = db.validate_session(&user.name, session_token).await;
                        }
                    }
                    Ok(ClientMessage::EditTour { tour_id, editor_action }) => {
                        let tour_id_i64 = tour_id as i64;
                        // Check if this is the initial tour load or an editor action
                        match editor_action {
                            None => {
                                // Initial tour load - return tour data and start editor session
                                match db.get_tour_with_scenes(&user.name, tour_id_i64).await {
                                    Ok(Some(tour_data)) => {
                                        let response = serde_json::json!({
                                            "type": "tour_data",
                                            "data": tour_data
                                        });
                                        let _ = tx.send(Message::Text(response.to_string()));
                                        
                                        // Initialize or get editor session
                                        match get_or_create_editor_session(&user.name, tour_id_i64, &db).await {
                                            Ok(editor_state) => {
                                                // Start editor session
                                                let response = serde_json::json!({
                                                    "type": "editor_ready",
                                                    "state": editor_state.to_json()
                                                });
                                                let _ = tx.send(Message::Text(response.to_string()));
                                            }
                                            Err(e) => {
                                                eprintln!("Failed to initialize editor session: {}", e);
                                                let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to initialize editor session."}"#.to_string()));
                                            }
                                        }
                                    }
                                    Ok(None) => {
                                        let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Tour not found or access denied."}"#.to_string()));
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to get tour data: {}", e);
                                        let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to load tour data."}"#.to_string()));
                                    }
                                }
                            }
                            Some(action) => {
                                // Handle editor action using session-based state
                                match get_or_create_editor_session(&user.name, tour_id_i64, &db).await {
                                    Ok(mut editor_state) => {
                                        match editor_state.handle_action(action, &tx).await {
                                            Ok(_) => {
                                                // Save changes to database and update session
                                                let _ = editor_state.save_to_database(&db).await;
                                                update_editor_session(&user.name, tour_id_i64, editor_state).await;
                                            }
                                            Err(e) => {
                                                eprintln!("Editor action failed: {}", e);
                                                let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Editor action failed."}"#.to_string()));
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to get/create editor session: {}", e);
                                        let _ = tx.send(Message::Text(r#"{"type": "error", "message": "Failed to initialize editor session."}"#.to_string()));
                                    }
                                }
                            }
                        }
                    }
                    _ => {
                        println!("reached end");
                        let _ = tx.send(Message::Text(r#"{"message": "Feature not implemented yet."}"#.to_string()));
                    }
                }
            }
        } else {
            // Connection error
            return true; // Disconnect
        }
    }
    
    false // Should not reach here, but return false to go back to login
}

async fn get_tours_json(db: Arc<Database>, username: String) -> String {
    let tours = db.get_tours(&username).await;
    let mut tour_list = Vec::new();

    if tours.is_err() {
        return serde_json::json!({
            "error": format!("Failed to retrieve tours: {:?}", tours.err())
        }).to_string();
    }

    for tour in tours.unwrap() {
        // Get the initial scene thumbnail - convert i32 to Option<i64>
        let initial_scene_id_opt = if tour.initial_scene_id > 0 {
            Some(tour.initial_scene_id as i64)
        } else {
            None
        };
        
        let initial_scene_thumbnail = db.get_initial_scene_thumbnail(tour.get_id() as i64, initial_scene_id_opt).await
            .unwrap_or(None);

        tour_list.push(serde_json::json!({
            "id": tour.get_id(),
            "name": tour.name,
            "created_at": tour.created_at,
            "modified_at": tour.modified_at,
            "initial_scene_id": tour.initial_scene_id,
            "initial_scene_thumbnail": initial_scene_thumbnail,
            "location": tour.location,
            "views": 0  // You can implement view tracking later
        }));
    }

    serde_json::json!({
        "tours": tour_list
    }).to_string()
}

// HTTP Route handlers
async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    match state.database.authenticate_user(&payload.username, &payload.password).await {
        Ok(Some(_)) => {
            match state.database.login_user(&payload.username).await {
                Ok(session_token) => Ok(Json(serde_json::json!({
                    "success": true,
                    "username": payload.username,
                    "session_token": session_token
                }))),
                Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        },
        Ok(None) => Err(StatusCode::UNAUTHORIZED),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    match state.database.register_user(&payload.username, &payload.password).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "User registered successfully"
        }))),
        Err(_) => Err(StatusCode::CONFLICT)
    }
}

async fn get_tours_handler(
    State(_state): State<AppState>,
    // TODO: Extract username from session/auth header
) -> Result<Json<Vec<Tour>>, StatusCode> {
    // For now, return empty array - you'll need to implement auth extraction
    Ok(Json(vec![]))
}

async fn create_tour_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTourRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: Extract username from session/auth header
    let username = "test_user"; // Placeholder
    
    match state.database.create_tour(username, &payload.name, &payload.location).await {
        Ok(tour_id) => Ok(Json(serde_json::json!({
            "success": true,
            "tour_id": tour_id
        }))),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

async fn delete_tour_handler(
    State(state): State<AppState>,
    Path(tour_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: Extract username from session/auth header
    let username = "test_user"; // Placeholder
    
    match state.database.delete_tour(username, tour_id).await {
        Ok(true) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "Tour deleted successfully"
        }))),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

// Assets list handler
async fn list_assets_handler() -> impl IntoResponse {
    use std::fs;
    
    let assets_dir = "assets/insta360";
    
    match fs::read_dir(assets_dir) {
        Ok(entries) => {
            let mut files = Vec::new();
            
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(file_name) = path.file_name() {
                            if let Some(file_name_str) = file_name.to_str() {
                                // Only include image files
                                if file_name_str.ends_with(".jpg") || 
                                   file_name_str.ends_with(".jpeg") || 
                                   file_name_str.ends_with(".png") {
                                    files.push(file_name_str.to_string());
                                }
                            }
                        }
                    }
                }
            }
            
            // Sort files for consistent ordering
            files.sort();
            
            Json(serde_json::json!({
                "success": true,
                "assets": files
            })).into_response()
        }
        Err(_) => {
            Json(serde_json::json!({
                "success": false,
                "message": "Could not read assets directory",
                "assets": []
            })).into_response()
        }
    }
}

// Static page handlers
async fn index_page() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

async fn login_page() -> Html<&'static str> {
    Html(include_str!("../static/login.html"))
}

async fn homepage() -> Html<&'static str> {
    Html(include_str!("../static/homepage.html"))
}

async fn editor_page() -> Html<&'static str> {
    Html(include_str!("../static/editor.html"))
}
