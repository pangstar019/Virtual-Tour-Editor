/**
 * Homepage Utilities
 * Manages tour display, user profile, and homepage interactions
 */

class HomepageManager {
  constructor() {
    this.tourListDiv = document.getElementById("tourList");
    this.createTourModal = document.getElementById("createTourModal");
    this.createTourError = document.getElementById("createTourError");
    
    this.init();
  }
  
  init() {
    this.loadUserProfile();
    this.refreshTours();
    this.setupEventListeners();
    console.log("sessionPage:", SessionManager.getPage());
    
    // Initialize the app
    window.app = new VirtualTourApp();
  }
  
  setupEventListeners() {
    // WebSocket message handling
    window.addEventListener('websocketMessage', (event) => {
      this.handleMessage(event.detail);
    });
    
    // Modal close on outside click
    window.onclick = (event) => {
      if (event.target === this.createTourModal) {
        this.closeCreateTourModal();
      }
      if (event.target === document.getElementById("userManualModal")) {
        this.closeUserManualModal();
      }
    };
  }
  
  /**
   * Load user profile information from localStorage
   */
  loadUserProfile() {
    const profile = SessionManager.getUserProfile();
    
    if (profile.username) {
      const userNameElement = document.getElementById('userName');
      if (userNameElement) {
        userNameElement.textContent = profile.username;
      }
    }
    
    if (profile.email) {
      const userEmailElement = document.getElementById('userEmail');
      if (userEmailElement) {
        userEmailElement.textContent = profile.email;
      }
    }
    
    if (profile.picture) {
      const pictureElement = document.getElementById('userPicture');
      if (pictureElement) {
        pictureElement.src = profile.picture;
        pictureElement.style.display = 'block';
      }
    }
  }
  
