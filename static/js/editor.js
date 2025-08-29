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
        this.connectionSprites = []; // Track active 3D sprites (connections + closeups)
    this.pendingConnections = []; // Track optimistic adds awaiting server IDs
    this.pendingCloseups = []; // Track optimistic closeups awaiting server IDs
    this.connectionBaseScale = 32; // base world-unit size for sprites at fov=75
    this.pointerDownOnSprite = null; // { sprite, connection, downX, downY }
    this.dragHoldTimer = null;
    this.isDraggingConnection = false;
        
        // File upload management
        this.uploadedFiles = [];
        
    // User interaction state
        this.isHotspotMode = false;
        this.hotspotCreatePosition = null;
    this.isCloseupMode = false;
    this.closeupCreatePosition = null;
        
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
        
    // Create panorama sphere with higher tessellation to reduce visible curvature artefacts
    // Increased segments (was 32,16). Balance quality vs perf; adjust if perf drops.
    const sphereGeometry = new THREE.SphereGeometry(500, 120, 80);
        sphereGeometry.scale(-1, 1, 1);
        
    const sphereMaterial = new THREE.MeshBasicMaterial();
    // When a texture is later assigned, ensure max anisotropy + mipmap filtering for crisper verticals
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
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

        // Global keyboard shortcuts while modals are open
        document.addEventListener('keydown', (e) => this.onDocumentKeyDown(e));

        // Scene sort controls
        const modeSel = document.getElementById('scene-sort-mode');
        const dirBtn = document.getElementById('scene-sort-direction');
        if (modeSel && dirBtn) {
            modeSel.addEventListener('change', ()=> this.applyAndPersistSceneSort());
            dirBtn.addEventListener('click', (e)=> { e.preventDefault(); this.toggleSortDirection(); });
        }
    }

    /**
     * Handle Enter/Escape keys to confirm/cancel when a modal is open
     */
    onDocumentKeyDown(event) {
        const key = event.key;
        const isEnter = key === 'Enter';
        const isEscape = key === 'Escape' || key === 'Esc';
        if (!isEnter && !isEscape) return;

        // Helper to detect if a modal is visible
        const isVisible = (el) => !!el && (el.style.display === 'block' || el.style.display === 'flex');

        const editModal = document.getElementById('edit-connection-modal');
        const addConnModal = document.getElementById('add-connection-modal');
        const addSceneModal = document.getElementById('add-scene-modal');
        const addCloseupModal = document.getElementById('add-closeup-modal');
        const editCloseupModal = document.getElementById('edit-closeup-modal');

        // Priority: act on the topmost visible modal (edit > add-connection > add-scene)
        if (isVisible(editModal)) {
            event.preventDefault();
            if (isEnter) this.confirmEditConnection();
            else if (isEscape) this.closeEditConnectionModal();
            return;
        }
        if (isVisible(addConnModal)) {
            event.preventDefault();
            if (isEnter) this.confirmAddConnection();
            else if (isEscape) this.closeAddConnectionModal();
            return;
        }
        if (isVisible(addSceneModal)) {
            event.preventDefault();
            if (isEnter) this.confirmAddScene();
            else if (isEscape) this.closeAddSceneModal();
            return;
        }
        if (isVisible(addCloseupModal)) {
            event.preventDefault();
            if (isEnter) this.confirmAddCloseup();
            else if (isEscape) this.closeAddCloseupModal();
            return;
        }
        if (isVisible(editCloseupModal)) {
            event.preventDefault();
            if (isEnter) this.confirmEditCloseup();
            else if (isEscape) this.closeEditCloseupModal();
            return;
        }
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

        // Closeup add modal DnD
        const cuInput = document.getElementById('closeup-file');
        const cuArea = document.querySelector('#add-closeup-modal .closeup-upload-area');
        if (cuInput && cuArea) {
            cuInput.addEventListener('change', () => this.updateCloseupUploadArea(cuArea, cuInput));
            ['dragover','dragleave','drop'].forEach(evt => {
                cuArea.addEventListener(evt, (e) => {
                    e.preventDefault();
                    if (evt === 'dragover') cuArea.classList.add('drag-over');
                    if (evt === 'dragleave') cuArea.classList.remove('drag-over');
                    if (evt === 'drop') {
                        cuArea.classList.remove('drag-over');
                        const files = e.dataTransfer.files;
                        if (files && files.length === 1) {
                            cuInput.files = files;
                            this.updateCloseupUploadArea(cuArea, cuInput);
                        }
                    }
                });
            });
        }

        // Closeup edit modal DnD
        const ecuInput = document.getElementById('edit-closeup-file');
        const ecuArea = document.querySelector('#edit-closeup-modal .edit-closeup-upload-area');
        if (ecuInput && ecuArea) {
            ecuInput.addEventListener('change', () => this.updateCloseupUploadArea(ecuArea, ecuInput));
            ['dragover','dragleave','drop'].forEach(evt => {
                ecuArea.addEventListener(evt, (e) => {
                    e.preventDefault();
                    if (evt === 'dragover') ecuArea.classList.add('drag-over');
                    if (evt === 'dragleave') ecuArea.classList.remove('drag-over');
                    if (evt === 'drop') {
                        ecuArea.classList.remove('drag-over');
                        const files = e.dataTransfer.files;
                        if (files && files.length === 1) {
                            ecuInput.files = files;
                            this.updateCloseupUploadArea(ecuArea, ecuInput);
                        }
                    }
                });
            });
        }
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

    // Update a specific closeup modal upload area preview
    updateCloseupUploadArea(areaEl, inputEl) {
        if (!areaEl || !inputEl) return;
        const files = inputEl.files || [];
        if (!files.length) {
            // If it's the edit modal and there's an existing image, show it
            const isEdit = areaEl.classList.contains('edit-closeup-upload-area');
            const existing = isEdit && this.activeCloseupForEdit && this.activeCloseupForEdit.file_path
                ? this.activeCloseupForEdit.file_path
                : null;
            if (existing) {
                const base = existing.split('/').pop();
                areaEl.innerHTML = `
                    <img src="${existing}" alt="Current closeup" style="max-width:100%;max-height:160px;display:block;margin:6px auto 8px;border-radius:6px;object-fit:contain;" />
                    <div class="upload-text">Current file: ${base}</div>
                    <div class="upload-hint">Click to replace or drag & drop a new image</div>
                `;
                return;
            }
            areaEl.innerHTML = `
                <div class="upload-icon">📷</div>
                <div class="upload-text">Click to upload or drag & drop</div>
                <div class="upload-hint">JPG or PNG, up to ~100MB</div>
            `;
            return;
        }
        const f = files[0];
        areaEl.innerHTML = `
            <div class="upload-icon">✅</div>
            <div class="upload-text">Selected: ${f.name}</div>
            <div class="upload-hint">Click to change file</div>
        `;
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
        if (this.isCloseupMode) {
            this.createCloseupAt(event.clientX, event.clientY);
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

            // Treat as click: ctrl+click performs action, else open edit modal
            const isCloseup = String(connection.connection_type).toLowerCase() === 'closeup';
            if (event.ctrlKey) {
                if (isCloseup) {
                    // Open closeup image in internal viewer if available
                    const path = connection.file_path || (connection.asset_path);
                    if (path) this.openImageViewer(path);
                } else {
                    // Be tolerant of string/number mismatches for IDs
                    let targetScene = this.scenes.find(s => s.id == connection.target_scene_id);
                    if (targetScene) {
                        this.loadScene(targetScene.id);
                    } else if (connection.target_scene_id != null) {
                        // Fallback: try loading directly by the stored id
                        this.loadScene(connection.target_scene_id);
                    }
                }
            } else {
                if (isCloseup) this.openEditCloseupModal(connection);
                else this.openEditConnectionModal(connection);
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
        // Suppress hover/tooltip when any modal is open
        if (this.isAnyModalOpen && this.isAnyModalOpen()) {
            this.hideTooltip();
            return;
        }
        const hit = this.getSpriteUnderPointer(clientX, clientY);
        const canvas = document.getElementById('viewer-canvas');
        if (hit && !this.isDraggingConnection) {
            canvas.style.cursor = 'pointer';
            // Show tooltip with connection name or target scene name
            const conn = hit.connection;
            let label = '';
            if (conn) {
                if (String(conn.connection_type).toLowerCase() === 'closeup') {
                    label = conn.name || 'Closeup';
                } else {
                    label = conn.name || this.getSceneName(conn.target_scene_id) || '';
                }
            }
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
            if (this.isCloseupMode) {
                this.createCloseupAt(event.touches[0].clientX, event.touches[0].clientY);
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
            case 'sort_updated':
                if (data.mode) this.tourData.sort_mode = data.mode;
                if (data.direction) this.tourData.sort_direction = data.direction;
                this.updateSceneGallery();
                break;
            case 'floorplan_added':
                this.tourData.floorplan = data.floorplan;
                this.tourData.has_floorplan = true;
                this.onFloorplanAdded(data.floorplan);
                break;
            case 'floorplan_deleted':
                this.tourData.floorplan = null;
                this.tourData.has_floorplan = false;
                this.onFloorplanDeleted(data.floorplan_id);
                break;
            case 'floorplan_marker_added':
                if (!this.tourData.floorplan_markers) this.tourData.floorplan_markers=[];
                this.tourData.floorplan_markers.push(data.marker);
                this.renderFloorplanMarkers();
                break;
            case 'floorplan_marker_updated':
                if (this.tourData.floorplan_markers) {
                    const m = this.tourData.floorplan_markers.find(mm=>mm.id==data.marker_id);
                    if (m) m.position=data.position;
                }
                this.renderFloorplanMarkers();
                break;
            case 'floorplan_marker_deleted':
                if (this.tourData.floorplan_markers) {
                    this.tourData.floorplan_markers = this.tourData.floorplan_markers.filter(m=>m.id!=data.marker_id);
                }
                this.renderFloorplanMarkers();
                break;
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
                // If server ever sends full connection object
                this.addConnectionToScene(data.connection);
                this.showSuccess('Connection created successfully');
                break;
            case 'connection_added':
                // Backend currently sends this minimal ack: {connection_id, start_scene, target_scene}
                this.reconcileConnectionAdded(data);
                break;
            case 'connection_deleted':
                // Remove connection marker and local state when backend confirms deletion
                if (data.connection_id !== undefined) {
                    const id = parseInt(data.connection_id, 10);
                    this.removeConnectionLocally(id);
                }
                break;
            case 'closeup_added':
                // Backend ack for adding a closeup; contains connection_id, parent_scene, file_path
                this.reconcileCloseupAdded(data);
                this.showSuccess('Closeup created successfully');
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

    // Initialize floorplan if present
    this.initFloorplanFromTour(tourData);
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
            // location removed
            'tour-subtitle': '',
            'current-scene-name': this.tourData.scenes?.length > 0 ? 'Select a scene' : 'No scenes available',
            'tour-info': '' // Leave empty since we removed scene count
        };
        
        Object.entries(elements).forEach(([id, text]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = text;
        });

        // Set sort controls to reflect current state
        const modeSel = document.getElementById('scene-sort-mode');
        const dirBtn = document.getElementById('scene-sort-direction');
    if (modeSel) modeSel.value = this.tourData.sort_mode || 'created_at';
        if (dirBtn) dirBtn.textContent = (this.tourData.sort_direction || 'asc') === 'asc' ? '▲' : '▼';
    }

    toggleSortDirection() {
        this.tourData.sort_direction = (this.tourData.sort_direction === 'desc') ? 'asc' : 'desc';
        const dirBtn = document.getElementById('scene-sort-direction');
        if (dirBtn) dirBtn.textContent = this.tourData.sort_direction === 'asc' ? '▲' : '▼';
        this.applyAndPersistSceneSort();
    }

    applyAndPersistSceneSort() {
        const modeSel = document.getElementById('scene-sort-mode');
        if (modeSel) this.tourData.sort_mode = modeSel.value;
        // Re-render gallery
        this.updateSceneGallery();
        // Persist via websocket action
        if (window.app?.socket?.readyState === WebSocket.OPEN) {
            window.app.socket.send(JSON.stringify({ action: 'EditTour', data: { tour_id: this.currentTourId, editor_action: { action: 'SetSceneSort', data: { mode: this.tourData.sort_mode, direction: this.tourData.sort_direction } } } }));
        }
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

        // Apply current sort if present
    const mode = this.tourData.sort_mode || 'created_at';
        const direction = this.tourData.sort_direction || 'asc';
        const scenesCopy = [...this.tourData.scenes];
        scenesCopy.sort((a,b)=>{
            let res = 0;
            if (mode === 'alphabetical') {
                res = a.name.localeCompare(b.name);
            } else if (mode === 'created_at') {
                res = (a.created_at||'').localeCompare(b.created_at||'');
            } else if (mode === 'modified_at') {
                res = (a.modified_at||'').localeCompare(b.modified_at||'');
            }
            return direction === 'asc' ? res : -res;
        });
        this.sortedScenes = scenesCopy; // cache if needed
        
        scenesCopy.forEach(scene => {
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
        if (this.maxAnisotropy) {
            texture.anisotropy = this.maxAnisotropy;
        }
        
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

        // Choose sprite icon based on connection type
        let iconPath = '/static/assets/transition_icon.png?v=2';
        if (String(connection.connection_type).toLowerCase() === 'closeup') {
            const idx = connection.icon_index || 1; // 1..3
            const clamped = Math.max(1, Math.min(3, parseInt(idx, 10) || 1));
            iconPath = `/static/assets/info${clamped}_icon.png`;
        }

        // Create sprite material
        const spriteMap = new THREE.TextureLoader().load(iconPath);
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
        this.hideTooltip();
        document.getElementById('add-connection-modal').style.display = 'block';
        this.toggleHotspotMode();
    }

    /** Create closeup at specified screen coordinates */
    createCloseupAt(clientX, clientY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        this.closeupCreatePosition = { x: clientX - rect.left, y: clientY - rect.top };
        const modal = document.getElementById('add-closeup-modal');
        this.hideTooltip();
        if (modal) {
            // Reset fields to avoid carry-over between openings
            this.resetAddCloseupModal();
            modal.style.display = 'block';
        }
        this.toggleCloseupMode();
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

    toggleCloseupMode() {
        this.isCloseupMode = !this.isCloseupMode;
        const btn = document.querySelector('[onclick="addInfospot()"]');
        if (btn) btn.classList.toggle('active', this.isCloseupMode);
        if (this.isCloseupMode) setBottomToolbarButtonStates('infospot');
        else setBottomToolbarButtonStates(null);
    }
    
    /**
     * Delete connection by ID
     */
    deleteConnection(connectionId) {
        if (!connectionId) return;
        if (!confirm('Are you sure you want to delete this connection?')) return;

        // Optimistically remove from UI
        this.removeConnectionLocally(parseInt(connectionId, 10));

        // Close modal if open
        this.closeEditConnectionModal();

        // Notify backend
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: { tour_id: this.currentTourId, editor_action: { action: "DeleteConnection", data: { connection_id: parseInt(connectionId, 10) } } }
            }));
        }
    }

    // Remove a connection's sprite and data locally
    removeConnectionLocally(connectionId) {
        // Remove sprite
        const idx = this.connectionSprites.findIndex(e => e.connection && e.connection.id == connectionId);
        if (idx !== -1) {
            const entry = this.connectionSprites[idx];
            if (entry && entry.sprite) {
                this.scene.remove(entry.sprite);
            }
            this.connectionSprites.splice(idx, 1);
        }

        // Clear hover/drag state if it referenced this sprite
        if (this.pointerDownOnSprite && this.pointerDownOnSprite.connection && this.pointerDownOnSprite.connection.id == connectionId) {
            this.pointerDownOnSprite = null;
            this.isDraggingConnection = false;
            this.blockPan = false;
            document.getElementById('viewer-canvas').style.cursor = '';
        }
        this.hideTooltip();

        // Remove from current scene connections
        const scene = (this.scenes || []).find(s => s.id == this.currentSceneId);
        if (scene && Array.isArray(scene.connections)) {
            scene.connections = scene.connections.filter(c => c.id != connectionId);
        }

        // Also prune from tourData if present
        if (this.tourData && Array.isArray(this.tourData.scenes)) {
            const tScene = this.tourData.scenes.find(s => s.id == this.currentSceneId);
            if (tScene && Array.isArray(tScene.connections)) {
                tScene.connections = tScene.connections.filter(c => c.id != connectionId);
            }
        }
    }

    openEditConnectionModal(connection) {
        // Hide any lingering tooltip when opening a modal
        this.hideTooltip();
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
        // Prefill the name input: custom name if present, otherwise target scene name
        const nameInput = document.getElementById('edit-connection-name');
        if (nameInput) {
            const targetScene = this.scenes.find(s => s.id === connection.target_scene_id);
            const defaultName = targetScene ? targetScene.name : '';
            nameInput.value = (connection && connection.name) ? connection.name : defaultName;
            // Helpful placeholder (kept same as default in case user clears the field)
            nameInput.placeholder = defaultName || 'e.g. Lobby → Hatches';
        }
        const modal = document.getElementById('edit-connection-modal');
        if (modal) modal.style.display = 'block';
    }

    closeEditConnectionModal() {
        const modal = document.getElementById('edit-connection-modal');
        if (modal) modal.style.display = 'none';
        // Clear any transient values so they don't leak to the next open
        const nameInput = document.getElementById('edit-connection-name');
        if (nameInput) {
            nameInput.value = '';
            nameInput.placeholder = 'e.g. Lobby → Hatches';
        }
        this.activeConnectionForEdit = null;
    }

    confirmEditConnection() {
        if (!this.activeConnectionForEdit) return;
        const connection = this.activeConnectionForEdit;
        const select = document.getElementById('edit-target-scene');
        const newTargetId = select && select.value ? parseInt(select.value, 10) : connection.target_scene_id;
        const nameInput = document.getElementById('edit-connection-name');
        const typed = nameInput ? String(nameInput.value || '').trim() : '';
        const targetScene = this.scenes.find(s => s.id === newTargetId);
        // Local state: null means "use default (target scene name)"
        let newName = typed.length ? typed : null;
        if (targetScene && newName && newName === targetScene.name) {
            newName = null;
        }
        // Server intent: send empty string to clear any previous custom name when using default
        const serverName = (newName === null) ? '' : newName;

        // Ensure we have lon/lat from current sprite (in case user dragged before opening modal)
        const entry = this.connectionSprites.find(e => e.connection.id === connection.id);
        if (entry) {
            const { lon, lat } = this.vectorToLonLatDeg(entry.sprite.position);
            connection.position = [parseFloat(lon.toFixed(2)), parseFloat(lat.toFixed(2))];
        }

        // Update local state
        connection.target_scene_id = newTargetId;
    connection.name = newName;
    this.sendEditConnection(connection.id, newTargetId, connection.position, serverName);
        this.showSuccess('Connection updated');
        this.closeEditConnectionModal();
    }

    sendEditConnection(connectionId, newAssetId, newPosition, newName = null) {
        if (window.app && window.app.socket) {
            const parsedAsset = parseInt(newAssetId, 10);
            const assetIdSafe = Number.isFinite(parsedAsset) ? parsedAsset : 0;
            let iconType = null;
        let newFilePath = null;
            try {
                const all = [];
                for (const s of (this.scenes || [])) { if (Array.isArray(s.connections)) all.push(...s.connections); }
                const found = all.find(c => c.id == connectionId);
                if (found && String(found.connection_type).toLowerCase() === 'closeup') {
                    if (found.icon_index != null) iconType = parseInt(found.icon_index, 10) || 1;
            if (found.file_path) newFilePath = found.file_path;
                }
            } catch (e) {}
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "EditConnection",
                        data: {
                            connection_id: parseInt(connectionId, 10),
                            new_asset_id: assetIdSafe,
                            new_position: [Number(newPosition[0]), Number(newPosition[1])],
                new_name: newName,
                new_icon_type: iconType,
                new_file_path: newFilePath
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
        this.hideTooltip();
        document.getElementById('add-scene-modal').style.display = 'block';
    }

    // Reset Add Closeup modal fields to prevent carry-over between sessions
    resetAddCloseupModal() {
        const nameEl = document.getElementById('closeup-name');
        if (nameEl) nameEl.value = '';
        const iconEls = document.querySelectorAll('input[name="closeup-icon"]');
        if (iconEls && iconEls.length) {
            iconEls.forEach(el => { el.checked = (parseInt(el.value, 10) === 1); });
        }
        const fileEl = document.getElementById('closeup-file');
        const areaEl = document.querySelector('#add-closeup-modal .closeup-upload-area');
        if (fileEl) fileEl.value = '';
        if (areaEl && fileEl) this.updateCloseupUploadArea(areaEl, fileEl);
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
                    const fileRes = await this.uploadSingleFile(file);
                    if (fileRes && fileRes.file_path) {
                        const sceneName = this.generateDefaultSceneName(file);
                        this.sendAddSceneMessage(sceneName, fileRes.file_path);
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
    async uploadSingleFile(file, type = 'insta360') {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);
            
            const response = await fetch('/upload-asset', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                return result; // { file_path, thumbnail_path, preview_path }
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

        // Optimistic add: show immediately
        const rounded = [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
        const tempId = -Date.now();
        const optimisticConn = {
            id: tempId,
            connection_type: 'Transition',
            target_scene_id: parseInt(targetSceneId, 10),
            position: rounded,
            name: name && name.length ? name : null
        };
        const scene = this.scenes.find(s => s.id == this.currentSceneId);
        if (scene) {
            scene.connections = scene.connections || [];
            scene.connections.push(optimisticConn);
            this.addConnectionMarker(optimisticConn);
        }
        this.pendingConnections.push({
            tempId,
            start_scene: parseInt(this.currentSceneId),
            target_scene: parseInt(targetSceneId, 10),
            position: rounded,
            name: optimisticConn.name
        });

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

    // Reconcile backend ack for added connection by replacing tempId with real ID
    reconcileConnectionAdded(data) {
        const startId = parseInt(data.start_scene);
        const targetId = parseInt(data.target_scene);
        const realId = parseInt(data.connection_id);
        // Find the most recent pending matching this pair
        let idx = -1;
        for (let i = this.pendingConnections.length - 1; i >= 0; i--) {
            const p = this.pendingConnections[i];
            if (p.start_scene == startId && p.target_scene == targetId) { idx = i; break; }
        }
        if (idx === -1) return;
        const pending = this.pendingConnections.splice(idx, 1)[0];

        // Update in scenes array
        const scene = (this.scenes || []).find(s => s.id == pending.start_scene);
        if (!scene || !scene.connections) return;
        const conn = scene.connections.find(c => c.id === pending.tempId || (c.target_scene_id == targetId && Array.isArray(c.position) && c.position[0] == pending.position[0] && c.position[1] == pending.position[1]));
        if (conn) {
            conn.id = realId;
        }

        // Update in sprites list
        const entry = this.connectionSprites.find(e => e.connection && (e.connection.id === pending.tempId));
        if (entry) {
            entry.connection.id = realId;
            entry.sprite.userData.connection = entry.connection;
        }
    }
    
    closeAddConnectionModal() {
        document.getElementById('add-connection-modal').style.display = 'none';
        this.hotspotCreatePosition = null;
        // Clear mouse state when closing modal to prevent stuck mouse down state
        this.clearMouseState();
    }

    // ===== CLOSEUPS =====
    closeAddCloseupModal() {
        const modal = document.getElementById('add-closeup-modal');
        if (modal) modal.style.display = 'none';
    // Reset all inputs so nothing carries over next time
    this.resetAddCloseupModal();
        this.closeupCreatePosition = null;
        this.clearMouseState();
    }

    async confirmAddCloseup() {
        if (!this.closeupCreatePosition) {
            alert('Click on the panorama to place the closeup');
            return;
        }
        const nameEl = document.getElementById('closeup-name');
        const iconEls = document.querySelectorAll('input[name="closeup-icon"]');
        const fileEl = document.getElementById('closeup-file');
        const name = nameEl ? String(nameEl.value || '').trim() : '';
        let iconIndex = 1;
        iconEls.forEach(el => { if (el.checked) iconIndex = parseInt(el.value, 10) || 1; });

        // Convert to lon/lat
        const dir = this.screenToWorldDirection(this.closeupCreatePosition.x, this.closeupCreatePosition.y);
        const { lon, lat } = this.vectorToLonLatDeg(dir);
        const rounded = [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];

        // Upload file if chosen
        let filePath = null;
    if (fileEl && fileEl.files && fileEl.files.length === 1) {
            try {
        const up = await this.uploadSingleFile(fileEl.files[0], 'closeups');
        filePath = up && up.preview_path ? up.preview_path : (up ? up.file_path : null);
            } catch (e) {
                console.error('Closeup upload failed', e);
            }
        }

        // Optimistic add in current scene
        const tempId = -Date.now();
        const optimistic = {
            id: tempId,
            connection_type: 'Closeup',
            target_scene_id: null,
            position: rounded,
            name: name || null,
            file_path: filePath || null,
            icon_index: iconIndex
        };
        const scene = this.scenes.find(s => s.id == this.currentSceneId);
        if (scene) {
            scene.connections = scene.connections || [];
            scene.connections.push(optimistic);
            this.addConnectionMarker(optimistic);
        }
        this.pendingCloseups.push({
            tempId,
            parent_scene: parseInt(this.currentSceneId, 10),
            name: optimistic.name,
            file_path: filePath || '',
            position: rounded,
            icon_index: iconIndex
        });

        // Send to backend
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: 'EditTour',
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: 'AddCloseup',
                        data: {
                            name: name || 'Closeup',
                            file_path: filePath || '',
                            parent_scene_id: parseInt(this.currentSceneId, 10),
                            position: [rounded[0], rounded[1]],
                            icon_type: iconIndex
                        }
                    }
                }
            }));
        }

        this.closeAddCloseupModal();
    }

    reconcileCloseupAdded(data) {
        const parent_scene = parseInt(data.parent_scene);
        const realConnId = parseInt(data.connection_id);
        const scene = (this.scenes || []).find(s => s.id == parent_scene);
        if (!scene || !scene.connections) return;
        // Find the optimistic entry by tempId or by matching file_path from pending list
        let pendingIdx = -1;
        for (let i = this.pendingCloseups.length - 1; i >= 0; i--) {
            if (this.pendingCloseups[i].parent_scene == parent_scene) { pendingIdx = i; break; }
        }
        if (pendingIdx !== -1) {
            const pending = this.pendingCloseups.splice(pendingIdx, 1)[0];
            const conn = scene.connections.find(c => c.id === pending.tempId || (c.file_path == pending.file_path && Array.isArray(c.position) && c.position[0] == pending.position[0] && c.position[1] == pending.position[1]));
            if (conn) {
                conn.id = realConnId;
                conn.file_path = data.file_path || conn.file_path;
                conn.connection_type = 'Closeup';
                // Preserve the title from ack or the pending request to ensure persistence
                const ackName = (data.name !== undefined && data.name !== null) ? String(data.name).trim() : '';
                if (ackName.length) conn.name = ackName; else if (!conn.name) conn.name = pending.name || null;
                if (data.icon_type != null) conn.icon_index = parseInt(data.icon_type, 10) || 1;
                // Update sprite entry
                const entry = this.connectionSprites.find(e => e.connection && e.connection.id === pending.tempId);
                if (entry) {
                    entry.connection.id = realConnId;
                    entry.connection.file_path = conn.file_path;
                    entry.connection.name = conn.name;
                    entry.connection.icon_index = conn.icon_index;
                    entry.sprite.userData.connection = entry.connection;
                }
            }
        }
    }

    openEditCloseupModal(connection) {
        // Hide any lingering tooltip when opening a modal
        this.hideTooltip();
        this.activeCloseupForEdit = connection;
        const nameInput = document.getElementById('edit-closeup-name');
        const iconEls = document.querySelectorAll('input[name="edit-closeup-icon"]');
        if (nameInput) nameInput.value = connection.name || '';
        const idx = Math.max(1, Math.min(3, parseInt(connection.icon_index, 10) || 1));
        iconEls.forEach(el => { el.checked = (parseInt(el.value, 10) === idx); });
        const modal = document.getElementById('edit-closeup-modal');
        if (modal) modal.style.display = 'block';
        // Populate edit upload area with existing image if present
        const ecuInput = document.getElementById('edit-closeup-file');
        const ecuArea = document.querySelector('#edit-closeup-modal .edit-closeup-upload-area');
        if (ecuArea && ecuInput) {
            // Clear any previously selected file so we show the existing image by default
            ecuInput.value = '';
            this.updateCloseupUploadArea(ecuArea, ecuInput);
        }
    }

    closeEditCloseupModal() {
        const modal = document.getElementById('edit-closeup-modal');
        if (modal) modal.style.display = 'none';
        // Clear fields to prevent carry-over between different closeups
        const nameInput = document.getElementById('edit-closeup-name');
        if (nameInput) nameInput.value = '';
        const iconEls = document.querySelectorAll('input[name="edit-closeup-icon"]');
        iconEls.forEach(el => { el.checked = (parseInt(el.value, 10) === 1); });
        const ecuInput = document.getElementById('edit-closeup-file');
        const ecuArea = document.querySelector('#edit-closeup-modal .edit-closeup-upload-area');
        if (ecuInput) ecuInput.value = '';
        if (ecuArea && ecuInput) this.updateCloseupUploadArea(ecuArea, ecuInput);
        this.activeCloseupForEdit = null;
    }

    async confirmEditCloseup() {
        if (!this.activeCloseupForEdit) return;
        const c = this.activeCloseupForEdit;
        const nameInput = document.getElementById('edit-closeup-name');
        const iconEls = document.querySelectorAll('input[name="edit-closeup-icon"]');
        const fileEl = document.getElementById('edit-closeup-file');
        const typed = nameInput ? String(nameInput.value || '').trim() : '';
        let iconIndex = 1;
        iconEls.forEach(el => { if (el.checked) iconIndex = parseInt(el.value, 10) || 1; });

        // Optional file replace
        let newPath = null;
        if (fileEl && fileEl.files && fileEl.files.length === 1) {
            const up2 = await this.uploadSingleFile(fileEl.files[0], 'closeups');
            newPath = up2 && up2.preview_path ? up2.preview_path : (up2 ? up2.file_path : null);
        }

        // Update local state
        c.name = typed || null;
        c.icon_index = iconIndex;
        if (newPath) c.file_path = newPath;

        // Refresh sprite icon if changed
        const entry = this.connectionSprites.find(e => e.connection && e.connection.id == c.id);
        if (entry) {
            // Swap texture
            const clamped = Math.max(1, Math.min(3, parseInt(iconIndex, 10) || 1));
            const newMap = new THREE.TextureLoader().load(`/static/assets/info${clamped}_icon.png`);
            entry.sprite.material.map = newMap;
            entry.sprite.material.needsUpdate = true;
            entry.connection = c;
            entry.sprite.userData.connection = c;
        }

        // Persist editable fields supported by backend (name and position)
        const posEntry = this.connectionSprites.find(e => e.connection && e.connection.id == c.id);
        if (posEntry) {
            const { lon, lat } = this.vectorToLonLatDeg(posEntry.sprite.position);
            c.position = [parseFloat(lon.toFixed(2)), parseFloat(lat.toFixed(2))];
        }
        this.sendEditConnection(c.id, c.target_scene_id, c.position, c.name === null ? '' : c.name);
        this.showSuccess('Closeup updated');
        this.closeEditCloseupModal();
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

    // ===== Image Viewer (zoomable) =====
    ensureImageViewerWired() {
        this.hideTooltip();
        if (this._imageViewerWired) return;
        this._imageViewerWired = true;
        const viewer = document.getElementById('image-viewer');
        const img = document.getElementById('image-viewer-img');
        const closeBtn = viewer?.querySelector('.image-viewer-close');
        const backdrop = viewer?.querySelector('.image-viewer-backdrop');
        if (!viewer || !img) return;
        let scale = 1;
        let originX = 0;
        let originY = 0;
        let isPanning = false;
        let startX = 0, startY = 0;
    const zoomTransition = 'transform 0.08s linear';
    const panTransition = 'none';
    // Default to zoom transition; will be disabled during pan
    img.style.transition = zoomTransition;
    const reset = () => { scale = 1; originX = 0; originY = 0; img.style.transition = zoomTransition; img.style.transform = 'translate(0px, 0px) scale(1)'; img.style.cursor = 'zoom-in'; };
        const close = () => { viewer.classList.remove('show'); viewer.style.display = 'none'; img.src = ''; reset(); };
        closeBtn?.addEventListener('click', close);
        backdrop?.addEventListener('click', close);

        // Prevent default browser image dragging/ghost image
        img.addEventListener('dragstart', (e) => { e.preventDefault(); });
        viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Enable a tiny transition for smoother zoom feeling
            img.style.transition = zoomTransition;
            const delta = Math.sign(e.deltaY);
            const rect = img.getBoundingClientRect();
            const cx = e.clientX - rect.left; // cursor within image box
            const cy = e.clientY - rect.top;
            const prevScale = scale;
            scale *= (delta < 0 ? 1.1 : 0.9);
            scale = Math.min(Math.max(scale, 1), 8);
            // adjust origin so zoom centers around cursor
            const dx = (cx - rect.width / 2);
            const dy = (cy - rect.height / 2);
            originX = (originX + dx) * (scale / prevScale) - dx;
            originY = (originY + dy) * (scale / prevScale) - dy;
            img.style.transform = `translate(${-originX}px, ${-originY}px) scale(${scale})`;
            img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
        }, { passive: false });
        img.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (scale <= 1) { img.style.cursor = 'zoom-in'; return; }
            isPanning = true;
            startX = e.clientX; startY = e.clientY;
            img.style.cursor = 'grabbing';
            img.style.transition = panTransition;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            const dx = e.clientX - startX; const dy = e.clientY - startY; startX = e.clientX; startY = e.clientY;
            originX -= dx; originY -= dy;
            img.style.transform = `translate(${-originX}px, ${-originY}px) scale(${scale})`;
        });
        const endPan = () => {
            if (!isPanning) return;
            isPanning = false;
            img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
            // Restore transition for next zoom
            img.style.transition = zoomTransition;
        };
        window.addEventListener('mouseup', endPan);
        window.addEventListener('mouseleave', endPan);
        // Touch support
        let touchStartDist = 0; let panTouch = false;
        const dist = (t0, t1) => Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        img.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                panTouch = scale > 1;
                startX = e.touches[0].clientX; startY = e.touches[0].clientY;
                if (panTouch) img.style.transition = panTransition;
            }
            else if (e.touches.length === 2) {
                touchStartDist = dist(e.touches[0], e.touches[1]);
                img.style.transition = panTransition; // immediate for pinch updates
            }
        }, { passive: true });
        img.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const d = dist(e.touches[0], e.touches[1]);
                const prev = scale;
                scale *= (d > touchStartDist ? 1.02 : 0.98);
                scale = Math.min(Math.max(scale, 1), 8);
                touchStartDist = d;
                img.style.transform = `translate(${-originX}px, ${-originY}px) scale(${scale})`;
            } else if (panTouch && e.touches.length === 1) {
                const dx = e.touches[0].clientX - startX; const dy = e.touches[0].clientY - startY; startX = e.touches[0].clientX; startY = e.touches[0].clientY;
                originX -= dx; originY -= dy;
                img.style.transform = `translate(${-originX}px, ${-originY}px) scale(${scale})`;
            }
        }, { passive: false });
        img.addEventListener('touchend', () => {
            panTouch = false;
            img.style.transition = zoomTransition;
            img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
        });
        // Escape to close
        window.addEventListener('keydown', (e) => { if (viewer.style.display !== 'none' && e.key === 'Escape') close(); });
        this._imageViewer = { viewer, img, close, reset };
    }

    openImageViewer(path) {
        this.ensureImageViewerWired();
        if (!this._imageViewer) return;
        const { viewer, img } = this._imageViewer;
        img.src = path;
        viewer.style.display = 'block';
        viewer.classList.add('show');
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

    // ====================================
    // MISC HELPERS
    // ====================================
    isAnyModalOpen() {
        const modals = document.querySelectorAll('.modal');
        for (const m of modals) {
            const d = m.style && m.style.display;
            if (d === 'block' || d === 'flex') return true;
        }
        return false;
    }

    // =====================
    // Floorplan methods
    // =====================
    onFloorplanAdded(floorplan) {
        const toggleBtn = document.getElementById('floorplan-toggle');
        if (toggleBtn) toggleBtn.style.display = 'inline-block';
        const img = document.getElementById('floorplan-image');
        if (img && floorplan && floorplan.file_path) img.src = floorplan.file_path;
        // Initialize markers container if tour already loaded
        if (this.tourData && this.tourData.floorplan_markers) {
            this.renderFloorplanMarkers();
        }
    }
    onFloorplanDeleted() {
        const toggleBtn = document.getElementById('floorplan-toggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        const img = document.getElementById('floorplan-image');
        if (img) img.src = '';
        const panel = document.getElementById('floorplan-panel');
        if (panel) panel.style.display = 'none';
    }
    initFloorplanFromTour(tour) {
        if (tour && tour.has_floorplan && tour.floorplan) {
            this.onFloorplanAdded(tour.floorplan);
        }
    this.floorplanScale = 1;
    this.floorplanOffset = { x:0, y:0 };
    this.tourData.floorplan_markers = tour.floorplan_markers || [];
    this.attachFloorplanEvents();
    this.renderFloorplanMarkers();
    }
    sendAddFloorplanMessage(filePath) {
        if (!window.app?.socket) return;
        window.app.socket.send(JSON.stringify({
            action: 'EditTour',
            data: {
                tour_id: this.currentTourId,
                editor_action: {
                    action: 'AddFloorplan',
                    data: { file_path: filePath }
                }
            }
        }));
    }
    sendDeleteFloorplanMessage(floorplanId) {
        if (!window.app?.socket) return;
        window.app.socket.send(JSON.stringify({
            action: 'EditTour',
            data: {
                tour_id: this.currentTourId,
                editor_action: {
                    action: 'DeleteFloorplan',
                    data: { floorplan_id: floorplanId }
                }
            }
        }));
    }
    async uploadFloorplanFile(file) {
        const formData = new FormData();
        formData.append('file', file);
    formData.append('type', 'floorplan');
        try {
            const resp = await fetch('/upload-asset', { method: 'POST', body: formData });
            const json = await resp.json();
            if (json.file_path) this.sendAddFloorplanMessage(json.file_path);
        } catch (e) { console.error('Floorplan upload failed', e); }
    }

    // -------- Floorplan marker + zoom logic --------
    attachFloorplanEvents() {
        const viewport = document.getElementById('floorplan-viewport');
        if (!viewport || viewport._fpBound) return; // avoid double binding
        viewport._fpBound = true;
        viewport.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            const prevScale = this.floorplanScale;
            this.floorplanScale = Math.min(4, Math.max(0.5, this.floorplanScale + delta));
            const rect = viewport.getBoundingClientRect();
            const cx = e.clientX - rect.left - this.floorplanOffset.x;
            const cy = e.clientY - rect.top - this.floorplanOffset.y;
            const scaleRatio = this.floorplanScale / prevScale;
            this.floorplanOffset.x = e.clientX - rect.left - cx * scaleRatio;
            this.floorplanOffset.y = e.clientY - rect.top - cy * scaleRatio;
            this.updateFloorplanTransform();
        });
        let panning = false; let panStart = {x:0,y:0}; let startOffset={x:0,y:0};
        viewport.addEventListener('mousedown', (e)=>{
            if (e.button===1 || e.shiftKey) { // middle or shift pan
                panning = true; panStart = {x:e.clientX,y:e.clientY}; startOffset={...this.floorplanOffset};
            }
        });
        window.addEventListener('mousemove',(e)=>{ if(panning){ this.floorplanOffset.x = startOffset.x + (e.clientX-panStart.x); this.floorplanOffset.y = startOffset.y + (e.clientY-panStart.y); this.updateFloorplanTransform(); }});
        window.addEventListener('mouseup',()=>{ panning=false; });
        viewport.addEventListener('click',(e)=>{
            // Ignore if dragging/panning
            if (panning) return;
            const inner = document.getElementById('floorplan-inner');
            const rect = viewport.getBoundingClientRect();
            const localX = (e.clientX - rect.left - this.floorplanOffset.x)/this.floorplanScale;
            const localY = (e.clientY - rect.top - this.floorplanOffset.y)/this.floorplanScale;
            const w = inner.clientWidth; const h = inner.clientHeight;
            if (!w || !h) return;
            const normX = localX / w; const normY = localY / h;
            if (normX<0||normX>1||normY<0||normY>1) return;
            if (!this.currentSceneId) { this.showInfo('Select a scene first.'); return; }
            // Check if marker exists for scene
            const existing = (this.tourData.floorplan_markers||[]).find(m=>m.scene_id==this.currentSceneId);
            if (existing) {
                // Update position
                this.sendUpdateFloorplanMarker(existing.id, normX, normY);
            } else {
                this.sendAddFloorplanMarker(this.currentSceneId, normX, normY);
            }
        });
    }
    updateFloorplanTransform() {
        const inner = document.getElementById('floorplan-inner');
        if (!inner) return;
        inner.style.transform = `translate(${this.floorplanOffset.x}px, ${this.floorplanOffset.y}px) scale(${this.floorplanScale})`;
    }
    renderFloorplanMarkers() {
        const container = document.getElementById('floorplan-markers');
        if (!container) return;
        container.innerHTML = '';
        (this.tourData.floorplan_markers||[]).forEach(m=>{
            const el = document.createElement('div');
            el.className='floorplan-marker';
            el.textContent = m.scene_id;
            el.style.left = (m.position[0]*100)+'%';
            el.style.top = (m.position[1]*100)+'%';
            el.dataset.markerId = m.id;
            el.dataset.sceneId = m.scene_id;
            el.addEventListener('mousedown',(e)=>{
                e.stopPropagation();
                const start = {x:e.clientX,y:e.clientY};
                const startPos = {x:m.position[0], y:m.position[1]};
                el.classList.add('dragging');
                const move = (me)=>{
                    const dx = (me.clientX-start.x); const dy=(me.clientY-start.y);
                    const inner = document.getElementById('floorplan-inner');
                    const w = inner.clientWidth; const h = inner.clientHeight;
                    const newX = Math.min(1,Math.max(0,startPos.x + dx/(w*this.floorplanScale)));
                    const newY = Math.min(1,Math.max(0,startPos.y + dy/(h*this.floorplanScale)));
                    el.style.left = (newX*100)+'%'; el.style.top = (newY*100)+'%';
                    m.position=[newX,newY];
                };
                const up = ()=>{ window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up); el.classList.remove('dragging'); this.sendUpdateFloorplanMarker(m.id, m.position[0], m.position[1]); };
                window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
            });
            el.addEventListener('dblclick',(e)=>{ e.stopPropagation(); if(confirm('Delete marker?')) this.sendDeleteFloorplanMarker(m.id); });
            el.addEventListener('click',(e)=>{ e.stopPropagation(); this.loadScene(m.scene_id); });
            container.appendChild(el);
        });
    }
    sendAddFloorplanMarker(sceneId, x, y) { if (!window.app?.socket) return; window.app.socket.send(JSON.stringify({ action:'EditTour', data:{ tour_id:this.currentTourId, editor_action:{ action:'AddFloorplanMarker', data:{ scene_id:sceneId, x, y }}}})); }
    sendUpdateFloorplanMarker(markerId, x, y) { if (!window.app?.socket) return; window.app.socket.send(JSON.stringify({ action:'EditTour', data:{ tour_id:this.currentTourId, editor_action:{ action:'UpdateFloorplanMarker', data:{ marker_id:markerId, x, y }}}})); }
    sendDeleteFloorplanMarker(markerId) { if (!window.app?.socket) return; window.app.socket.send(JSON.stringify({ action:'EditTour', data:{ tour_id:this.currentTourId, editor_action:{ action:'DeleteFloorplanMarker', data:{ marker_id:markerId }}}})); }
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

