/**
 * Virtual Tour Editor - Main Editor Implementation
 * Handles 360-degree panoramic viewing, scene management, and connection creation
 */

class VirtualTourEditor {
    constructor() {
        this.initializeProperties();
        this.init();
    this.blockPan = false; // when pressing on a sprite, prevent camera panning
    }
    
    /**
     * Initialize all class properties with proper organization
     */
    initializeProperties() {
        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.panoramaSphere = null;
        this.currentTexture = null;
        this.textureCache = null; // Will be initialized in initThreeJS
        this.raycaster = new THREE.Raycaster(); // For sprite click detection
        this.mouse = new THREE.Vector2(); // For mouse position tracking
        
        // Tour data management
        this.tourData = null;
        this.currentTourId = null;
        this.currentSceneId = null;
        this.tourDataRequested = false;
        
        // Scene and connection data
        this.connections = [];
        this.scenes = [];
        this.connectionSprites = []; // Track active connection 3D sprites
    this.connectionBaseScale = 32; // base world-unit size for sprites at fov=75
    this.pointerDownOnSprite = null; // { sprite, connection, downX, downY }
    this.dragHoldTimer = null;
    this.isDraggingConnection = false;
        
        // File upload management
        this.uploadedFiles = [];
        
        // User interaction state
        this.isHotspotMode = false;
        this.hotspotCreatePosition = null;
        
        // Position logging
        this.positionLoggingInterval = null;
        
        // Camera control properties
        this.initializeCameraControls();
    }
    
    /**
     * Initialize camera control properties
     */
    initializeCameraControls() {
        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.lon = 0;
        this.lat = 0;
        this.phi = 0;
        this.theta = 0;
        
        // Smooth movement settings
        this.momentum = { x: 0, y: 0 };
        this.dampening = 0.95;
        this.sensitivity = 0.2;
    }
    
    /**
     * Clear mouse interaction state
     */
    clearMouseState() {
        this.isMouseDown = false;
        this.momentum = { x: 0, y: 0 };
    }
    
