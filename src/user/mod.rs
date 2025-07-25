use super::*;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use warp::ws::Message;


// Define Player struct
#[derive(Clone)]
pub struct User {
    pub name: String,
    pub tx: mpsc::UnboundedSender<Message>,
    pub rx: Arc<Mutex<SplitStream<warp::ws::WebSocket>>>
}

impl User {
    pub async fn user_join_server(
        &mut self,
        server: Server
    ) -> i32 {
        let lobbies = server_lobby.lock().await.lobbies.lock().await.clone();
        
        for lobby in lobbies {
            // First try with a non-blocking lock
            if let Ok(mut lobby_guard) = lobby.try_lock() {
                if lobby_guard.name == lobby_name {
                    if spectate {
                        // Join as spectator
                        self.state = SPECTATOR;
                        lobby_guard.add_spectator(self.clone()).await;
                        self.lobby = lobby.clone();
                        return SUCCESS;
                    } else {
                        // Check if game is in progress
                        if lobby_guard.game_state >= START_OF_ROUND && 
                           lobby_guard.game_state <= END_OF_ROUND {
                            // Can't join as player during game
                            return FAILED;
                        }
                        
                        // Join as regular player
                        lobby_guard.add_player(self.clone()).await;
                        self.lobby = lobby.clone();
                        return SUCCESS;
                    }
                }
            }
        }
        FAILED
    }
}