// Closeup modal wrappers
function closeAddCloseupModal() { if (editor) editor.closeAddCloseupModal(); }

function uploadFloorplan() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e)=> { const f = e.target.files[0]; if (f && editor) editor.uploadFloorplanFile(f); };
    input.click();
}
function toggleFloorplanPanel() {
    const panel = document.getElementById('floorplan-panel');
    if (!panel) return;
    panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
}
function removeFloorplanAsset() {
    if (editor && editor.tourData && editor.tourData.floorplan) {
        editor.sendDeleteFloorplanMessage(editor.tourData.floorplan.id);
    }
}
function toggleFloorplanMaximize() {
    const panel = document.getElementById('floorplan-panel');
    if (!panel) return; panel.classList.toggle('max');
}
function confirmAddCloseup() { if (editor) editor.confirmAddCloseup(); }
function closeEditCloseupModal() { if (editor) editor.closeEditCloseupModal(); }
function confirmEditCloseup() { if (editor) editor.confirmEditCloseup(); }
function deleteActiveCloseup() {
    if (editor && editor.activeCloseupForEdit) {
        editor.deleteConnection(editor.activeCloseupForEdit.id);
        editor.closeEditCloseupModal();
    }
}

function addInfospot() {
    // Clear mouse state immediately when button is clicked
    if (editor && typeof editor.clearMouseState === 'function') {
        editor.clearMouseState();
    }
    
    if (!editor) return;

    // Toggle closeup mode using the same button
    const btn = document.querySelector('[onclick="addInfospot()"]');
    const isActive = btn && btn.classList.contains('active');
    if (isActive) {
        editor.toggleCloseupMode(); // will deactivate
        editor.showInfo('Infospot mode cancelled');
    } else {
        editor.toggleCloseupMode(); // will activate
        editor.showInfo('Infospot mode activated - Click on the panorama to add a closeup', 'Infospot Mode');
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
    // Deprecated placeholder
}

async function exportCurrentTour() {
    const btn = document.getElementById('export-btn');
    const overlay = document.getElementById('export-overlay');
    const overlayText = document.getElementById('export-overlay-text');
    const resetUI = () => {
        if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.innerText = 'Export'; }
        if (overlay) overlay.style.display = 'none';
    };
    try {
        const tourId = localStorage.getItem('currentTourId') || (editor && editor.currentTourId);
        if (!tourId) { if (editor?.showError) editor.showError('No tour loaded'); else alert('No tour loaded'); return; }

        if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.innerText = 'Exporting…'; }
        if (overlay) { overlayText && (overlayText.textContent = 'Preparing export...'); overlay.style.display = 'flex'; }

        const res = await fetch(`/api/export/${tourId}`);
        if (!res.ok) {
            const text = await res.text().catch(() => 'Export failed');
            resetUI();
            if (res.status === 404) {
                if (editor?.showError) editor.showError('Tour not found'); else alert('Tour not found');
            } else {
                if (editor?.showError) editor.showError(text || 'Export failed'); else alert(text || 'Export failed');
            }
            return;
        }
        overlayText && (overlayText.textContent = 'Downloading...');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tour_${tourId}_export.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        resetUI();
        if (editor && editor.showSuccess) editor.showSuccess('Export package downloaded');
    } catch (e) {
        console.error('Export error', e);
        resetUI();
        if (editor?.showError) editor.showError('Export error. See console for details.'); else alert('Export error');
    }
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

