//! # Poker Server
//! 
//! This module contains the main function for the Poker server.
//! 
//! The server is implemented using the `warp` web framework and provides a WebSocket
//! interface for clients to connect to. The server manages player registration, login,
//! and lobby creation, as well as game logic for playing Poker.
//! 
//! The server uses a SQLite database to store player information and statistics.
//! 
//! The server supports the following features:
//! - Player registration and login
//! - Lobby creation and joining
//! - Game setup and management
//! - Player statistics tracking
//! 
//! The server is designed to handle multiple concurrent clients and games, with each
//! client connecting via a WebSocket connection.
//! 
//! The server is implemented using asynchronous Rust with the `tokio` runtime.
//! 
//! # Usage
//! 
//! To start the server, run the following command:
//! 
//! ```bash
//! cargo run
//! ```
//! 
//! The server will start on `localhost:1112` and listen for incoming WebSocket connections.
//! 
//! Clients can connect to the server using a WebSocket client, such as `websocat` or a web browser.
//! 
//! # Dependencies
//! 
//! The server uses the following dependencies:
//! - `warp` for the web framework and WebSocket handling
//! - `sqlx` for the SQLite database interaction
//! - `uuid` for generating unique player IDs
//! - `tokio` for the asynchronous runtime
//! 
//! # Modules
//! 
//! The server is organized into the following modules:
//! - `database` - Database module for player registration, login, and statistics
//! - `deck` - Deck module for managing the deck of cards
//! - `lobby` - Lobby module for managing players and lobbies
mod database;
mod editor;
mod tour;
mod user;

use futures_util::stream::SplitStream;
use futures_util::{StreamExt, SinkExt};
use warp::Filter;
use warp::ws::{Message, WebSocket};
use std::sync::Arc;
use sqlx::SqlitePool;
use uuid::Uuid;
use tokio::sync::{mpsc, Mutex};

use database::Database;
// use editor::Editor;
use tour::Tour;
use user::User;

use serde::Deserialize;
use serde_json::Result as JsonResult;

#[derive(Deserialize)]
#[serde(tag = "action", content = "data")]
enum ClientMessage {
    Disconnect,
    Login { username: String, password: String },
    Register { username: String, password: String },
    Logout,
    Help,
    ShowTours,

    CreateTour { name: String },
    EditTour { tour_id: String },
    ViewTour { tour_id: String },
    DeleteTour { tour_id: String },
    
    AddScene { name: String, file_path: String },
    SwapScene { scene_id: String, new_file_path: String },
    DeleteScene { scene_id: String },
    AddCloseup { name: String, file_path: String, parent_scene_id: String, position: (i8, i8), description: String},
    AddConnection { start_scene_id: String, asset_id: String, position: (i8, i8) },
    EditConnection { connection_id: String, new_asset_id: String, new_position: (i8, i8) },
    DeleteConnection { connection_id: String },

    SetInitialView { scene_id: String, position: (i8, i8) },
    SetNorthDirection { scene_id: String, direction: i8 },

    AddFloorplan { file_path: String },
    DeleteFloorplan { floorplan_id: String },
    AddFloorplanConnection { scene_id: String },
    DeleteFloorplanConnection { scene_id: String },
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let db_pool = initialize_db().await;
    let database = Arc::new(Database::new(db_pool.clone()));

    // WebSocket route
    let ws_route = warp::path("connect")
        .and(warp::ws())
        .and(with_db(database.clone()))
        .map(|ws: warp::ws::Ws, db | {
            ws.on_upgrade(move |socket| handle_connection(socket, db))
        });

    let index_route = warp::path::end()
        .map(|| warp::reply::html(include_str!("../static/index.html")));

    // This should be in your main.rs where you define routes
    let login_route = warp::path("login")
        .map(|| warp::reply::html(include_str!("../static/login.html")));

    let homepage = warp::path("homepage")
        .map(|| warp::reply::html(include_str!("../static/homepage.html")));

    let editor = warp::path("editor")
        .map(|| warp::reply::html(include_str!("../static/editor.html")));

