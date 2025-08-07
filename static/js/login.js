/**
 * Login Manager
 * Handles user authentication and registration
 */

class LoginManager {
  constructor() {
    this.messageDiv = document.getElementById("message");
    this.usernameField = document.getElementById("username");
    this.passwordField = document.getElementById("password");
    
    this.init();
  }
  
  init() {
    this.setupEventListeners();
    
    // Initialize the app
    window.app = new VirtualTourApp();
  }
  
  setupEventListeners() {
    // WebSocket message handling
    window.addEventListener('websocketMessage', (event) => {
      this.handleMessage(event.detail);
    });
    
    // Enter key support
    this.usernameField?.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        this.login();
      }
    });
    
    this.passwordField?.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        this.login();
      }
    });
  }
  
  /**
   * Handle WebSocket messages
   */
  handleMessage(data) {
    console.log("Message from server: ", data);
    
    try {
      const response = JSON.parse(data);
      
      if (response.message) {
        this.showMessage(response.message);
      }
      
      if (response.sessionToken && response.username) {
        this.handleSuccessfulLogin(response);
      }
      
      if (response.redirect) {
        navigate(response.redirect);
      }
      
    } catch (e) {
      console.error("Invalid JSON", e);
    }
  }
  
  /**
   * Show message to user
   */
  showMessage(message) {
    this.messageDiv.innerText = message;
  }
  
  /**
   * Handle successful login response
   */
  handleSuccessfulLogin(response) {
    // Save session information
    SessionManager.saveSession(response.username, response.sessionToken);
  }
  
  /**
   * Send message to server directly
   */
  sendToServer(message) {
    if (window.app && window.app.sendMessage) {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      window.app.sendMessage(data);
    } else {
      console.warn("App not initialized, cannot send message");
    }
  }
  
  /**
   * Validate login input
   */
  validateInput(username, password) {
    if (!username || !password) {
      this.showMessage("Please enter both username and password");
      return false;
    }
    return true;
  }
  
  /**
   * Attempt user login
   */
  login() {
    const username = this.usernameField.value.trim();
    const password = this.passwordField.value;
    
    if (!this.validateInput(username, password)) {
      return;
    }
    
    // Save username for profile
    SessionManager.setUserProfile(username);
    
    // Send login request
    this.sendToServer(JSON.stringify({ 
      action: "Login", 
      data: { username, password } 
    }));
  }
  
  /**
   * Attempt user registration
   */
  registerUser() {
    const username = this.usernameField.value.trim();
    const password = this.passwordField.value;
    
    if (!this.validateInput(username, password)) {
      return;
    }
    
    // Save username for profile
    SessionManager.setUserProfile(username);
    
    // Send registration request
    this.sendToServer(JSON.stringify({ 
      action: "Register", 
      data: { username, password } 
    }));
  }
  
  /**
   * Parse JWT token (simple decoder for client-side use only)
   */
  parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error("Error parsing JWT:", e);
      return {};
    }
  }
}

// Initialize when DOM is ready
let loginManager;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loginManager = new LoginManager();
  });
} else {
  loginManager = new LoginManager();
}

// Global functions for HTML onclick handlers
window.login = () => loginManager.login();
window.registerUser = () => loginManager.registerUser();