    /**
     * Show a notification message
     */
    showNotification(message, type = 'success', title = null, duration = 5000) {
        const container = document.getElementById('notification-container');
        if (!container) return;
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        // Determine icon based on type
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        const icon = icons[type] || icons.success;
        
        // Build notification content
        let content = `
            <div class="notification-icon">${icon}</div>
            <div class="notification-content">
        `;
        
        if (title) {
            content += `<div class="notification-title">${title}</div>`;
        }
        
        content += `
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;
        
        notification.innerHTML = content;
        
        // Add to container
        container.appendChild(notification);
        
        // Trigger show animation
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.removeNotification(notification);
            }, duration);
        }
        
        return notification;
    }
    
    /**
     * Remove a notification with animation
     */
    removeNotification(notification) {
        if (!notification || !notification.parentElement) return;
        
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }
    
    /**
     * Show success notification
     */
    showSuccess(message, title = 'Success') {
        return this.showNotification(message, 'success', title);
    }
    
    /**
     * Show error notification
     */
    showError(message, title = 'Error') {
        return this.showNotification(message, 'error', title);
    }
    
    /**
     * Show warning notification
     */
    showWarning(message, title = 'Warning') {
        return this.showNotification(message, 'warning', title);
    }
    
    /**
     * Show info notification
     */
    showInfo(message, title = 'Info') {
        return this.showNotification(message, 'info', title);
    }
    
    /**
     * Show loading state with message
     */
    showLoadingState(message = 'Loading...') {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
            const messageEl = loadingIndicator.querySelector('.loading-message');
            if (messageEl) {
                messageEl.textContent = message;
            }
        }
        console.log('Loading:', message);
    }
    
    /**
     * Hide loading state
     */
    hideLoadingState() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
    
    /**
     * Main initialization method with performance optimizations
     */
    async init() {
        try {
            // Show loading state immediately
            this.showLoadingState('Initializing Virtual Tour Editor...');
            
            this.setupTourId();
            
            // Start parallel initialization
            const initPromises = [
                this.initThreeJS(),
                this.initWebSocketConnection()
            ];
            
            // Setup UI immediately while other components load
            this.setupEventListeners();
            this.setupFileUpload();
            this.showLoadingState('Connecting to server...');
            
            // Wait for parallel initialization to complete
            await Promise.all(initPromises);
            
            this.showLoadingState('Loading tour data...');
            console.log('Editor initialized, waiting for authentication...');
            
        } catch (error) {
            console.error('Failed to initialize editor:', error);
            this.hideLoadingState();
            this.showError('Failed to initialize virtual tour editor. Please refresh the page to try again.');
        }
    }
    
    /**
     * Initialize WebSocket connection with better error handling
     */
    async initWebSocketConnection() {
        // Initialize WebSocket connection
        window.app = new VirtualTourApp();
        this.setupWebSocketMessageHandling();
        await this.waitForWebSocketConnection();
    }
    
    /**
     * Setup tour ID from localStorage or use default
     */
    setupTourId() {
        this.currentTourId = parseInt(localStorage.getItem('currentTourId') || '1');
        localStorage.setItem('currentTourId', this.currentTourId.toString());
    }
    
    /**
     * Initialize Three.js scene, camera, and renderer with performance optimizations
     */
    async initThreeJS() {
        const canvas = document.getElementById('viewer-canvas');
        const container = canvas.parentElement;
        
        // Scene setup
        this.scene = new THREE.Scene();
        
        // Camera setup with optimized settings
        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        
        // Renderer setup with balanced performance optimizations
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,  // Disabled for better performance
            powerPreference: "high-performance",
            alpha: false,      // No transparency needed
            depth: true,       // Keep depth buffer for proper rendering
            stencil: false     // No stencil buffer needed
        });
        
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio
        
        // Keep automatic clearing enabled for proper rendering
        this.renderer.autoClear = true;
        
        // Create panorama sphere with optimized geometry
        const sphereGeometry = new THREE.SphereGeometry(500, 32, 16); // Reduced geometry complexity
        sphereGeometry.scale(-1, 1, 1);
        
        const sphereMaterial = new THREE.MeshBasicMaterial();
        this.panoramaSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        this.scene.add(this.panoramaSphere);
        
        // Initialize texture cache for better performance
        this.textureCache = new Map();
        
        this.animate();
    }
    
    // ====================================
    // EVENT LISTENERS SETUP
    // ====================================
    
    /**
     * Setup all event listeners for user interaction
     */
    setupEventListeners() {
        const canvas = document.getElementById('viewer-canvas');
        
        // Mouse events
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        canvas.addEventListener('wheel', (e) => this.onWheel(e));
        
        // Touch events
        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
        
        // Window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        // Close dropdowns when clicking outside
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.scene-options-btn') && 
                !event.target.closest('.scene-options-dropdown')) {
                this.closeAllDropdowns();
            }
        });
    }

    /**
     * Setup file upload area with drag and drop support
     */
    setupFileUpload() {
        const fileInput = document.getElementById('file-upload');
        const uploadArea = document.querySelector('.upload-area');

        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Drag and drop handlers
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload({ target: { files } });
            }
        });
    }

    /**
     * Handle file upload from input or drag/drop
     */
    handleFileUpload(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        // Validate all files are images
        const invalidFiles = files.filter(file => !file.type.startsWith('image/'));
        if (invalidFiles.length > 0) {
            alert('Please select only image files');
            return;
        }

        this.uploadedFiles = files;

        this.updateUploadAreaDisplay();
    }
    
    /**
     * Update upload area to show selected files
     */
    updateUploadAreaDisplay() {
        const uploadArea = document.querySelector('.upload-area');
        
        if (this.uploadedFiles.length === 0) {
            uploadArea.innerHTML = `
                <div class="upload-icon">📁</div>
                <div class="upload-text">Click to upload or drag & drop</div>
                <div class="upload-hint">Supports JPG, PNG files (Equirectangular format)</div>
            `;
        } else if (this.uploadedFiles.length === 1) {
            uploadArea.innerHTML = `
                <div class="upload-icon">✅</div>
                <div class="upload-text">File selected: ${this.uploadedFiles[0].name}</div>
                <div class="upload-hint">Click to select different file(s)</div>
            `;
        } else {
            const fileList = this.uploadedFiles.slice(0, 3).map(file => file.name).join(', ');
            const remaining = this.uploadedFiles.length > 3 ? ` and ${this.uploadedFiles.length - 3} more` : '';
            
            uploadArea.innerHTML = `
                <div class="upload-icon">✅</div>
                <div class="upload-text">${this.uploadedFiles.length} files selected</div>
                <div class="upload-hint">${fileList}${remaining}</div>
            `;
        }
    }
    
    // ====================================
    // MOUSE/TOUCH INTERACTION METHODS
    // ====================================
    
    /**
     * Handle mouse down event
     */
    onMouseDown(event) {
        event.preventDefault();
        this.isMouseDown = true;
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
        this.momentum = { x: 0, y: 0 };

        // Detect if pressing on a connection sprite to enable long-press drag or click actions
        const hit = this.getSpriteUnderPointer(event.clientX, event.clientY);
        if (hit) {
            this.pointerDownOnSprite = { sprite: hit.sprite, connection: hit.connection, downX: event.clientX, downY: event.clientY };
            this.blockPan = true; // block camera panning while pointer is down on a sprite
            this.isDraggingConnection = false;
            // Start long-press timer to begin dragging
            this.dragHoldTimer = setTimeout(() => {
                // Only start dragging if pointer still down on same sprite
                if (this.isMouseDown && this.pointerDownOnSprite) {
                    this.isDraggingConnection = true;
                    document.body.style.cursor = 'grabbing';
                }
            }, 300);
        } else {
            this.pointerDownOnSprite = null;
            this.blockPan = false;
        }
        
        if (this.isHotspotMode) {
            this.createHotspotAt(event.clientX, event.clientY);
            // Clear mouse state after hotspot creation to prevent stuck mouse down state
            this.clearMouseState();
            return;
        }
    }
    
    /**
     * Handle mouse move event
     */
    onMouseMove(event) {
        // Hover feedback for sprites
        this.updateHoverCursor(event.clientX, event.clientY);

        // If pointer is down on a sprite, never pan the camera
        if (this.pointerDownOnSprite) {
            if (this.isDraggingConnection) {
                // Update sprite position while dragging
                const newPos = this.screenToSpherePositionAtClient(event.clientX, event.clientY);
                if (newPos) {
                    this.pointerDownOnSprite.sprite.position.copy(newPos);
                }
            }
            return; // fully block camera movement while interacting with a sprite
        }

        if (!this.isMouseDown) return;
        
        const deltaX = event.clientX - this.mouseX;
        const deltaY = event.clientY - this.mouseY;
        
        this.applyMovement(deltaX, deltaY);
        
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
    }
    
    /**
     * Handle mouse up event
     */
    onMouseUp(event) {
        if (!this.isMouseDown) return;

        this.isMouseDown = false;
        // Cancel pending long-press timer
        if (this.dragHoldTimer) {
            clearTimeout(this.dragHoldTimer);
            this.dragHoldTimer = null;
        }

        if (this.pointerDownOnSprite) {
            const wasDragging = this.isDraggingConnection;
            const { sprite, connection } = this.pointerDownOnSprite;
            this.pointerDownOnSprite = null;
            this.isDraggingConnection = false;
            this.blockPan = false;
            document.body.style.cursor = '';

            if (wasDragging) {
                // Persist new position (convert to lon/lat and send EditConnection)
                const { lon, lat } = this.vectorToLonLatDeg(sprite.position);
                // Update local state
                connection.position = [parseFloat(lon.toFixed(2)), parseFloat(lat.toFixed(2))];
                this.sendEditConnection(connection.id, connection.target_scene_id, connection.position);
                this.showSuccess('Connection position updated');
                // Clear any residual momentum to avoid camera motion after drag
                this.momentum = { x: 0, y: 0 };
                return;
            }

            // Treat as click: ctrl+click transitions, else open edit modal
            if (event.ctrlKey) {
                const targetScene = this.scenes.find(s => s.id === connection.target_scene_id);
                if (targetScene) {
                    this.loadScene(targetScene.id);
                }
            } else {
                this.openEditConnectionModal(connection);
            }
            // Reset and clear any accidental momentum
            this.blockPan = false;
            this.momentum = { x: 0, y: 0 };
            return;
        }

        // If we weren't interacting with a sprite, treat as normal click (no sprite action)
        // Only trigger raycast click if very small movement
        if (Math.abs(this.momentum.x) < 0.1 && Math.abs(this.momentum.y) < 0.1) {
            // No-op for now; sprite actions are handled above
        }
    }
    
    /**
     * Utility: return sprite and connection under a client coordinate, if any
     */
    getSpriteUnderPointer(clientX, clientY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const sprites = this.connectionSprites.map(data => data.sprite);
        const intersects = this.raycaster.intersectObjects(sprites);
        if (intersects.length > 0) {
            const sprite = intersects[0].object;
            const entry = this.connectionSprites.find(d => d.sprite === sprite);
            if (entry) return { sprite: entry.sprite, connection: entry.connection };
        }
        return null;
    }

    updateHoverCursor(clientX, clientY) {
        const hit = this.getSpriteUnderPointer(clientX, clientY);
        const canvas = document.getElementById('viewer-canvas');
        if (hit && !this.isDraggingConnection) {
            canvas.style.cursor = 'pointer';
            // Show tooltip with connection name or target scene name
            const conn = hit.connection;
            const label = (conn && conn.name) || this.getSceneName(conn && conn.target_scene_id) || '';
            if (label) this.showTooltip(label, clientX, clientY);
            else this.hideTooltip();
        } else if (!this.isMouseDown) {
            canvas.style.cursor = '';
            this.hideTooltip();
        }
        // If mouse is down on a sprite, never pan the camera
        if (this.pointerDownOnSprite) {
            canvas.style.cursor = 'grabbing';
            this.hideTooltip();
        }
    }
    
    /**
     * Handle mouse wheel event for zoom
     */
    onWheel(event) {
        const fov = this.camera.fov + event.deltaY * 0.05;
        this.camera.fov = Math.max(10, Math.min(120, fov));
        this.camera.updateProjectionMatrix();
    }
    
    /**
     * Handle touch start event
     */
    onTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            this.isMouseDown = true;
            this.mouseX = event.touches[0].clientX;
            this.mouseY = event.touches[0].clientY;
            this.momentum = { x: 0, y: 0 };
            
            if (this.isHotspotMode) {
                this.createHotspotAt(event.touches[0].clientX, event.touches[0].clientY);
                // Clear mouse state after hotspot creation to prevent stuck mouse down state
                this.clearMouseState();
                return;
            }
        }
    }
    
    /**
     * Handle touch move event
     */
    onTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1 && this.isMouseDown) {
            const deltaX = event.touches[0].clientX - this.mouseX;
            const deltaY = event.touches[0].clientY - this.mouseY;
            
            this.applyMovement(deltaX, deltaY);
            
            this.mouseX = event.touches[0].clientX;
            this.mouseY = event.touches[0].clientY;
        }
    }
    
    /**
     * Handle touch end event
     */
    onTouchEnd(event) {
        this.isMouseDown = false;
    }
    
    /**
     * Apply movement with sensitivity and momentum
     */
    applyMovement(deltaX, deltaY) {
        const moveX = deltaX * this.sensitivity;
    // Natural panorama behavior: dragging down should look up
    const moveY = deltaY * this.sensitivity;

        this.lon = (this.lon - moveX) % 360;
        this.lat = (this.lat + moveY) % 360;
        this.lat = Math.max(-85, Math.min(85, this.lat));
        
        // Store momentum for smooth movement
        this.momentum.x = moveX * 0.5;
        this.momentum.y = moveY * 0.5;
        
        this.updateCamera();
    }
    
    /**
     * Update camera position and orientation
     */
    updateCamera() {
        this.phi = THREE.MathUtils.degToRad(90 - this.lat);
        this.theta = THREE.MathUtils.degToRad(this.lon);

        // Keep camera at the origin and rotate/look around
        // This avoids parallax and keeps world-anchored sprites fixed on the panorama
        const dirX = Math.sin(this.phi) * Math.cos(this.theta);
        const dirY = Math.cos(this.phi);
        const dirZ = Math.sin(this.phi) * Math.sin(this.theta);

        this.camera.position.set(0, 0, 0);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(dirX, dirY, dirZ);
    }
    
    /**
     * Handle window resize
     */
    onWindowResize() {
        const container = document.getElementById('viewer-canvas').parentElement;
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);

        // Recompute marker positions since saved coords are in pixels relative to canvas size
        if (this.tourData && this.currentSceneId) {
            const currentScene = this.tourData.scenes?.find(s => s.id == this.currentSceneId);
            if (currentScene && currentScene.connections) {
                this.updateConnectionMarkers(currentScene.connections);
            }
        }
    }
    
    /**
     * Main animation loop
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Apply momentum when not actively dragging
        if (!this.isMouseDown && (Math.abs(this.momentum.x) > 0.005 || Math.abs(this.momentum.y) > 0.005)) {
            this.applyMomentum();
        }
        
        this.renderer.render(this.scene, this.camera);
    // Keep connection icon size consistent on screen by adjusting with FOV
    this.updateConnectionSpriteScales();
    }
    
    /**
     * Apply momentum for smooth movement after user interaction ends
     */
    applyMomentum() {
        const x_dir = this.momentum.x > 0 ? 1 : -1;
        const y_dir = this.momentum.y > 0 ? 1 : -1;

        this.momentum.x = Math.min(0.8, Math.abs(this.momentum.x)) * x_dir;
        this.momentum.y = Math.min(0.8, Math.abs(this.momentum.y)) * y_dir;

        this.lon -= this.momentum.x;
        this.lat += this.momentum.y;
        
        this.lat = Math.max(-85, Math.min(85, this.lat));
        
        // Dampen momentum
        this.momentum.x *= this.dampening;
        this.momentum.y *= this.dampening;
        
        // Stop micro-movements
        if (Math.abs(this.momentum.x) < 0.005) this.momentum.x = 0;
        if (Math.abs(this.momentum.y) < 0.005) this.momentum.y = 0;
        
        this.updateCamera();
    }
    
    // ====================================
    // WEBSOCKET COMMUNICATION
    // ====================================
    
    /**
     * Setup WebSocket message handling
     */
    setupWebSocketMessageHandling() {
        window.addEventListener('websocketMessage', async (event) => {
            try {
                const data = JSON.parse(event.detail);
                await this.handleWebSocketMessage(data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        });
    }
    
    /**
     * Wait for WebSocket connection to be established with faster timeout
     */
    async waitForWebSocketConnection() {
        return new Promise((resolve, reject) => {
            const maxAttempts = 30; // Reduced from 50 for faster initialization
            let attempts = 0;
            
            const checkConnection = () => {
                if (window.app?.socket?.readyState === WebSocket.OPEN) {
                    resolve();
                } else if (attempts >= maxAttempts) {
                    reject(new Error('WebSocket connection timeout'));
                } else {
                    attempts++;
                    setTimeout(checkConnection, 100);
                }
            };
            
            checkConnection();
        });
    }
    
    /**
     * Handle incoming WebSocket messages
     */
    async handleWebSocketMessage(data) {
        console.log('Editor received message:', data);
        
        switch (data.type) {
            case 'tour_data':
                this.loadTourFromData(data.data);
                break;
            case 'tour_list':
                this.handleTourList(data.tours);
                break;
            case 'scene_added':
                this.addSceneToList(data.scene);
                this.showSuccess(`Scene "${data.scene.name}" has been added successfully`);
                break;
            case 'scene_deleted':
                console.log('Received scene_deleted message:', data);
                await this.removeSceneFromList(data.scene_id);
                this.showSuccess('Scene has been deleted successfully');
                break;
            case 'scene_updated':
                this.handleSceneUpdate(data.scene);
                break;
            case 'connection_created':
                this.addConnectionToScene(data.connection);
                this.showSuccess('Connection created successfully');
                break;
            case 'success':
                this.showSuccess(data.message, data.title || 'Success');
                break;
            case 'error':
                console.error('WebSocket error:', data.message);
                this.showError(data.message, data.title || 'Error');
                break;
            default:
                console.log('Unhandled message type:', data.type);
                break;
        }
        
        // Handle session restored
        if (data.sessionRestored && !this.tourDataRequested) {
            this.tourDataRequested = true;
            setTimeout(() => this.loadTourData(), 100); // Reduced from 500ms for faster loading
        }
    }
    
    /**
     * Request tour data from server
     */
    async loadTourData() {
        if (window.app?.socket?.readyState === WebSocket.OPEN) {
            const message = {
                action: "EditTour",
                data: { tour_id: this.currentTourId }
            };
            window.app.socket.send(JSON.stringify(message));
        }
    }
    
    // ====================================
    // TOUR DATA MANAGEMENT
    // ====================================
    
    
    /**
     * Load tour data and initialize UI with optimized loading
     */
    async loadTourFromData(tourData) {
        console.log('loadTourFromData called with:', tourData);
        this.tourData = tourData;
        this.scenes = tourData.scenes || []; // Store scenes for easier access
        
        // Update UI immediately
        this.updateUI();
        
        if (!tourData.scenes || tourData.scenes.length === 0) {
            console.log('No scenes in tour data, showing no scenes message');
            this.hideLoadingState();
            this.showNoScenesMessage();
            return;
        }
        
        console.log('Available scenes:', tourData.scenes.map(s => ({ id: s.id, name: s.name })));
        console.log('Initial scene ID from tour:', tourData.initial_scene_id);
        
        // Use type-coercive comparison to handle string/number mismatches
        const sceneToLoad = tourData.initial_scene_id 
            ? tourData.scenes.find(s => s.id == tourData.initial_scene_id)  // Use == instead of ===
            : tourData.scenes[0];
            
        if (sceneToLoad) {
            console.log('Loading scene:', sceneToLoad.name, 'with ID:', sceneToLoad.id);
            await this.loadScene(sceneToLoad.id);
        } else {
            console.log('No valid scene found to load, loading first available scene');
            if (tourData.scenes.length > 0) {
                await this.loadScene(tourData.scenes[0].id);
            }
        }
        
        this.hideLoadingState();
    }
    
    /**
     * Update UI elements with tour data
     */
    updateUI() {
        if (!this.tourData) return;
        
        this.updateTourInfo();
        this.updateSceneGallery();
    }
    
    /**
     * Update tour information in the header
     */
    updateTourInfo() {
        const elements = {
            'tour-title': this.tourData.name || 'Virtual Tour Editor',
            'tour-subtitle': this.tourData.location || 'Loading tour...',
            'current-scene-name': this.tourData.scenes?.length > 0 ? 'Select a scene' : 'No scenes available',
            'tour-info': '' // Leave empty since we removed scene count
        };
        
        Object.entries(elements).forEach(([id, text]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = text;
        });
    }
    
    /**
     * Update the scene gallery display
     */
    updateSceneGallery() {
        const sceneGallery = document.getElementById('scene-gallery');
        if (!sceneGallery) return;
        
        sceneGallery.innerHTML = '';
        
        if (!this.tourData.scenes || this.tourData.scenes.length === 0) {
            sceneGallery.innerHTML = this.getNoScenesHTML();
            return;
        }
        
        this.tourData.scenes.forEach(scene => {
            const sceneElement = this.createSceneElement(scene);
            sceneGallery.appendChild(sceneElement);
        });
    }
    
    /**
     * Get HTML for no scenes message
     */
    getNoScenesHTML() {
        return `
            <div class="no-scenes-message">
                <div class="icon">📷</div>
                <div class="title">No Scenes Available</div>
                <div class="subtitle">Click "Add Scenes" to upload your first 360° image</div>
            </div>
        `;
    }
    
    /**
     * Create scene element for the gallery
     */
    createSceneElement(scene) {
        const sceneDiv = document.createElement('div');
        sceneDiv.className = 'scene-item';
        sceneDiv.dataset.sceneId = scene.id;
        
        sceneDiv.innerHTML = `
            <img class="scene-thumbnail" src="${scene.file_path}" alt="${scene.name}" 
                 onerror="this.style.display='none'">
            <div class="scene-info">
                <input type="text" class="scene-name-input" value="${scene.name}" 
                       onblur="updateSceneName('${scene.id}', this.value)"
                       onkeypress="if(event.key==='Enter') this.blur()"
                       onclick="event.stopPropagation()" />
            </div>
            <div class="scene-actions">
                <button class="scene-options-btn" onclick="event.stopPropagation(); toggleSceneOptions('${scene.id}', event)" title="Scene Options">
                    ⋮
                </button>
                <div class="scene-options-dropdown" id="options-${scene.id}">
                    <div class="scene-option-item" onclick="setSceneAsInitial('${scene.id}')">
                        🎯 Set as Initial
                    </div>
                    <div class="scene-option-item" onclick="swapScene('${scene.id}')">
                        🔄 Swap Scene
                    </div>
                    <div class="scene-option-item danger" onclick="deleteScene('${scene.id}')">
                        🗑️ Delete Scene
                    </div>
                </div>
            </div>
        `;
        
        sceneDiv.addEventListener('click', (e) => {
            if (!e.target.closest('.scene-actions')) {
                this.loadScene(scene.id);
            }
        });
        
        return sceneDiv;
    }
    
    /**
     * Show no scenes available message
     */
    showNoScenesMessage() {
        console.log('showNoScenesMessage called');
        
        // Clear the current panorama texture
        if (this.panoramaSphere && this.panoramaSphere.material) {
            this.panoramaSphere.material.map = null;
            this.panoramaSphere.material.needsUpdate = true;
        }
        
        // Dispose of current texture to free memory
        if (this.currentTexture) {
            this.currentTexture.dispose();
            this.currentTexture = null;
        }
        
        // Clear current scene ID
        this.currentSceneId = null;
        
        // Show the no scenes message
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.innerHTML = this.getNoScenesHTML();
            loadingIndicator.style.display = 'flex';
        }
        
        // Update scene name in header
        const sceneNameElement = document.getElementById('current-scene-name');
        if (sceneNameElement) {
            sceneNameElement.textContent = 'No scenes available';
        }
        
        this.updateTourInfo();
        console.log('No scenes message displayed and scene cleared');
    }
    
    /**
     * Add new scene to the tour
     */
    addSceneToList(scene) {
        if (!this.tourData.scenes) {
            this.tourData.scenes = [];
        }
        
        this.tourData.scenes.push(scene);
        this.updateSceneGallery();
        this.updateTourInfo(); // Update tour info in header
        
        if (this.tourData.scenes.length === 1) {
            this.loadScene(scene.id);
        }
    }

    /**
     * Handle scene update from server
     */
    handleSceneUpdate(updatedScene) {
        if (!this.tourData.scenes) return;
        
        // Find and update the scene in local data
        const sceneIndex = this.tourData.scenes.findIndex(s => s.id == updatedScene.id);
        if (sceneIndex !== -1) {
            this.tourData.scenes[sceneIndex] = updatedScene;
            
            // Update the scene gallery to reflect changes
            this.updateSceneGallery();
            
            // If this is the current scene, update the header
            if (this.currentSceneId == updatedScene.id) {
                const sceneNameElement = document.getElementById('current-scene-name');
                if (sceneNameElement) {
                    sceneNameElement.textContent = updatedScene.name;
                }
            }
        }
    }

    /**
     * Remove scene from the tour
     */
    async removeSceneFromList(sceneId) {
        console.log('removeSceneFromList called with sceneId:', sceneId, 'type:', typeof sceneId);
        
        if (!this.tourData.scenes) {
            console.log('No scenes data available');
            return;
        }
        
        console.log('Current scenes before deletion:', this.tourData.scenes.map(s => ({ id: s.id, type: typeof s.id })));
        
        // Check if the deleted scene was the initial scene
        const wasInitialScene = this.tourData.initial_scene_id && this.tourData.initial_scene_id == sceneId;
        console.log('Was deleted scene the initial scene?', wasInitialScene);
        
        // Remove the scene from the local data - ensure proper type comparison
        this.tourData.scenes = this.tourData.scenes.filter(scene => scene.id != sceneId); // Use != for type coercion
        
        console.log('Scenes after deletion:', this.tourData.scenes.map(s => ({ id: s.id, type: typeof s.id })));
        
        // If the deleted scene was the initial scene and there are remaining scenes, set first scene as initial
        if (wasInitialScene && this.tourData.scenes.length > 0) {
            const newInitialScene = this.tourData.scenes[0];
            console.log('Setting new initial scene:', newInitialScene.name, 'with ID:', newInitialScene.id);
            
            // Update local data
            this.tourData.initial_scene_id = newInitialScene.id;
            
            // Send to server
            if (window.app && window.app.socket) {
                window.app.socket.send(JSON.stringify({
                    action: "EditTour",
                    data: {
                        tour_id: this.currentTourId,
                        editor_action: {
                            action: "SetInitialScene",
                            data: { scene_id: parseInt(newInitialScene.id) }
                        }
                    }
                }));
            }
        }
        
        // Always update the scene gallery first
        this.updateSceneGallery();
        this.updateTourInfo();
        
        // If this was the current scene, load another scene or show no scenes message
        if (this.currentSceneId == sceneId) { // Use == for type coercion
            console.log('Deleted scene was the current scene, current ID:', this.currentSceneId);
            if (this.tourData.scenes.length > 0) {
                const nextScene = this.tourData.scenes[0];
                console.log('Loading next scene:', nextScene.id, 'name:', nextScene.name);
                
                // Clear current scene first to avoid confusion
                this.currentSceneId = null;
                
                // Load the scene synchronously
                try {
                    await this.loadScene(nextScene.id);
                    console.log('Successfully loaded next scene');
                } catch (error) {
                    console.error('Failed to load next scene:', error);
                    // If loading fails, show no scenes message
                    this.showNoScenesMessage();
                }
                
            } else {
                console.log('No more scenes left, showing no scenes message');
                this.currentSceneId = null;
                this.showNoScenesMessage();
            }
        } else {
            console.log('Deleted scene was not the current scene, just updating UI');
        }
        
        console.log('Scene removal completed');
    }
    
    // ====================================
    // SCENE LOADING AND MANAGEMENT
    // ====================================
    
    /**
     * Load a specific scene by ID
     */
    async loadScene(sceneId) {
        console.log('loadScene called with sceneId:', sceneId, 'type:', typeof sceneId);
        
        if (!this.tourData.scenes || this.tourData.scenes.length === 0) {
            console.log('No scenes available, showing no scenes message');
            this.showNoScenesMessage();
            return;
        }
        
        console.log('Available scenes:', this.tourData.scenes.map(s => ({ id: s.id, type: typeof s.id, name: s.name })));
        
        const scene = this.tourData.scenes.find(s => s.id == sceneId); // Use == for type coercion
        if (!scene) {
            console.error('Scene not found:', sceneId);
            console.log('Trying strict comparison...');
            const sceneStrict = this.tourData.scenes.find(s => s.id === sceneId);
            console.log('Strict comparison result:', sceneStrict);
            
            // If no scene found, try to load the first available scene
            if (this.tourData.scenes.length > 0) {
                console.log('Loading first available scene instead');
                return this.loadScene(this.tourData.scenes[0].id);
            }
            return;
        }
        
        console.log('Found scene:', scene.name);
        
        // Hide the no scenes message if it's showing and ensure the main viewer is visible
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        // Update the current scene ID immediately
        this.currentSceneId = scene.id;
        
        // Update the active scene in the gallery
        this.updateActiveScene(scene.id, scene);
        
        // Load the scene texture
        try {
            await this.loadSceneTexture(scene);
            console.log('Scene loaded successfully:', scene.name);
            
            // Ensure the loading indicator stays hidden after successful load
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load scene texture:', error);
        }
    }
    
    /**
     * Update active scene selection in gallery
     */
    updateActiveScene(sceneId, scene) {
        // Update gallery selection
        document.querySelectorAll('.scene-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeSceneElement = document.querySelector(`[data-scene-id="${sceneId}"]`);
        if (activeSceneElement) {
            activeSceneElement.classList.add('active');
        }
        
        // Update current scene info
        document.getElementById('current-scene-name').textContent = scene.name;
        this.currentSceneId = sceneId;
    }
    
    /**
     * Load scene texture and apply to panorama sphere with performance optimizations
     */
    async loadSceneTexture(scene) {
        console.log('loadSceneTexture called for scene:', scene.name, 'file_path:', scene.file_path);
        
        // Show loading state for texture
        this.showLoadingState(`Loading ${scene.name}...`);
        
        try {
            // Check if texture is already cached
            let texture = this.textureCache.get(scene.file_path);
            
            if (!texture) {
                // Load texture with optimized settings
                console.log('Texture not in cache, loading from:', scene.file_path);
                const loader = new THREE.TextureLoader();
                texture = await this.loadTextureOptimized(loader, scene.file_path);
                
                // Cache the texture for future use
                this.textureCache.set(scene.file_path, texture);
                console.log('Cached texture for scene:', scene.name);
            } else {
                console.log('Using cached texture for scene:', scene.name);
            }
            
            console.log('Applying texture to panorama sphere...');
            this.applyTexture(texture, scene);
            this.hideLoadingState();
            console.log('Scene texture loaded and applied successfully');
            
            // Preload adjacent scene textures in background for better performance
            this.preloadAdjacentTextures(scene);
            
        } catch (error) {
            console.error('Failed to load scene texture:', error);
            this.hideLoadingState();
            this.showError(`Failed to load scene: ${scene.name}. Error: ${error.message}`);
            
            // Retry with delay
            this.retryTextureLoad(scene);
        }
    }
    
    /**
     * Load texture with optimization and progress feedback
     */
    loadTextureOptimized(loader, filePath) {
        console.log('loadTextureOptimized called with filePath:', filePath);
        return new Promise((resolve, reject) => {
            loader.load(
                filePath, 
                (texture) => {
                    console.log('Texture loaded successfully:', filePath);
                    // Apply conservative optimizations to ensure proper display
                    texture.generateMipmaps = true;
                    texture.minFilter = THREE.LinearMipmapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.format = THREE.RGBFormat;
                    // Keep flipY as default for proper texture orientation
                    console.log('Texture optimizations applied');
                    resolve(texture);
                },
                (progress) => {
                    // Show loading progress if available
                    if (progress.lengthComputable) {
                        const percentComplete = progress.loaded / progress.total * 100;
                        console.log('Texture loading progress:', Math.round(percentComplete), '%');
                        this.showLoadingState(`Loading scene: ${Math.round(percentComplete)}%`);
                    }
                },
                (error) => {
                    console.error('Texture loading failed:', error);
                    reject(error);
                }
            );
        });
    }
    
    /**
     * Preload textures for connected scenes in background
     */
    preloadAdjacentTextures(currentScene) {
        // Don't block the main thread - use setTimeout to preload in background
        setTimeout(() => {
            if (!this.tourData || !this.tourData.scenes) return;
            
            const connections = currentScene.connections || [];
            const preloadPromises = [];
            
            connections.forEach(connection => {
                const targetScene = this.tourData.scenes.find(s => s.id === connection.target_scene_id);
                if (targetScene && !this.textureCache.has(targetScene.file_path)) {
                    const loader = new THREE.TextureLoader();
                    const preloadPromise = this.loadTextureOptimized(loader, targetScene.file_path)
                        .then(texture => {
                            this.textureCache.set(targetScene.file_path, texture);
                            console.log('Preloaded texture for scene:', targetScene.name);
                        })
                        .catch(error => {
                            console.log('Failed to preload texture for scene:', targetScene.name, error);
                        });
                    
                    preloadPromises.push(preloadPromise);
                }
            });
            
            // Also preload first few scenes for better navigation
            const scenesToPreload = this.tourData.scenes.slice(0, 3);
            scenesToPreload.forEach(scene => {
                if (scene.id !== currentScene.id && !this.textureCache.has(scene.file_path)) {
                    const loader = new THREE.TextureLoader();
                    const preloadPromise = this.loadTextureOptimized(loader, scene.file_path)
                        .then(texture => {
                            this.textureCache.set(scene.file_path, texture);
                            console.log('Background preloaded texture for scene:', scene.name);
                        })
                        .catch(error => {
                            console.log('Failed to background preload texture for scene:', scene.name, error);
                        });
                    
                    preloadPromises.push(preloadPromise);
                }
            });
            
            if (preloadPromises.length > 0) {
                Promise.all(preloadPromises).then(() => {
                    console.log(`Preloaded ${preloadPromises.length} scene textures for faster navigation`);
                });
            }
        }, 1500); // Delay preloading to not interfere with main scene loading
    }
    
    /**
     * Retry texture loading with delay (updated for optimized loading)
     */
    async retryTextureLoad(scene) {
        setTimeout(async () => {
            try {
                console.log('Retrying texture load for scene:', scene.name);
                const loader = new THREE.TextureLoader();
                const texture = await this.loadTextureOptimized(loader, scene.file_path);
                
                // Cache the texture
                this.textureCache.set(scene.file_path, texture);
                this.applyTexture(texture, scene);
                this.hideLoadingState();
            } catch (retryError) {
                console.error('Failed to load scene texture on retry:', retryError);
                this.hideLoadingState();
                if (this.tourData.scenes.length <= 1) {
                    this.showError('Failed to load scene image. Please check that the image file exists.');
                }
            }
        }, 1000);
    }
    
    /**
     * Apply texture to panorama sphere with optimizations
     */
    applyTexture(texture, scene) {
        console.log('applyTexture called for scene:', scene.name);
        
        // Apply optimized texture settings for better performance
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.format = THREE.RGBFormat;
        
        // Dispose of previous texture if exists to prevent memory leaks
        if (this.currentTexture && this.currentTexture !== texture) {
            this.currentTexture.dispose();
        }
        
        this.currentTexture = texture;
        this.panoramaSphere.material.map = texture;
        this.panoramaSphere.material.needsUpdate = true;
        
        console.log('Texture applied to panorama sphere');
        
        // Reset camera to initial view if stored
        if (scene.initial_view_x !== undefined && scene.initial_view_y !== undefined) {
            this.lon = scene.initial_view_x;
            this.lat = scene.initial_view_y;
            console.log(`Restored camera position for scene "${scene.name}": lon=${this.lon}°, lat=${this.lat}°`);
            this.updateCamera();
        }
        
        // Reset FOV to initial value if stored
        if (scene.initial_fov !== undefined) {
            this.camera.fov = scene.initial_fov;
            this.camera.updateProjectionMatrix();
            console.log(`Restored FOV for scene "${scene.name}": ${this.camera.fov}°`);
        } else {
            // Set default FOV if not stored
            this.camera.fov = 75;
            this.camera.updateProjectionMatrix();
        }
        
        this.updateConnectionMarkers(scene.connections || []);
    }

    // ====================================
    // CONNECTION MANAGEMENT
    // ====================================
    
    /**
     * Update connection markers for the current scene
     */
    updateConnectionMarkers(connections) {
        this.removeExistingMarkers();
        connections.forEach(connection => this.addConnectionMarker(connection));
    }
    
    /**
     * Remove all existing connection markers
     */
    removeExistingMarkers() {
        this.connectionSprites.forEach(sprite => {
            this.scene.remove(sprite.sprite);
        });
        this.connectionSprites = [];
    this.hideTooltip();
    }
    
    /**
     * Add connection to current scene and display marker
     */
    addConnectionToScene(connection) {
        // Find the current scene and add the connection
        const currentScene = this.scenes.find(s => s.id === this.currentSceneId);
        if (currentScene) {
            if (!currentScene.connections) {
                currentScene.connections = [];
            }
            currentScene.connections.push(connection);
            
            // Add the visual marker immediately
            this.addConnectionMarker(connection);
        }
    }
    
    /**
     * Add a connection marker to the scene using Three.js sprites
     */
    addConnectionMarker(connection) {
    // Compute world position from stored connection data (supports lon/lat or legacy pixels)
    const worldPosition = this.computeWorldPositionFromConnection(connection);
        
        // Create sprite material with the transition icon
        const spriteMap = new THREE.TextureLoader().load('/static/assets/transition_icon.png?v=2');
        const spriteMaterial = new THREE.SpriteMaterial({ 
            map: spriteMap,
            transparent: true,
            depthWrite: false,
            depthTest: false
        });
        
        // Create sprite
    const sprite = new THREE.Sprite(spriteMaterial);
    // Initial size; will be adjusted each frame in updateConnectionSpriteScales
    sprite.scale.set(this.connectionBaseScale, this.connectionBaseScale, 1);
        sprite.position.copy(worldPosition);
        
        // Store connection data in the sprite for click handling
        sprite.userData = {
            connection: connection,
            targetSceneId: connection.target_scene_id
        };
        
        // Add to scene
        this.scene.add(sprite);
        
        // Store for cleanup
        this.connectionSprites.push({
            sprite: sprite,
            connection: connection
        });
    }

    updateConnectionSpriteScales() {
        if (!this.connectionSprites || this.connectionSprites.length === 0) return;
        const baseFov = 75;
        const f = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
        const fBase = Math.tan(THREE.MathUtils.degToRad(baseFov * 0.5));
        const factor = f / fBase; // scale with FOV to maintain on-screen size
        const minScale = 18, maxScale = 80;
        const target = THREE.MathUtils.clamp(this.connectionBaseScale * factor, minScale, maxScale);
        for (const entry of this.connectionSprites) {
            entry.sprite.scale.set(target, target, 1);
        }
    }

    /**
     * Compute world-space position for a connection.
     * - Preferred: interpret connection.position as [lon, lat] degrees or {x:lon, y:lat}.
     * - Fallback (legacy): interpret as pixel coords relative to canvas.
     */
    computeWorldPositionFromConnection(connection) {
        const pos = connection?.position;
        let x = undefined, y = undefined;
        if (Array.isArray(pos)) {
            x = pos[0];
            y = pos[1];
        } else if (pos && typeof pos === 'object') {
            x = pos.x;
            y = pos.y;
        }

        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
            // Default front-center
            return new THREE.Vector3(0, 0, 490);
        }

        const looksAngular = (x >= -180 && x <= 180) && (y >= -90 && y <= 90);
        if (looksAngular) {
            const dir = this.lonLatToVector(x, y);
            return dir.setLength(490);
        }

        // Legacy pixels
        return this.screenToSpherePosition(x, y);
    }

    /** Convert lon/lat degrees to a unit direction vector in world space. */
    lonLatToVector(lonDeg, latDeg) {
        const theta = THREE.MathUtils.degToRad(lonDeg);
        const phi = THREE.MathUtils.degToRad(90 - latDeg);
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        return new THREE.Vector3(x, y, z).normalize();
    }

    /** Convert a world-space direction vector to lon/lat degrees. */
    vectorToLonLatDeg(vec3) {
        const v = vec3.clone().normalize();
        const r = 1; // normalized
        const phi = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
        const theta = Math.atan2(v.z, v.x);
        const lat = 90 - THREE.MathUtils.radToDeg(phi);
        let lon = THREE.MathUtils.radToDeg(theta);
        // Normalize lon to [-180, 180]
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;
        return { lon, lat };
    }

    // Tooltip helpers for connection hover labels
    getSceneName(sceneId) {
        const s = (this.scenes || []).find(x => x.id == sceneId);
        return s ? s.name : null;
    }
    ensureTooltipEl() {
        if (this.tooltipEl) return this.tooltipEl;
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.pointerEvents = 'none';
        el.style.padding = '4px 8px';
        el.style.background = 'rgba(0,0,0,0.75)';
        el.style.color = '#fff';
        el.style.borderRadius = '4px';
        el.style.fontSize = '12px';
        el.style.zIndex = '9999';
        el.style.display = 'none';
        document.body.appendChild(el);
        this.tooltipEl = el;
        return el;
    }
    showTooltip(text, x, y) {
        const el = this.ensureTooltipEl();
        el.textContent = text;
        el.style.left = (x + 12) + 'px';
        el.style.top = (y + 12) + 'px';
        el.style.display = 'block';
    }
    hideTooltip() {
        if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }

    /** From pixel coords, get world-space unit direction intersecting the panorama. */
    screenToWorldDirection(screenX, screenY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            (screenX / rect.width) * 2 - 1,
            -(screenY / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.panoramaSphere, false);
        if (hit.length > 0) {
            return hit[0].point.clone().normalize();
        }
        return this.raycaster.ray.direction.clone().normalize();
    }
    
    /**
     * Convert screen coordinates to 3D world position on the panorama sphere
     * Uses direct 3D world coordinates like the 203 Ambleside project
     */
    screenToSpherePosition(screenX, screenY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        
        // Convert stored pixel coords (relative to canvas) to NDC (-1 to +1)
        const ndc = new THREE.Vector2();
        ndc.x = (screenX / rect.width) * 2 - 1;
        ndc.y = -(screenY / rect.height) * 2 + 1;

        // Use the shared raycaster and intersect the actual panorama sphere
        this.raycaster.setFromCamera(ndc, this.camera);
        const intersects = this.raycaster.intersectObject(this.panoramaSphere, false);

        if (intersects.length > 0) {
            // Place slightly inside the sphere to avoid z-fighting with the panorama texture
            const hit = intersects[0].point.clone(); // ~radius 500
            hit.setLength(490); // 500 * 0.98
            return hit;
        } else {
            // Fallback: project ray to the sphere radius
            const dir = this.raycaster.ray.direction.clone().normalize();
            dir.setLength(490);
            return dir;
        }
    }

    // Same as screenToSpherePosition but client coords relative to window
    screenToSpherePositionAtClient(clientX, clientY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        return this.screenToSpherePosition(clientX - rect.left, clientY - rect.top);
    }
    
    // ====================================
    // HOTSPOT AND CONNECTION CREATION
    // ====================================
    
    /**
     * Create hotspot at specified screen coordinates
     */
    createHotspotAt(clientX, clientY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        
        this.hotspotCreatePosition = {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
        
        this.updateTargetSceneSelect();
        document.getElementById('add-connection-modal').style.display = 'block';
        this.toggleHotspotMode();
    }
    
    /**
     * Update target scene selection dropdown
     */
    updateTargetSceneSelect() {
        const select = document.getElementById('target-scene');
        select.innerHTML = '<option value="">Select target scene...</option>';
        
        this.scenes.forEach(scene => {
            if (scene.id !== this.currentSceneId) {
                const option = document.createElement('option');
                option.value = scene.id;
                option.textContent = scene.name;
                select.appendChild(option);
            }
        });
    }
    
    /**
     * Toggle hotspot creation mode
     */
    toggleHotspotMode() {
        this.isHotspotMode = !this.isHotspotMode;
        const indicator = document.getElementById('hotspot-mode');
        indicator.style.display = this.isHotspotMode ? 'block' : 'none';
        
        const btn = document.querySelector('[onclick="toggleHotspotMode()"]');
        if (btn) {
            btn.textContent = this.isHotspotMode ? '❌ Cancel' : '🔗 Link Hotspot';
        }
        
        // Update button states
        if (this.isHotspotMode) {
            setBottomToolbarButtonStates('linkHotspot');
        } else {
            setBottomToolbarButtonStates(null); // Reset all buttons
        }
    }
    
    /**
     * Delete connection by ID
     */
    deleteConnection(connectionId) {
        if (confirm('Are you sure you want to delete this connection?')) {
            if (window.app && window.app.socket) {
                window.app.socket.send(JSON.stringify({
                    action: "EditTour",
                    data: { tour_id: this.currentTourId, editor_action: { action: "DeleteConnection", data: { connection_id: connectionId } } }
                }));
            }
        }
    }

    openEditConnectionModal(connection) {
        this.activeConnectionForEdit = connection;
        // Populate target scenes
        const select = document.getElementById('edit-target-scene');
        if (select) {
            select.innerHTML = '<option value="">Select target scene...</option>';
            this.scenes.forEach(scene => {
                if (scene.id !== this.currentSceneId) {
                    const opt = document.createElement('option');
                    opt.value = scene.id;
                    opt.textContent = scene.name;
                    if (scene.id === connection.target_scene_id) opt.selected = true;
                    select.appendChild(opt);
                }
            });
        }
        // Display current lon/lat
        const coordEl = document.getElementById('edit-connection-coords');
        if (coordEl && connection.position) {
            const [lon, lat] = Array.isArray(connection.position) ? connection.position : [connection.position.x, connection.position.y];
            coordEl.textContent = `Lon: ${lon?.toFixed ? lon.toFixed(2) : lon}, Lat: ${lat?.toFixed ? lat.toFixed(2) : lat}`;
        }
        const modal = document.getElementById('edit-connection-modal');
        if (modal) modal.style.display = 'block';
    }

    closeEditConnectionModal() {
        const modal = document.getElementById('edit-connection-modal');
        if (modal) modal.style.display = 'none';
        this.activeConnectionForEdit = null;
    }

    confirmEditConnection() {
        if (!this.activeConnectionForEdit) return;
        const connection = this.activeConnectionForEdit;
        const select = document.getElementById('edit-target-scene');
        const newTargetId = select && select.value ? parseInt(select.value, 10) : connection.target_scene_id;
    const nameInput = document.getElementById('edit-connection-name');
    const newName = nameInput ? nameInput.value : connection.name || null;

        // Ensure we have lon/lat from current sprite (in case user dragged before opening modal)
        const entry = this.connectionSprites.find(e => e.connection.id === connection.id);
        if (entry) {
            const { lon, lat } = this.vectorToLonLatDeg(entry.sprite.position);
            connection.position = [parseFloat(lon.toFixed(2)), parseFloat(lat.toFixed(2))];
        }

        // Update local state
        connection.target_scene_id = newTargetId;
        connection.name = newName;
        this.sendEditConnection(connection.id, newTargetId, connection.position, newName);
        this.showSuccess('Connection updated');
        this.closeEditConnectionModal();
    }

    sendEditConnection(connectionId, newAssetId, newPosition, newName = null) {
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "EditConnection",
                        data: {
                            connection_id: parseInt(connectionId, 10),
                            new_asset_id: parseInt(newAssetId, 10),
                            new_position: [Number(newPosition[0]), Number(newPosition[1])],
                            new_name: newName
                        }
                    }
                }
            }));
        }
    }
    
    // ====================================
    // MODAL MANAGEMENT
    // ====================================
    
    /**
     * Show add scene modal
     */
    showAddSceneModal() {
        document.getElementById('add-scene-modal').style.display = 'block';
    }
    
    /**
     * Confirm and add new scene(s)
     */
    async confirmAddScene() {
        if (this.uploadedFiles.length === 0) {
            alert('Please upload at least one 360-degree image');
            return;
        }

        // Show progress indication
        const progressContainer = this.showUploadProgress();
        let successCount = 0;
        let failureCount = 0;

        try {
            for (let i = 0; i < this.uploadedFiles.length; i++) {
                const file = this.uploadedFiles[i];
                this.updateUploadProgress(progressContainer, i + 1, this.uploadedFiles.length, file.name);

                try {
                    const filePath = await this.uploadSingleFile(file);
                    if (filePath) {
                        const sceneName = this.generateDefaultSceneName(file);
                        this.sendAddSceneMessage(sceneName, filePath);
                        successCount++;
                    } else {
                        failureCount++;
                    }
                } catch (error) {
                    console.error('Error uploading file:', file.name, error);
                    failureCount++;
                }
            }

            // Show completion message
            this.hideUploadProgress();
            if (successCount > 0) {
                const message = this.uploadedFiles.length === 1 
                    ? 'Scene uploaded successfully!'
                    : `${successCount} scenes uploaded successfully${failureCount > 0 ? `, ${failureCount} failed` : ''}!`;
                this.showNotification(message, 'success');
            }
            if (failureCount > 0 && successCount === 0) {
                this.showNotification('Failed to upload scenes', 'error');
            }

        } catch (error) {
            console.error('Error during upload process:', error);
            this.hideUploadProgress();
            this.showNotification('Error occurred during upload', 'error');
        }

        this.closeAddSceneModal();
    }
    
    /**
     * Generate default scene name from file
     */
    generateDefaultSceneName(file) {
        if (file && file.name) {
            // Use the original filename without extension
            return file.name.replace(/\.[^/.]+$/, '');
        } else {
            // Fallback for file path
            const filename = file.split('/').pop();
            return filename.replace(/\.[^/.]+$/, '');
        }
    }
    
    /**
     * Upload a single file to server
     */
    async uploadSingleFile(file) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', 'insta360');
            
            const response = await fetch('/upload-asset', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                return result.file_path;
            } else {
                console.error(`Failed to upload file: ${file.name}`);
                return null;
            }
        } catch (error) {
            console.error('Upload error for file:', file.name, error);
            return null;
        }
    }
    
    /**
     * Show upload progress indicator
     */
    showUploadProgress() {
        const modal = document.getElementById('add-scene-modal');
        const modalBody = modal.querySelector('.modal-body');
        
        // Create progress container
        const progressContainer = document.createElement('div');
        progressContainer.className = 'upload-progress-container';
        progressContainer.innerHTML = `
            <div class="upload-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text">Starting upload...</div>
            </div>
        `;
        
        modalBody.appendChild(progressContainer);
        
        // Disable buttons
        const cancelBtn = modal.querySelector('.btn:not(.success)');
        const addBtn = modal.querySelector('.btn.success');
        cancelBtn.disabled = true;
        addBtn.disabled = true;
        addBtn.textContent = 'Uploading...';
        
        return progressContainer;
    }

    /**
     * Update upload progress
     */
    updateUploadProgress(progressContainer, current, total, fileName) {
        const progressFill = progressContainer.querySelector('.progress-fill');
        const progressText = progressContainer.querySelector('.progress-text');
        
        const percentage = (current / total) * 100;
        progressFill.style.width = `${percentage}%`;
        progressText.textContent = `Uploading ${current}/${total}: ${fileName}`;
    }

    /**
     * Hide upload progress indicator
     */
    hideUploadProgress() {
        const progressContainer = document.querySelector('.upload-progress-container');
        if (progressContainer) {
            progressContainer.remove();
        }
        
        // Re-enable buttons
        const modal = document.getElementById('add-scene-modal');
        const cancelBtn = modal.querySelector('.btn:not(.success)');
        const addBtn = modal.querySelector('.btn.success');
        cancelBtn.disabled = false;
        addBtn.disabled = false;
        addBtn.textContent = 'Add Scene(s)';
    }

    /**
     * Send add scene message to server
     */
    sendAddSceneMessage(sceneName, filePath) {
        if (window.app?.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "AddScene",
                        data: {
                            name: sceneName,
                            file_path: filePath
                        }
                    }
                }
            }));
        }
    }
    
    closeAddSceneModal() {
        document.getElementById('add-scene-modal').style.display = 'none';
        document.getElementById('file-upload').value = '';
        this.uploadedFiles = [];
        
        // Reset upload area
        this.updateUploadAreaDisplay();
        
        // Clean up any progress indicators
        this.hideUploadProgress();
    }

    confirmAddConnection() {
        const targetSceneId = document.getElementById('target-scene').value;
        const nameInput = document.getElementById('connection-name');
        if (!targetSceneId || !this.hotspotCreatePosition) {
            alert('Please select a target scene');
            return;
        }
        // Convert click to world-space direction, then to stable lon/lat degrees
        const dir = this.screenToWorldDirection(this.hotspotCreatePosition.x, this.hotspotCreatePosition.y);
        const { lon, lat } = this.vectorToLonLatDeg(dir);
        const name = nameInput ? nameInput.value : null;

        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "AddConnection",
                        data: {
                            start_scene_id: parseInt(this.currentSceneId),
                            asset_id: parseInt(targetSceneId),
                            // Store lon/lat degrees for stable, view-independent placement
                            position: [
                                Math.round(lon * 100) / 100,
                                Math.round(lat * 100) / 100
                            ],
                            name: name && name.length ? name : null
                        }
                    }
                }
            }));
        }
        
        this.closeAddConnectionModal();
    }
    
    closeAddConnectionModal() {
        document.getElementById('add-connection-modal').style.display = 'none';
        this.hotspotCreatePosition = null;
        // Clear mouse state when closing modal to prevent stuck mouse down state
        this.clearMouseState();
    }
    
    // ====================================
    // SCENE MANAGEMENT ACTIONS
    // ====================================
    
    toggleSceneOptions(sceneId, event) {
        event.stopPropagation();
        
        // Close all other dropdowns first
        document.querySelectorAll('.scene-options-dropdown').forEach(dropdown => {
            if (dropdown.id !== `options-${sceneId}`) {
                dropdown.classList.remove('show');
            }
        });
        
        // Toggle the clicked dropdown
        const dropdown = document.getElementById(`options-${sceneId}`);
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    }
    
    closeAllDropdowns() {
        document.querySelectorAll('.scene-options-dropdown').forEach(dropdown => {
            dropdown.classList.remove('show');
        });
    }
    
    setSceneAsInitial(sceneId) {
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "SetInitialScene",
                        data: { scene_id: parseInt(sceneId) }
                    }
                }
            }));
        }
        this.closeAllDropdowns();
        this.showSuccess('Initial scene has been updated successfully');
    }
    
    swapScene(sceneId) {
        // Implementation for swapping scene
        alert('Scene swap feature not yet implemented');
        this.closeAllDropdowns();
    }
    
    deleteScene(sceneId) {
        if (confirm('Are you sure you want to delete this scene?')) {
            if (window.app && window.app.socket) {
                window.app.socket.send(JSON.stringify({
                    action: "EditTour",
                    data: {
                        tour_id: this.currentTourId,
                        editor_action: {
                            action: "DeleteScene",
                            data: { scene_id: parseInt(sceneId) }
                        }
                    }
                }));
            }
        }
        this.closeAllDropdowns();
    }
    
    updateSceneName(sceneId, newName) {
        const trimmedName = newName.trim();
        if (!trimmedName) {
            // Restore original name if empty
            this.updateSceneGallery();
            return;
        }
        
        // Update local data immediately for responsive UI
        if (this.tourData && this.tourData.scenes) {
            const scene = this.tourData.scenes.find(s => s.id == sceneId);
            if (scene) {
                scene.name = trimmedName;
                
                // Update the header if this is the current scene
                if (this.currentSceneId == sceneId) {
                    const sceneNameElement = document.getElementById('current-scene-name');
                    if (sceneNameElement) {
                        sceneNameElement.textContent = trimmedName;
                    }
                }
            }
        }
        
        // Send update to server
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "UpdateSceneName",
                        data: { 
                            scene_id: parseInt(sceneId),
                            name: trimmedName 
                        }
                    }
                }
            }));
        }
    }
    
    /**
     * Get current scene's initial view settings
     */
    getCurrentSceneInitialView() {
        if (!this.tourData || !this.tourData.scenes || !this.currentSceneId) {
            console.log('No scene data available');
            return null;
        }
        
        const currentScene = this.tourData.scenes.find(s => s.id == this.currentSceneId);
        if (!currentScene) {
            console.log('Current scene not found');
            return null;
        }
        
        const initialView = {
            scene_name: currentScene.name,
            scene_id: currentScene.id,
            initial_lon: currentScene.initial_view_x || 'Not set',
            initial_lat: currentScene.initial_view_y || 'Not set',
            initial_fov: currentScene.initial_fov || 'Not set'
        };
        
        console.log('Current scene initial view settings:', initialView);
        return initialView;
    }
    
    /**
     * Get current camera position information
     * Can be called from browser console: editor.getCurrentPosition()
     */
    getCurrentPosition() {
        const position = {
            longitude: parseFloat(this.lon.toFixed(2)),
            latitude: parseFloat(this.lat.toFixed(2)),
            fov: parseFloat(this.camera.fov.toFixed(1)),
            scene_id: this.currentSceneId,
            scene_name: this.getCurrentSceneName()
        };
        
        console.log('Current Camera Position:', position);
        return position;
    }
    
    /**
     * Get current scene name
     */
    getCurrentSceneName() {
        if (!this.tourData || !this.tourData.scenes || !this.currentSceneId) {
            return 'No scene loaded';
        }
        
        const currentScene = this.tourData.scenes.find(s => s.id == this.currentSceneId);
        return currentScene ? currentScene.name : 'Unknown scene';
    }
    
    /**
     * Start periodic position logging (useful for debugging)
     */
    startPositionLogging(intervalMs = 2000) {
        if (this.positionLoggingInterval) {
            clearInterval(this.positionLoggingInterval);
        }
        
        this.positionLoggingInterval = setInterval(() => {
            this.getCurrentPosition();
        }, intervalMs);
        
        console.log(`Started position logging every ${intervalMs}ms. Call editor.stopPositionLogging() to stop.`);
    }
    
    /**
     * Stop periodic position logging
     */
    stopPositionLogging() {
        if (this.positionLoggingInterval) {
            clearInterval(this.positionLoggingInterval);
            this.positionLoggingInterval = null;
            console.log('Stopped position logging');
        }
    }
    
    // ====================================
    // CAMERA CONTROLS
    // ====================================
    
    resetView() {
        if (this.tourData && this.tourData.scenes && this.currentSceneId) {
            // Reset to the current scene's initial view if available
            const currentScene = this.tourData.scenes.find(s => s.id == this.currentSceneId);
            if (currentScene) {
                this.lon = currentScene.initial_view_x !== undefined ? currentScene.initial_view_x : 0;
                this.lat = currentScene.initial_view_y !== undefined ? currentScene.initial_view_y : 0;
                this.camera.fov = currentScene.initial_fov !== undefined ? currentScene.initial_fov : 75;
                console.log(`Reset view to scene "${currentScene.name}" initial values: lon=${this.lon}°, lat=${this.lat}°, fov=${this.camera.fov}°`);
            } else {
                // Fallback to default values
                this.lon = 0;
                this.lat = 0;
                this.camera.fov = 75;
            }
        } else {
            // Default values when no scene data available
            this.lon = 0;
            this.lat = 0;
            this.camera.fov = 75;
        }
        
        this.camera.updateProjectionMatrix();
        this.updateCamera();
    }
    
    setInitialView() {
        if (!this.currentSceneId) return;
        
        // Check if currently in initial view mode
        const btn = document.querySelector('[onclick="setInitialView()"]');
        const isCurrentlyActive = btn && btn.classList.contains('active');
        
        if (isCurrentlyActive) {
            // Cancel initial view mode
            setBottomToolbarButtonStates(null);
            this.showInfo("Initial view mode cancelled");
            return;
        }
        
        // Activate initial view mode first
        setBottomToolbarButtonStates('initialView');
        
        // Update local scene data immediately
        if (this.tourData && this.tourData.scenes) {
            const currentScene = this.tourData.scenes.find(s => s.id == this.currentSceneId);
            if (currentScene) {
                currentScene.initial_view_x = Math.round(this.lon);
                currentScene.initial_view_y = Math.round(this.lat);
                currentScene.initial_fov = Math.round(this.camera.fov);
            }
        }
        
        // Send initial view position to server
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "SetInitialView",
                        data: {
                            scene_id: parseInt(this.currentSceneId, 10),
                            position: [Math.round(this.lon), Math.round(this.lat)],
                            fov: Math.round(this.camera.fov)
                        }
                    }
                }
            }));
        }
        
        // Reset button states after saving
        setTimeout(() => {
            setBottomToolbarButtonStates(null);
        }, 100);
    }
    
    setNorthDirection() {
        if (!this.currentSceneId) return;
        
        // Send north direction to server
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "SetNorthDirection",
                        data: {
                            scene_id: parseInt(this.currentSceneId),
                            direction: Math.round(this.lon)
                        }
                    }
                }
            }));
        }
        
        alert('North direction saved');
    }
}

// ====================================
// GLOBAL FUNCTIONS FOR UI INTERACTION
// ====================================

let editor;

window.addEventListener('DOMContentLoaded', () => {
    editor = new VirtualTourEditor();
});

// Global function wrappers that delegate to the editor instance
function toggleHotspotMode() {
    // Clear mouse state immediately when button is clicked
    if (editor && typeof editor.clearMouseState === 'function') {
        editor.clearMouseState();
    }
    
    if (editor) editor.toggleHotspotMode();
}

function resetView() {
    if (editor) editor.resetView();
}

function showAddSceneModal() {
    if (editor) editor.showAddSceneModal();
}

function closeAddSceneModal() {
    if (editor) editor.closeAddSceneModal();
}

function confirmAddScene() {
    if (editor) editor.confirmAddScene();
}

function closeAddConnectionModal() {
    if (editor) editor.closeAddConnectionModal();
}

function confirmAddConnection() {
    if (editor) editor.confirmAddConnection();
}

// Wrappers for Edit Connection modal buttons
function confirmEditConnection() {
    if (editor) editor.confirmEditConnection();
}
function deleteActiveConnection() {
    if (editor && editor.activeConnectionForEdit) editor.deleteConnection(editor.activeConnectionForEdit.id);
}
function closeEditConnectionModal() {
    if (editor) editor.closeEditConnectionModal();
}

function addInfospot() {
    // Clear mouse state immediately when button is clicked
    if (editor && typeof editor.clearMouseState === 'function') {
        editor.clearMouseState();
    }
    
    // Toggle infospot mode
    const isCurrentlyActive = document.querySelector('[onclick="addInfospot()"]').classList.contains('active');
    
    if (isCurrentlyActive) {
        // Cancel infospot mode
        setBottomToolbarButtonStates(null);
        if (editor) editor.showInfo('Infospot mode cancelled');
    } else {
        // Activate infospot mode
        setBottomToolbarButtonStates('infospot');
        if (editor) editor.showInfo('Infospot mode activated - Click on the panorama to add an infospot', 'Infospot Mode');
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function setInitialView() {
    // Clear mouse state immediately when button is clicked
    if (editor && typeof editor.clearMouseState === 'function') {
        editor.clearMouseState();
    }
    
    if (editor) editor.setInitialView();
}

function setNorthDirection() {
    if (editor) editor.setNorthDirection();
}

// change to export tour to package as standalone folder ***
// function saveTour() {
//     if (editor) {
//         editor.showSuccess('Tour has been saved successfully!');
//     }
// }

function goHome() {
    localStorage.removeItem('currentTourId');
    window.location.href = '/homepage';
}

function sortScenes() {
    alert('Sort scenes feature not yet implemented');
}

// Scene management functions
function toggleSceneOptions(sceneId, event) {
    if (editor) editor.toggleSceneOptions(sceneId, event);
}

function setSceneAsInitial(sceneId) {
    if (editor) editor.setSceneAsInitial(sceneId);
}

function swapScene(sceneId) {
    if (editor) editor.swapScene(sceneId);
}

function deleteScene(sceneId) {
    if (editor) editor.deleteScene(sceneId);
}

function updateSceneName(sceneId, newName) {
    if (editor) editor.updateSceneName(sceneId, newName);
}

// Modal and general event management
window.addEventListener('click', (event) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
            // Clear mouse state when modal is closed to prevent stuck mouse down state
            if (editor && typeof editor.clearMouseState === 'function') {
                editor.clearMouseState();
            }
        }
    });
});

// Button state management for bottom toolbar
function setBottomToolbarButtonStates(activeButtonType) {
    const buttons = {
        infospot: document.querySelector('[onclick="addInfospot()"]'),
        linkHotspot: document.querySelector('[onclick="toggleHotspotMode()"]'),
        initialView: document.querySelector('[onclick="setInitialView()"]')
    };
    
    // Reset all buttons to normal state
    Object.values(buttons).forEach(btn => {
        if (btn) {
            btn.classList.remove('active', 'disabled');
        }
    });
    
    // Set active button and disable others
    if (activeButtonType && buttons[activeButtonType]) {
        buttons[activeButtonType].classList.add('active');
        
        // Disable other buttons
        Object.keys(buttons).forEach(type => {
            if (type !== activeButtonType && buttons[type]) {
                buttons[type].classList.add('disabled');
            }
        });
    }
    
    // Clear mouse state when resetting button states to prevent stuck mouse down
    if (editor && typeof editor.clearMouseState === 'function') {
        editor.clearMouseState();
    }
}

function returnToHomepage() {
    localStorage.removeItem('currentTourId');
    window.location.href = '/static/homepage.html';
}