    // Combine routes
    let routes = ws_route
        .or(index_route)
        .or(login_route)
        .or(homepage)
        .or(editor)
        .with(warp::cors()
            .allow_any_origin()
            .allow_headers(vec!["content-type"])
            .allow_methods(vec!["GET", "POST"]));
    println!("Server starting on http://localhost:1112");
    
    warp::serve(routes)
        .run(([0, 0, 0, 0], 1112))
        .await;
    Ok(())
}

async fn initialize_db() -> SqlitePool {
    use std::path::Path;
    use std::fs;
    
    let db_path = "tours.db";
    let schema_sql = include_str!("./schema.sql");
    
    // Check if database file exists
    let db_exists = Path::new(db_path).exists();
    
    if !db_exists {
        println!("Database file not found. Creating new database.");
        
        // Create empty file to ensure permissions are correct
        let file = fs::File::create(db_path).expect("Failed to create database file");
        file.sync_all().expect("Failed to sync database file");
        println!("Empty database file created successfully.");
    }
    
    // Connect to SQLite database with proper connection string
    println!("Connecting to database at {}", db_path);
    let db_pool = SqlitePool::connect(&format!("sqlite:{}", db_path))
        .await
        .expect("Failed to connect to database");
    
    // If database didn't exist, initialize it with schema
    if !db_exists {
        println!("Initializing database with schema.");
        match sqlx::query(schema_sql).execute(&db_pool).await {
            Ok(_) => println!("Database schema created successfully."),
            Err(e) => eprintln!("Error creating schema: {}", e),
        }
    }
    
    println!("Database connection established successfully.");
    db_pool
}

fn with_db(
    db: Arc<Database>
) -> impl Filter<Extract = (Arc<Database>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || db.clone())
}

/// Retrieves the names and statuses of all lobbies from the server.
/// 
/// This function locks the `server_lobby` asynchronously, then calls 
/// `get_lobby_names_and_status` to obtain a list of lobby names and their 
/// corresponding statuses.
/// 
/// # Returns
/// 
/// A list of tuples where each tuple contains the name of a lobby and its status.
async fn get_tours_json(db: Arc<Database>) -> String {
    let tours = db.get_tours().await;
    let mut tour_list = Vec::new();

    for tour in tours {
        tour_list.push(serde_json::json!({
            "id": tour.id,
            "name": tour.name,
            "createdAt": tour.created_at,
            "modifiedAt": tour.modified_at,
            "initialSceneId": tour.initial_scene_id,
            "location": tour.location,
            "hasFloorplan": tour.has_floorplan,
            "floorplanId": tour.floorplan_id
        }));
    }

    serde_json::json!({
        "tours": tour_list
    }).to_string()
}

        let status = if lobby_status == server::JOINABLE {
            "Joinable"
        } else {
            "Not Joinable"
        };
        
        // Convert game type to readable string
        let game_type = match lobby_type {
            server::FIVE_CARD_DRAW => "5 Card Draw",
            server::SEVEN_CARD_STUD => "7 Card Stud", 
            server::TEXAS_HOLD_EM => "Texas Hold'em",
            _ => "Unknown"
        };
        
        lobby_list.push(serde_json::json!({
            "name": lobby_name,
            "status": status,
            "type": game_type,
            "playerCount": player_count,
            "maxPlayers": max_player_count
        }));
    }
    
    serde_json::json!({
        "lobbies": lobby_list
    }).to_string()
}

