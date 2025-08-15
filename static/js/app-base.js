/**
 * Virtual Tour Editor - Shared Application Base
 * Common functionality for all pages (WebSocket, session management, navigation)
 */

/**
 * Base application class that handles WebSocket connections and session management
 * Used by all pages in the application
 */
class VirtualTourApp {
  constructor() {
    // WebSocket configuration
    this.wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    this.wsAddr = this.wsProtocol + window.location.hostname + ":1112/connect";
    
    // Connection state
    this.socket = null;
    this.reconnectInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
    this.isManualDisconnect = false;
    this.sessionRestoreFailures = 0;
    
    // User state
    this.isLoggedIn = false;
    this.currentUser = null;
    this.heartbeatInterval = null;
    
    // Navigation guard
    this.lastNavigationTime = 0;
    this.navigationCooldown = 1000; // 1 second cooldown
    
    this.init();
  }
  
  /**
   * Initialize the application
   */
  init() {
    this.setupEventListeners();
    this.connectWebSocket();
  }
  
  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Page lifecycle events
    window.addEventListener('beforeunload', () => this.handleBeforeUnload());
    
    // Visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
  }
  
  /**
   * Connect to WebSocket server
   */
  connectWebSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return; // Already connected
    }
    
    this.socket = new WebSocket(this.wsAddr);
    console.log("Attempting to connect to server...");
    
    this.socket.onopen = () => this.handleSocketOpen();
    this.socket.onmessage = (event) => this.handleSocketMessage(event);
    this.socket.onclose = (event) => this.handleSocketClose(event);
    this.socket.onerror = (error) => this.handleSocketError(error);
  }
  
  /**
   * Handle WebSocket connection open
   */
  handleSocketOpen() {
    console.log("WebSocket connected successfully");
    this.reconnectAttempts = 0;
    
    // Clear reconnect interval
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    // Small delay to ensure frontend is ready before attempting session restoration
    setTimeout(() => {
      this.attemptSessionRestore();
    }, 100);
  }
  
  /**
   * Attempt to restore user session
   */
  attemptSessionRestore() {
    const session = SessionManager.getSession();
    
    if (session.username && session.token) {
      console.log("Attempting to restore session for user:", session.username);
      console.log("Current page for restore:", this.getCurrentPageName());
      
      this.sendMessage({
        action: "RestoreSession",
        data: {
          username: session.username,
          session_token: session.token,
          redirect: this.getCurrentPageName()
        }
      });
    } else {
      console.log("No session to restore - no username or token found");
      // Reset failure counter since no session to restore
      this.sessionRestoreFailures = 0;
      
      // If not on login page and no session, redirect to login
      if (this.getCurrentPageName() !== 'login') {
        console.log("No session and not on login page - redirecting to login");
        this.navigate('login');
      }
    }
  }
  
  /**
   * Get current page name from URL
   */
  getCurrentPageName() {
    const path = window.location.pathname;
    if (path === '/login') return 'login';
    if (path === '/homepage') return 'homepage';
    if (path === '/editor') return 'editor';
    return 'login'; // default
  }
  
  /**
   * Handle WebSocket messages
   */
  handleSocketMessage(event) {
    // Dispatch custom event for page-specific handlers
    window.dispatchEvent(new CustomEvent('websocketMessage', {
      detail: event.data
    }));
    
    // Handle session-related messages
    try {
      const data = JSON.parse(event.data);
      this.processSessionData(data);
    } catch (e) {
      // Not JSON or doesn't contain session info, ignore
    }
  }
  
  /**
   * Process session-related data from server
   */
  processSessionData(data) {
    console.log("Processing session data:", data);
    
    if (data.sessionToken) {
      SessionManager.saveSession(data.username, data.sessionToken);
      this.isLoggedIn = true;
      this.currentUser = data.username;
      this.startHeartbeat();
    }
    
    if (data.sessionRestored) {
      console.log("Session restored successfully");
      this.isLoggedIn = true;
      this.currentUser = data.username;
      SessionManager.setUser(data.username);
      this.startHeartbeat();
    }
    
    // Handle logout message
    if (data.message && data.message.includes("Logged out")) {
      console.log("User logged out, clearing session");
      this.handleLogout();
    }
    
    if (data.redirect) {
      const currentPage = this.getCurrentPageName();
      console.log("Redirect requested:", data.redirect, "Current page:", currentPage);
      
      // If redirecting to login and we have a session, it means logout or invalid session
      if (data.redirect === 'login' && SessionManager.hasValidSession()) {
        console.log("Forced redirect to login - clearing invalid session");
        this.handleLogout();
      }
      
      if (data.redirect !== currentPage) {
        console.log("Navigating from", currentPage, "to", data.redirect);
        this.navigate(data.redirect);
      } else {
        console.log("Already on target page, no navigation needed");
      }
    }
  }
  
  /**
   * Handle WebSocket connection close
   */
  handleSocketClose(event) {
    console.log("WebSocket connection closed", event);
    console.log("Close code:", event.code, "Close reason:", event.reason);
    console.log("Was manual disconnect:", this.isManualDisconnect);
    
    // If connection closes immediately after restore attempt, token might be invalid
    if (this.reconnectAttempts === 0 && SessionManager.hasValidSession()) {
      console.log("Connection closed immediately after restore - checking for invalid session");
      // Give it one more try, but if it fails again, clear the session
      this.sessionRestoreFailures = (this.sessionRestoreFailures || 0) + 1;
      if (this.sessionRestoreFailures >= 3) {
        console.log("Multiple session restore failures - clearing invalid session");
        this.handleLogout();
        return;
      }
    }
    
    if (!this.isManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      console.log(`Attempting to reconnect... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      this.reconnectAttempts++;
      
      this.reconnectInterval = setTimeout(() => {
        this.connectWebSocket();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached. Please refresh the page.");
      this.showConnectionError();
    }
  }
  
  /**
   * Handle logout - clear session and reset state
   */
  handleLogout() {
    console.log("Handling logout - clearing session and state");
    
    // Clear session data
    SessionManager.clearSession();
    SessionManager.clearUserProfile();
    
    // Reset app state
    this.isLoggedIn = false;
    this.currentUser = null;
    this.sessionRestoreFailures = 0;
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    // If not already on login page, navigate there
    if (this.getCurrentPageName() !== 'login') {
      this.navigate('login');
    }
  }
  
  /**
   * Show connection error to user
   */
  showConnectionError() {
    // Create or update connection error message
    let errorDiv = document.getElementById('connection-error');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'connection-error';
      errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff4444;
        color: white;
        padding: 15px 25px;
        border-radius: 5px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 10000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(errorDiv);
    }
    errorDiv.textContent = "Connection lost. Please refresh the page to reconnect.";
  }
  
  /**
   * Handle WebSocket errors
   */
  handleSocketError(error) {
    console.error("WebSocket error:", error);
  }
  
  /**
   * Send message to server
   */
  sendMessage(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log("Sending message:", message);
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not open, attempting to reconnect...");
      console.log("Socket state:", this.socket ? this.socket.readyState : "null");
      this.connectWebSocket();
    }
  }
  
  /**
   * Start heartbeat to keep session active
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN && this.isLoggedIn) {
        this.sendMessage({ action: "Heartbeat" });
      }
    }, 45000); // 45 seconds
  }
  
  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  /**
   * Handle before unload event
   */
  handleBeforeUnload() {
    console.log("Page unloading, maintaining connection for potential reconnect");
    // Don't disconnect - let the server handle cleanup
  }
  
  /**
   * Handle visibility change (tab switching)
   */
  handleVisibilityChange() {
    if (document.hidden) {
      console.log("Page hidden, maintaining connection");
    } else {
      console.log("Page visible again");
      if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
        this.connectWebSocket();
      }
    }
  }
  
  /**
   * Navigate to a different page
   */
  navigate(page) {
    const validPages = ['login', 'homepage', 'editor'];
    if (!validPages.includes(page)) {
      console.error(`Invalid page: ${page}`);
      return;
    }
    
    // Navigation cooldown to prevent rapid successive calls
    const now = Date.now();
    if (now - this.lastNavigationTime < this.navigationCooldown) {
      console.log("Navigation cooldown active, ignoring request");
      return;
    }
    this.lastNavigationTime = now;
    
    console.log("Navigating to page:", page);
    SessionManager.setPage(page);
    
    // Use standard browser navigation
    window.location.href = `/${page}`;
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    this.isManualDisconnect = true;
    this.stopHeartbeat();
    
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

/**
 * Session Management Utility
 */
class SessionManager {
  static getSession() {
    return {
      username: localStorage.getItem('currentPlayerName'),
      token: localStorage.getItem('sessionToken')
    };
  }
  
  static saveSession(username, token) {
    localStorage.setItem('sessionToken', token);
    localStorage.setItem('currentPlayerName', username);
  }
  
  static clearSession() {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('currentPlayerName');
  }
  
  static hasValidSession() {
    const session = this.getSession();
    return !!(session.username && session.token);
  }
  
  static setUser(username) {
    localStorage.setItem('currentPlayerName', username);
  }
  
  static getPage() {
    return localStorage.getItem('sessionPage');
  }
  
  static setPage(page) {
    localStorage.setItem('sessionPage', page);
  }
  
  static setUserProfile(username, email = null, picture = null) {
    localStorage.setItem('currentUserName', username);
    if (email) localStorage.setItem('userEmail', email);
    if (picture) localStorage.setItem('userPicture', picture);
  }
  
  static getUserProfile() {
    return {
      username: localStorage.getItem('currentUserName'),
      email: localStorage.getItem('userEmail'),
      picture: localStorage.getItem('userPicture')
    };
  }
  
  static clearUserProfile() {
    localStorage.removeItem('currentUserName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userPicture');
  }
}

// Global navigation function
window.navigate = (page) => {
  if (window.app && window.app.navigate) {
    window.app.navigate(page);
  } else {
    // Fallback direct navigation
    window.location.href = `/${page}`;
  }
};

// Global send message function
window.sendToServer = (data) => {
  if (window.app && window.app.sendMessage) {
    window.app.sendMessage(typeof data === 'string' ? JSON.parse(data) : data);
  } else {
    console.warn("App not initialized, cannot send message");
  }
};