  /**
   * Sign out the current user
   */
  signOut() {
    // Clear profile data
    SessionManager.clearUserProfile();
    
    // Sign out from Google if available
    if (typeof gapi !== 'undefined' && gapi.auth2) {
      const auth2 = gapi.auth2.getAuthInstance();
      if (auth2) {
        auth2.signOut().then(() => {
          console.log('User signed out from Google.');
        });
      }
    }
    
    // Send logout message and navigate
    this.sendToServer(JSON.stringify({ action: "Logout" }));
    navigate('login');
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
      
      if (response.redirect) {
        this.handleRedirect(response);
      }
      
      if (response.tours) {
        this.displayTours(response.tours);
      }
      
      if (response.error) {
        this.showError(response.error);
      }
      
    } catch (e) {
      console.error("Invalid JSON", e);
    }
  }
  
  /**
   * Show a temporary message to the user
   */
  showMessage(message) {
    // You could implement a toast notification system here
    console.log("Message:", message);
  }
  
  /**
   * Handle redirect responses
   */
  handleRedirect(response) {
    // Clear session data if redirecting to login
    if (response.redirect === "login") {
      SessionManager.clearSession();
    }
    // Navigate to the new page
    navigate(response.redirect);
  }
  
  /**
   * Show error in the create tour modal
   */
  showError(error) {
    this.createTourError.innerText = error;
    this.createTourError.classList.add('show');
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
   * Refresh tours list
   */
  refreshTours() {
    this.sendToServer(JSON.stringify({ action: "ShowTours" }));
    this.tourListDiv.innerHTML = '<div class="loading">Loading tours</div>';
  }
  
  /**
   * Display tours on the homepage
   */
  displayTours(tours) {
    this.tourListDiv.innerHTML = '';

    tours.forEach(tour => {
      const tourDiv = document.createElement('div');
      tourDiv.className = 'tour-item';

      tourDiv.innerHTML = `
  <img class="tour-thumbnail" src="${tour.initial_scene_thumbnail || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIFRodW1ibmFpbDwvdGV4dD48L3N2Zz4='}" alt="${tour.name}" 
             onerror="this.style.display='none'">
        <div class="tour-info">
          <div class="tour-name">${tour.name}</div>
          <div class="tour-meta">
            <span class="tour-views">👁️ ${tour.views || 0}</span>
            <span class="tour-date">📅 ${new Date(tour.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      `;

      // Add click handler to navigate to editor
      tourDiv.addEventListener('click', () => {
        // Store tour ID and navigate to editor
        localStorage.setItem('currentTourId', tour.id);
        navigate('editor');
      });

      this.tourListDiv.appendChild(tourDiv);
    });
  }
  
  /**
   * Show empty state when no tours exist
   */
  showEmptyState() {
    this.tourListDiv.innerHTML = `
      <div class="create-new-placeholder" onclick="homepageManager.openCreateTourModal()">
        <div class="create-icon">➕</div>
        <div class="create-text">Create your first virtual tour!</div>
      </div>
    `;
  }
  
  /**
   * Create HTML for a tour card
   */
  createTourCard(tour) {
    const createdDate = new Date(tour.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    
    return `
      <div class="tour-card">
        <div class="tour-title">${this.escapeHtml(tour.name)}</div>
        <div class="tour-location">📍 ${this.escapeHtml(tour.location)}</div>
        <div class="tour-date">Created: ${createdDate}</div>
        <div class="tour-actions">
          <button class="edit-btn" onclick="homepageManager.editTour('${tour.id}')">✏️ Edit</button>
          <button class="delete-btn" onclick="homepageManager.deleteTour('${tour.id}')">🗑️ Delete</button>
        </div>
      </div>
    `;
  }
  
  /**
   * Create HTML for new tour card
   */
  createNewTourCard() {
    return `
      <div class="create-new-placeholder" onclick="homepageManager.openCreateTourModal()">
        <div class="create-icon">➕</div>
        <div class="create-text">Create New Tour</div>
      </div>
    `;
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Edit a tour
   */
  editTour(tourId) {
    localStorage.setItem('currentTourId', tourId);
    navigate('editor');
  }
  
  /**
   * Delete a tour with confirmation
   */
  deleteTour(tourId) {
    if (confirm('Are you sure you want to delete this tour? This action cannot be undone.')) {
      this.sendToServer(JSON.stringify({
        action: "DeleteTour",
        data: { tour_id: tourId }
      }));
    }
  }
  
  /**
   * Open create tour modal
   */
  openCreateTourModal() {
    this.createTourModal.style.display = "block";
    this.clearCreateTourForm();
  }
  
  /**
   * Close create tour modal
   */
  closeCreateTourModal() {
    this.createTourModal.style.display = "none";
  }
  
  /**
   * Clear create tour form
   */
  clearCreateTourForm() {
    this.createTourError.innerText = "";
    this.createTourError.classList.remove('show');
    document.getElementById("tourName").value = "";
    document.getElementById("tourLocation").value = "";
  }
  
  /**
   * Submit create tour form
   */
  submitCreateTour() {
    const tourName = document.getElementById("tourName").value.trim();
    const tourLocation = document.getElementById("tourLocation").value.trim();
    
    if (!tourName) {
      this.showError("Please enter a tour name");
      return;
    }
    
    // Close modal and send request
    this.closeCreateTourModal();
    
    this.sendToServer(JSON.stringify({
      action: "CreateTour",
      data: {
        name: tourName,
        location: tourLocation || "Unknown Location"
      },
    }));
  }
  
  /**
   * Show user manual modal
   */
  showUserManual() {
    document.getElementById("userManualModal").style.display = "flex";
  }
  
  /**
   * Close user manual modal
   */
  closeUserManualModal() {
    document.getElementById("userManualModal").style.display = "none";
  }
  
  /**
   * Handle PDF load error
   */
  handlePdfError() {
    document.getElementById('userManualFrame').style.display = 'none';
    document.getElementById('pdfError').style.display = 'block';
  }
}

// Initialize when DOM is ready
let homepageManager;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    homepageManager = new HomepageManager();
  });
} else {
  homepageManager = new HomepageManager();
}

// Global functions for HTML onclick handlers
window.signOut = () => homepageManager.signOut();
window.openCreateTourModal = () => homepageManager.openCreateTourModal();
window.closeCreateTourModal = () => homepageManager.closeCreateTourModal();
window.submitCreateTour = () => homepageManager.submitCreateTour();
window.showUserManual = () => homepageManager.showUserManual();
window.closeUserManualModal = () => homepageManager.closeUserManualModal();
window.handlePdfError = () => homepageManager.handlePdfError();