/// Handles a new WebSocket connection.
/// 
/// This function is called for each new WebSocket connection and is responsible for
/// processing the player's input and sending messages back to the client.
/// 
/// # Arguments
/// 
/// * `ws` - The WebSocket connection.
/// * `db` - The database connection pool.
/// * `server_lobby` - The server lobby containing all players and lobbies.
/// 
/// # Returns
/// 
/// This function does not return a value, but it sends messages to the client
/// via the WebSocket connection.
async fn handle_connection(ws: WebSocket, db: Arc<Database>) {
    // Split websocket into tx/rx and create a channel to forward messages
    let (mut ws_tx, ws_rx) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    
    // Forward messages from our channel to the websocket
    tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let _ = ws_tx.send(message).await;
        }
    });
    
    let curr_user = User {
        name: "".to_string(),
        tx: tx.clone(),
        rx: Arc::new(Mutex::new(ws_rx))
    };

    // Send initial welcome message
    tx.send(Message::text(r#"{"message": "Welcome to Virtual Tour Editor!"}"#)).unwrap();

    // Handle login phase
    let logged_in_user: Option<_> = handle_login_phase(curr_user, db.clone()).await;
    
    // If login was successful, proceed to server lobby
    if let Some(user) = logged_in_user {
        println!("User logged in successfully.");
        handle_client(user.clone(), db.clone()).await;

        // Logout user when they disconnect
        let _ = db.logout_user(&user.name).await;
    }
    
    println!("Connection closed");
}

// New helper function to handle login phase
async fn handle_login_phase(mut user: User, db: Arc<Database>) -> Option<User> {
    let tx = user.tx.clone();
    
    while let Some(result) = user.rx.lock().await.next().await {
        if let Ok(msg) = result {
            if let Ok(text) = msg.to_str() {
                // Parse incoming message
                let client_msg: JsonResult<ClientMessage> = serde_json::from_str(text);
                match client_msg {
                    Ok(ClientMessage::Login { username, password }) => {
                        // Attempt login
                        if let Ok(Some(_username)) = db.authenticate_user(&username, &password).await {
                            tx.send(Message::text(
                                format!(r#"{{"message": "Welcome back, {}!", "redirect": "homepage"}}"#, username)
                            )).unwrap();
                            // Update user data
                            user.name = username.clone();
                            return Some(user.clone());
                        } else {
                            // Login failed, could be because user is already logged in
                            tx.send(Message::text(r#"{"message": "Login failed. Invalid username or password."}"#)).unwrap();
                        }
                    }
                    Ok(ClientMessage::Register { username, password }) => {
                        // Attempt registration
                        if db.register_user(&username, &password).await.is_ok() {
                            tx.send(Message::text(
                                format!(r#"{{"message": "Registration successful! Welcome, {}!", "redirect": "homepage"}}"#, username)
                            )).unwrap();
                            // Update player data
                            user.name = username.clone();
                            return Some(user.clone());
                        } else {
                            tx.send(Message::text(r#"{"message": "Registration failed. Try again."}"#)).unwrap();
                        }
                    }
                    Ok(ClientMessage::Quit) => {
                        tx.send(Message::text(r#"{"message": "Goodbye!", "redirect": "index"}"#)).unwrap();
                        return None;
                    }
                    _ => continue,
                }
            }
        }
    }
    
    None
}

/// Handles player interaction while in the server lobby.
/// 
/// This function processes messages received from the client when they are in the server lobby,
/// such as creating or joining game lobbies, viewing available lobbies, etc.
/// 
/// # Arguments
/// 
/// * `player` - The current player.
/// * `server_lobby` - The server lobby containing all players and lobbies.
/// * `db` - The database connection pool.
async fn handle_client(user: User, db: Arc<Database>) {
    let player_name = user.name.clone();
    let tx = user.tx.clone();

    // At this point, the client is successfully logged in and has been redirected to the server lobby
    loop {
        let result = {
            let mut rx = player.rx.lock().await;
            match rx.next().await {
                Some(res) => res,
                None => continue,
            }
        };

        if let Ok(msg) = result {
            if let Ok(text) = msg.to_str() {
                // Parse incoming JSON message
                let client_msg: JsonResult<ClientMessage> = serde_json::from_str(text);
                match client_msg {
                    Ok(ClientMessage::Disconnect) => {
                        server_lobby.lock().await.remove_player(player_name.clone()).await;
                        server_lobby.lock().await.broadcast_player_count().await;
                        break;
                    }
                    Ok(ClientMessage::ShowPlayers) => {
                        // Show players in the lobby
                        let player_count = server_lobby.lock().await.get_player_count().await;
                        let msg = serde_json::json!({
                            "playerCount": player_count
                        });
                        tx.send(Message::text(msg.to_string())).unwrap();
                    }
                    Ok(ClientMessage::ShowLobbies) => {
                        // Get and send lobby information
                        let lobbies_json = get_lobbies_json(server_lobby.clone()).await;
                        tx.send(Message::text(lobbies_json)).unwrap();
                    }
                    Ok(ClientMessage::CreateLobby { lobby_name, game_type }) => {
                        // Create a new lobby
                        if server_lobby.lock().await.lobby_exists(lobby_name.clone()).await {
                            tx.send(Message::text(r#"{"error": "Lobby name already exists"}"#)).unwrap();
                        } else {
                            // Create a new lobby with the specified name and game type
                            let new_lobby = Arc::new(Mutex::new(Lobby::new(game_type, lobby_name.clone()).await));
                            
                            // Add the new lobby to the server
                            server_lobby.lock().await.add_lobby(new_lobby).await;
                            
                            // Send success message
                            tx.send(Message::text(format!(r#"{{"message": "Lobby '{}' created successfully"}}"#, lobby_name))).unwrap();
                        }
                    }
                    Ok(ClientMessage::JoinLobby { lobby_name, spectate }) => {
                        // Get the player object from server_lobby before joining game lobby
                        let player_obj = server_lobby.lock().await.get_player_by_name(&player_name).await;
                        
                        if let Some(mut player_obj) = player_obj {
                            let join_result = player_obj.player_join_lobby(server_lobby.clone(), lobby_name.clone(), spectate).await;
                            server_lobby.lock().await.update_lobby_names_status(lobby_name.clone()).await;
                            
                            if join_result == server::SUCCESS {
                                let player_lobby_type = player_obj.lobby.lock().await.game_type.clone();
                                // Successfully joined the lobby
                                println!("successful joining");
                                tx.send(Message::text(
                                    format!(r#"{{"message": "Successfully joined lobby: {}!", "redirect": "lobby"}}"#, lobby_name.clone())
                                )).unwrap();
                                let result;
                                if spectate {
                                    result = join_as_spectator(server_lobby.clone(), player_obj.clone(), db.clone()).await;
                                } else {
                                    match player_lobby_type {
                                        server::FIVE_CARD_DRAW => {
                                            result = editor::five_card_game_state_machine(server_lobby.clone(), player_obj, db.clone()).await;
                                        }
                                        server::SEVEN_CARD_STUD => {
                                            // result = join_lobby(server_lobby.clone(), player_obj, db.clone()).await;
                                            result = editor::seven_card_game_state_machine(server_lobby.clone(), player_obj, db.clone()).await;
                                        }
                                        server::TEXAS_HOLD_EM => {
                                            result = editor::texas_holdem_game_state_machine(server_lobby.clone(), player_obj, db.clone()).await;
                                        }
                                        _ => {
                                            continue;
                                        }
                                    }
                                }
                                if result == "Disconnect" {
                                    /*
                                    Use here to do more actions when the player disconnects from server if needed
                                     */
                                    let _ = db.logout_player(&player_name).await;

                                    break;
                                }
                                
                                server_lobby.lock().await.broadcast_lobbies(Some(tx.clone())).await;
                            } else {
                                // Failed to join lobby
                                let message = if spectate {
                                    "Failed to join lobby as spectator."
                                } else {
                                    "Failed to join lobby. The lobby may be full or not joinable."
                                };
                                tx.send(Message::text(format!(r#"{{"message": "{}"}}"#, message))).unwrap();
                            }
                        }
                    }
                    Ok(ClientMessage::ShowStats) => {
                        // Get player stats from database
                        let stats = db.player_stats(&player_name).await;
                        
                        if let Ok(stats) = stats {
                            println!("Retrieved stats for {}: {:?}", player_name, stats);
                            // Format stats as JSON and send to client
                            let stats_json = serde_json::json!({
                                "stats": {
                                    "username": stats.name,
                                    "gamesPlayed": stats.games_played,
                                    "gamesWon": stats.games_won,
                                    "wallet": stats.wallet,
                                    "winRate": if stats.games_played > 0 {
                                        format!("{}%", (stats.games_won as f64 / stats.games_played as f64) * 100.0)
                                    } else {
                                        "N/A".to_string()
                                    }
                                }
                            });
                            tx.send(Message::text(stats_json.to_string())).unwrap();
                        } else {
                            println!("Error retrieving stats for {}: {:?}", player_name, stats);
                            tx.send(Message::text(r#"{"error": "Failed to retrieve stats"}"#)).unwrap();
                        }
                    }
                    _ => {
                        // For unsupported actions: disregard
                        continue;
                    }
                }
            }
        }
    }
}

/// Handles a player joining as a spectator.
/// 
/// This function is called when a player joins a lobby as a spectator and is responsible for processing
/// the player's input and sending messages back to the client.
/// 
/// # Arguments
/// 
/// * `server_lobby` - The server lobby containing all players and lobbies.
/// * `player` - The player joining as a spectator.
/// * `db` - The database connection pool.
/// 
/// # Returns
/// 
/// This function returns a `String` indicating the exit status of the player.
async fn join_as_spectator(server_lobby: Arc<Mutex<Lobby>>, player: Player, db: Arc<Database>) -> String {
    let player_name = player.name.clone();
    let player_lobby = player.lobby.clone();
    let tx = player.tx.clone();
    
    println!("{} is spectating lobby: {}", player_name, player_lobby.lock().await.name);
    
    // Send message about spectating
    tx.send(Message::text(format!(
        r#"{{"message": "You are spectating lobby: {}. You can only observe until the game is over."}}"#,
        player_lobby.lock().await.name
    ))).unwrap();

    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    player_lobby.lock().await.send_lobby_info().await;
    player_lobby.lock().await.send_player_list().await;
    
    // Loop to handle spectator messages
    loop {
        let result = {
            let mut rx = player.rx.lock().await;
            match rx.next().await {
                Some(res) => res,
                None => continue,
            }
        };
        
        if let Ok(msg) = result {
            if let Ok(text) = msg.to_str() {
                // Parse incoming message
                let client_msg: JsonResult<ClientMessage> = serde_json::from_str(text);
                
                let lobby_name = player_lobby.lock().await.name.clone();
                
                match client_msg {
                    Ok(ClientMessage::Quit) => {
                        // Remove spectator from lobby
                        player_lobby.lock().await.remove_spectator(player_name.clone()).await;
                        
                        // Send redirect back to server lobby
                        tx.send(Message::text(r#"{"message": "Left spectator mode", "redirect": "server_lobby"}"#)).unwrap();
                        return "Normal".to_string();
                    }
                    Ok(ClientMessage::Disconnect) => {
                        // Handle disconnection
                        player_lobby.lock().await.remove_spectator(player_name.clone()).await;
                        return "Disconnect".to_string();
                    }
                    Ok(ClientMessage::ShowStats) => {
                        // Get player stats from database
                        let stats = db.player_stats(&player_name).await;
                        
                        if let Ok(stats) = stats {
                            println!("Retrieved stats for {}: {:?}", player_name, stats);
                            // Format stats as JSON and send to client
                            let stats_json = serde_json::json!({
                                "stats": {
                                    "username": stats.name,
                                    "gamesPlayed": stats.games_played,
                                    "gamesWon": stats.games_won,
                                    "wallet": stats.wallet,
                                    "winRate": if stats.games_played > 0 {
                                        format!("{}%", (stats.games_won as f64 / stats.games_played as f64) * 100.0)
                                    } else {
                                        "N/A".to_string()
                                    }
                                }
                            });
                            tx.send(Message::text(stats_json.to_string())).unwrap();
                        } else {
                            println!("Error retrieving stats for {}: {:?}", player_name, stats);
                            tx.send(Message::text(r#"{"error": "Failed to retrieve stats"}"#)).unwrap();
                        }
                    }
                    _ => {
                        // Send message that spectators have limited options
                        continue;
                    }
                }
            }
        }
    }
}
