use super::*;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use axum::extract::ws::{Message, WebSocket};


// Define User struct
#[derive(Clone)]
pub struct User {
    pub name: String,
    pub tx: mpsc::UnboundedSender<Message>,
    pub rx: Arc<Mutex<futures::stream::SplitStream<WebSocket>>>,
    pub tours_list: Vec<Tour>,
    pub session_token: Option<String>,
}

impl User {

}