// --- Concurrent export helpers (open in new tab with background fallback) ---
function getCurrentTourId() {
    // Prefer localStorage value, then editor state
    const fromStorage = localStorage.getItem('currentTourId');
    if (fromStorage) return fromStorage;
    if (window.editor && editor.currentTourId) return editor.currentTourId;
    return null;
}

function openExportInNewTab(event) {
    try {
        const tourId = getCurrentTourId();
        if (!tourId) {
            if (editor?.showError) editor.showError('Could not determine the tour to export.');
            else alert('Could not determine the tour to export.');
            return;
        }

        const url = `/api/export/${encodeURIComponent(tourId)}`;
        // Open synchronously to avoid popup blockers as much as possible
        const win = window.open('about:blank', '_blank', 'noopener');
        if (win) {
            try { win.document.write('<title>Preparing export…</title><p style="font-family:sans-serif">Preparing your export…</p>'); } catch (_) {}
            win.location = url; // triggers download in new tab
            if (editor?.showSuccess) editor.showSuccess('Export started in a new tab.');
        } else {
            // Popup blocked → background download fallback
            backgroundExportDownload(url, tourId);
        }
    } catch (err) {
        console.error('openExportInNewTab error', err);
        if (editor?.showError) editor.showError('Failed to start export.'); else alert('Failed to start export.');
    }
}

async function backgroundExportDownload(url, tourId) {
    const btn = document.getElementById('export-btn');
    const original = btn ? btn.innerText : null;
    try {
        if (btn) { btn.disabled = true; btn.innerText = 'Exporting…'; }
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
            const text = await res.text().catch(() => 'Export failed');
            throw new Error(text || `Export failed (${res.status})`);
        }
        const blob = await res.blob();
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `tour_${tourId}_export.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(dlUrl);
        if (editor?.showSuccess) editor.showSuccess('Export package downloaded');
    } catch (e) {
        console.error('backgroundExportDownload error', e);
        if (editor?.showError) editor.showError('Export failed. See console for details.'); else alert('Export failed.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = original || 'Export'; }
    }
}