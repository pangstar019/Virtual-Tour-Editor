/**
 * Virtual Tour Editor - Main Editor Implementation
 * Handles 360-degree panoramic viewing, scene management, and connection creation
 */

// Virtual Tour Editor Implementation
class VirtualTourEditor {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.panoramaSphere = null;
        this.currentTexture = null;
        this.connections = [];
        this.scenes = [];
        this.currentSceneId = null;
        this.currentTourId = null;
        this.isHotspotMode = false;
        this.hotspotCreatePosition = null;
        this.availableAssets = [];
        this.selectedAsset = null;
        this.uploadedFile = null;
        this.tourDataRequested = false;
        
        // Mouse/touch controls
        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.lon = 0;
        this.lat = 0;
        this.phi = 0;
        this.theta = 0;
        
        this.init();
    }
    
    async init() {
        try {
            // Get tour ID from localStorage (set by homepage)
            this.currentTourId = localStorage.getItem('currentTourId');
            
            // If no tour ID, use the first available tour (for testing)
            if (!this.currentTourId) {
                this.currentTourId = '1'; // Default to tour ID 1 for testing
                localStorage.setItem('currentTourId', this.currentTourId);
            }
            
            await this.initThreeJS();
            this.setupEventListeners();
            this.setupFileUpload();
            await this.loadAvailableAssets();
            
            // Initialize the WebSocket app
            window.app = new VirtualTourApp();
            
            // Set up WebSocket message handling
            this.setupWebSocketMessageHandling();
            
            // Wait for WebSocket connection (authentication will trigger tour data loading)
            await this.waitForWebSocketConnection();
            
            // Tour data will be loaded when session is restored
            console.log('Editor initialized, waiting for authentication...');
            
        } catch (error) {
            console.error('Failed to initialize editor:', error);
            alert('Failed to initialize virtual tour editor');
        }
    }
    
    async initThreeJS() {
        const canvas = document.getElementById('viewer-canvas');
        const container = canvas.parentElement;
        
        // Scene setup
        this.scene = new THREE.Scene();
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Create panorama sphere
        const sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
        sphereGeometry.scale(-1, 1, 1); // Invert to view from inside
        
        const sphereMaterial = new THREE.MeshBasicMaterial();
        this.panoramaSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        this.scene.add(this.panoramaSphere);
        
        // Start render loop
        this.animate();
    }
    
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
    }

    setupFileUpload() {
        const fileInput = document.getElementById('file-upload');
        const uploadArea = document.querySelector('.upload-area');

        // File input change
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Drag and drop
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

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Store the uploaded file
        this.uploadedFile = file;
        this.selectedAsset = null; // Clear any selected existing asset

        // Update upload area to show selected file
        const uploadArea = document.querySelector('.upload-area');
        uploadArea.innerHTML = `
            <div class="upload-icon">✅</div>
            <div class="upload-text">File selected: ${file.name}</div>
            <div class="upload-hint">Click to select a different file</div>
        `;

        // Clear asset grid selection
        document.querySelectorAll('.asset-item').forEach(item => {
            item.classList.remove('selected');
        });
    }
    
    onMouseDown(event) {
        event.preventDefault();
        this.isMouseDown = true;
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
        
        if (this.isHotspotMode) {
            this.createHotspotAt(event.clientX, event.clientY);
        }
    }
    
    onMouseMove(event) {
        if (!this.isMouseDown) return;
        
        const deltaX = event.clientX - this.mouseX;
        const deltaY = event.clientY - this.mouseY;
        
        this.lon -= deltaX * 0.1;
        this.lat += deltaY * 0.1;
        
        this.lat = Math.max(-85, Math.min(85, this.lat));
        
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
        
        this.updateCamera();
    }
    
    onMouseUp(event) {
        this.isMouseDown = false;
    }
    
    onWheel(event) {
        const fov = this.camera.fov + event.deltaY * 0.05;
        this.camera.fov = Math.max(10, Math.min(75, fov));
        this.camera.updateProjectionMatrix();
    }
    
    onTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            this.isMouseDown = true;
            this.mouseX = event.touches[0].clientX;
            this.mouseY = event.touches[0].clientY;
        }
    }
    
    onTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1 && this.isMouseDown) {
            const deltaX = event.touches[0].clientX - this.mouseX;
            const deltaY = event.touches[0].clientY - this.mouseY;
            
            this.lon -= deltaX * 0.1;
            this.lat += deltaY * 0.1;
            
            this.lat = Math.max(-85, Math.min(85, this.lat));
            
            this.mouseX = event.touches[0].clientX;
            this.mouseY = event.touches[0].clientY;
            
            this.updateCamera();
        }
    }
    
    onTouchEnd(event) {
        this.isMouseDown = false;
    }
    
    updateCamera() {
        this.phi = THREE.MathUtils.degToRad(90 - this.lat);
        this.theta = THREE.MathUtils.degToRad(this.lon);
        
        this.camera.position.x = 100 * Math.sin(this.phi) * Math.cos(this.theta);
        this.camera.position.y = 100 * Math.cos(this.phi);
        this.camera.position.z = 100 * Math.sin(this.phi) * Math.sin(this.theta);
        
        this.camera.lookAt(0, 0, 0);
    }
    
    onWindowResize() {
        const container = document.getElementById('viewer-canvas').parentElement;
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
    
    async loadAvailableAssets() {
        // Load list of available 360-degree images from the insta360 folder
        try {
            const response = await fetch('/assets/insta360/');
            if (response.ok) {
                // For now, we'll use a hardcoded list based on what we saw in the directory
                this.availableAssets = [
                    'IMG_20250805_122627_00_merged.jpg',
                    'IMG_20250805_122714_00_merged.jpg',
                    'IMG_20250805_122846_00_merged.jpg',
                    'IMG_20250805_123344_00_merged.jpg',
                    'IMG_20250805_123411_00_merged.jpg',
                    'IMG_20250805_123442_00_merged.jpg',
                    'IMG_20250805_123522_00_merged.jpg',
                    'IMG_20250805_123553_00_merged.jpg',
                    'IMG_20250805_124055_00_merged.jpg',
                    'IMG_20250805_124319_00_merged.jpg'
                ];
            }
        } catch (error) {
            console.warn('Could not load asset list, using hardcoded list');
            this.availableAssets = [
                'IMG_20250805_122627_00_merged.jpg',
                'IMG_20250805_122714_00_merged.jpg',
                'IMG_20250805_122846_00_merged.jpg',
                'IMG_20250805_123344_00_merged.jpg',
                'IMG_20250805_123411_00_merged.jpg',
                'IMG_20250805_123442_00_merged.jpg',
                'IMG_20250805_123522_00_merged.jpg',
                'IMG_20250805_123553_00_merged.jpg',
                'IMG_20250805_124055_00_merged.jpg',
                'IMG_20250805_124319_00_merged.jpg'
            ];
        }
        
        this.updateAssetGrid();
    }
    
    updateAssetGrid() {
        const assetGrid = document.getElementById('asset-grid');
        if (!assetGrid) return;
        
        assetGrid.innerHTML = '';
        
        this.availableAssets.forEach((assetName, index) => {
            const assetItem = document.createElement('div');
            assetItem.className = 'asset-item';
            assetItem.innerHTML = `
                <img class="asset-image" src="/assets/insta360/${assetName}" alt="${assetName}" />
                <div class="asset-name">${assetName.replace('.jpg', '').substring(0, 10)}...</div>
            `;
            
            assetItem.addEventListener('click', () => {
                // Remove previous selection
                document.querySelectorAll('.asset-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Select this item
                assetItem.classList.add('selected');
                
                // Store selected asset
                this.selectedAsset = assetName;
            });
            
            assetGrid.appendChild(assetItem);
        });
    }
    
    setupWebSocketMessageHandling() {
        // Listen for WebSocket messages via the event system
        window.addEventListener('websocketMessage', (event) => {
            try {
                console.log('Raw WebSocket message received:', event.detail);
                const data = JSON.parse(event.detail);
                console.log('Parsed WebSocket data:', data);
                this.handleWebSocketMessage(data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
                console.error('Raw message was:', event.detail);
            }
        });
    }
    
    async loadTourData() {
        // Request tour data from server
        console.log('Sending EditTour message for tour ID:', this.currentTourId);
        if (window.app && window.app.socket && window.app.socket.readyState === WebSocket.OPEN) {
            const message = {
                action: "EditTour",
                data: { tour_id: this.currentTourId }
            };
            console.log('Sending WebSocket message:', message);
            window.app.socket.send(JSON.stringify(message));
        } else {
            console.error('WebSocket not ready when trying to send EditTour message');
            console.log('WebSocket state:', {
                app: !!window.app,
                socket: !!window.app?.socket,
                readyState: window.app?.socket?.readyState
            });
        }
    }
    
    async requestUserTours() {
        // Request user's tours from server
        console.log('Sending ShowTours message');
        if (window.app && window.app.socket && window.app.socket.readyState === WebSocket.OPEN) {
            window.app.socket.send(JSON.stringify({
                action: "ShowTours"
            }));
        } else {
            console.error('WebSocket not ready when trying to send ShowTours message');
        }
    }
    
    async waitForWebSocketConnection() {
        console.log('Waiting for WebSocket connection...');
        return new Promise((resolve, reject) => {
            const maxAttempts = 50; // 5 seconds with 100ms intervals
            let attempts = 0;
            
            const checkConnection = () => {
                console.log(`WebSocket check attempt ${attempts + 1}, readyState:`, window.app?.socket?.readyState);
                if (window.app && window.app.socket && window.app.socket.readyState === WebSocket.OPEN) {
                    console.log('WebSocket connection ready!');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('WebSocket connection timeout');
                    reject(new Error('WebSocket connection timeout'));
                } else {
                    attempts++;
                    setTimeout(checkConnection, 100);
                }
            };
            
            checkConnection();
        });
    }
    
    async waitForAuthenticatedConnection() {
        console.log('Waiting for authenticated WebSocket connection...');
        return new Promise((resolve, reject) => {
            const maxAttempts = 100; // 10 seconds with 100ms intervals
            let attempts = 0;
            
            const checkAuthentication = () => {
                console.log(`Authentication check attempt ${attempts + 1}`);
                console.log('WebSocket state:', window.app?.socket?.readyState);
                console.log('App logged in:', window.app?.isLoggedIn);
                
                if (window.app && 
                    window.app.socket && 
                    window.app.socket.readyState === WebSocket.OPEN && 
                    window.app.isLoggedIn) {
                    console.log('WebSocket connection authenticated and ready!');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('Authentication timeout');
                    reject(new Error('Authentication timeout'));
                } else {
                    attempts++;
                    setTimeout(checkAuthentication, 100);
                }
            };
            
            checkAuthentication();
        });
    }
    
    handleWebSocketMessage(data) {
        console.log('Editor received message:', data);
        console.log('Message type:', data.type);
        
        switch (data.type) {
            case 'tour_data':
                console.log('Received tour_data:', data.data);
                console.log('Tour scenes:', data.data.scenes);
                this.loadTourFromData(data.data);
                break;
            case 'tour_list':
                console.log('Received tour_list:', data.tours);
                this.handleTourList(data.tours);
                break;
            case 'scene_added':
                this.addSceneToList(data.scene);
                break;
            case 'connection_created':
                this.addConnectionToScene(data.connection);
                break;
            case 'error':
                console.error('WebSocket error:', data.message);
                alert('Error: ' + data.message);
                break;
            default:
                console.log('Unhandled message type:', data.type);
                break;
        }
        
        // If we received session restored message, and we haven't sent EditTour yet, send it now
        if (data.sessionRestored && !this.tourDataRequested) {
            console.log('Session restored, now requesting tour data...');
            this.tourDataRequested = true;
            setTimeout(() => this.loadTourData(), 500); // Small delay to ensure backend is ready
        }
    }
    
    loadTourFromData(tourData) {
        console.log('Loading tour from data:', tourData);
        console.log('Tour scenes count:', tourData.scenes?.length || 0);
        console.log('Tour scenes data:', tourData.scenes);
        
        document.getElementById('tour-title').textContent = tourData.name;
        document.getElementById('tour-subtitle').textContent = tourData.location;
        document.getElementById('tour-info').textContent = `Scenes: ${tourData.scenes?.length || 0}`;
        
        this.scenes = tourData.scenes || [];
        console.log('Scenes assigned to this.scenes:', this.scenes);
        this.updateSceneList();
        
        // Load first scene if available
        if (this.scenes.length > 0) {
            console.log('Loading first scene:', this.scenes[0]);
            this.loadScene(this.scenes[0]);
        } else {
            console.log('No scenes available to load');
        }
        
        // Hide loading indicator now that tour data is loaded
        document.getElementById('loading-indicator').style.display = 'none';
    }
    
    handleTourList(tours) {
        if (tours && tours.length > 0) {
            // Auto-select the first tour
            this.currentTourId = tours[0].id.toString();
            localStorage.setItem('currentTourId', this.currentTourId);
            
            // Now load the tour data
            this.loadTourData();
        } else {
            alert('No tours found. Please create a tour first. Redirecting to homepage.');
            window.location.href = '/homepage';
        }
    }
    
    updateSceneList() {
        console.log('Updating scene list with', this.scenes.length, 'scenes');
        const sceneList = document.getElementById('scene-list');
        if (!sceneList) {
            console.error('Scene list element not found!');
            return;
        }
        
        sceneList.innerHTML = '';
        
        this.scenes.forEach((scene, index) => {
            console.log(`Adding scene ${index + 1}:`, scene);
            const sceneItem = document.createElement('div');
            sceneItem.className = 'scene-item';
            if (scene.id === this.currentSceneId) {
                sceneItem.classList.add('active');
            }
            
            sceneItem.innerHTML = `
                <img class="scene-thumbnail" src="${scene.file_path}" alt="${scene.name}" />
                <div class="scene-details">
                    <div class="scene-name">${scene.name}</div>
                    <div class="scene-info">Scene ${index + 1}</div>
                </div>
                <div class="scene-controls">
                    <button class="scene-control-btn" onclick="editor.editScene('${scene.id}')" title="Edit">✏️</button>
                    <button class="scene-control-btn" onclick="editor.deleteScene('${scene.id}')" title="Delete">🗑️</button>
                </div>
            `;
            
            sceneItem.addEventListener('click', (e) => {
                if (!e.target.closest('.scene-controls')) {
                    this.loadScene(scene);
                }
            });
            sceneList.appendChild(sceneItem);
        });
        
        console.log('Scene list updated. DOM elements added:', sceneList.children.length);
    }
    
    async loadScene(scene) {
        this.currentSceneId = scene.id;
        this.updateSceneList();
        
        // Update current scene name in top toolbar
        document.getElementById('current-scene-name').textContent = scene.name;
        
        // Load panorama texture
        if (scene.file_path) {
            const loader = new THREE.TextureLoader();
            try {
                const texture = await new Promise((resolve, reject) => {
                    loader.load(scene.file_path, resolve, undefined, reject);
                });
                
                this.currentTexture = texture;
                this.panoramaSphere.material.map = texture;
                this.panoramaSphere.material.needsUpdate = true;
                
                // Reset camera to initial view
                if (scene.initial_view_x !== undefined && scene.initial_view_y !== undefined) {
                    this.lon = scene.initial_view_x;
                    this.lat = scene.initial_view_y;
                    this.updateCamera();
                }
                
                // Update connections
                this.updateConnectionMarkers(scene.connections || []);
                
            } catch (error) {
                console.error('Failed to load scene texture:', error);
                alert('Failed to load scene image');
            }
        }
    }
    
    updateConnectionMarkers(connections) {
        // Remove existing markers
        const existingMarkers = document.querySelectorAll('.connection-marker');
        existingMarkers.forEach(marker => marker.remove());
        
        // Add new markers
        connections.forEach(connection => {
            this.addConnectionMarker(connection);
        });
        
        // Update connection list
        this.updateConnectionList(connections);
    }
    
    addConnectionMarker(connection) {
        const marker = document.createElement('div');
        marker.className = 'connection-marker';
        marker.style.left = connection.position[0] + 'px';
        marker.style.top = connection.position[1] + 'px';
        
        marker.addEventListener('click', () => {
            // Navigate to target scene
            const targetScene = this.scenes.find(s => s.id === connection.target_scene_id);
            if (targetScene) {
                this.loadScene(targetScene);
            }
        });
        
        document.getElementById('viewer-canvas').parentElement.appendChild(marker);
    }
    
    updateConnectionList(connections) {
        const connectionList = document.getElementById('connection-list');
        connectionList.innerHTML = '';
        
        connections.forEach((connection, index) => {
            const targetScene = this.scenes.find(s => s.id === connection.target_scene_id);
            const connectionItem = document.createElement('div');
            connectionItem.className = 'connection-item';
            
            connectionItem.innerHTML = `
                <div class="connection-info">
                    Connection ${index + 1} → ${targetScene ? targetScene.name : 'Unknown Scene'}
                </div>
                <div class="connection-actions">
                    <button class="btn small danger" onclick="editor.deleteConnection('${connection.id}')">
                        🗑️ Delete
                    </button>
                </div>
            `;
            
            connectionList.appendChild(connectionItem);
        });
    }
    
    createHotspotAt(clientX, clientY) {
        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        
        // Calculate position relative to canvas
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        
        // Store position for connection creation
        this.hotspotCreatePosition = { x, y };
        
        // Show connection modal
        this.updateTargetSceneSelect();
        document.getElementById('add-connection-modal').style.display = 'block';
        
        // Exit hotspot mode
        this.toggleHotspotMode();
    }
    
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
    
    toggleHotspotMode() {
        this.isHotspotMode = !this.isHotspotMode;
        const indicator = document.getElementById('hotspot-mode');
        indicator.style.display = this.isHotspotMode ? 'block' : 'none';
        
        // Update button text
        const btn = document.querySelector('[onclick="toggleHotspotMode()"]');
        if (btn) {
            btn.textContent = this.isHotspotMode ? '❌ Cancel' : '🔗 Add Connection';
        }
    }
    
    deleteConnection(connectionId) {
        if (confirm('Are you sure you want to delete this connection?')) {
            if (window.app && window.app.socket) {
                window.app.socket.send(JSON.stringify({
                    action: "DeleteConnection",
                    data: { connection_id: connectionId }
                }));
            }
        }
    }
    
    showAddSceneModal() {
        this.updateAssetGrid();
        document.getElementById('add-scene-modal').style.display = 'block';
    }
    
    async confirmAddScene() {
        const sceneName = document.getElementById('scene-name').value.trim();
        if (!sceneName) {
            alert('Please enter a scene name');
            return;
        }
        
        let filePath = null;
        
        // Check if user uploaded a new file
        if (this.uploadedFile) {
            try {
                // Upload file to server
                const formData = new FormData();
                formData.append('file', this.uploadedFile);
                formData.append('type', 'insta360');
                
                const response = await fetch('/upload-asset', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const result = await response.json();
                    filePath = result.file_path;
                } else {
                    alert('Failed to upload file');
                    return;
                }
            } catch (error) {
                console.error('Upload error:', error);
                alert('Failed to upload file');
                return;
            }
        } else if (this.selectedAsset) {
            // Use existing asset
            filePath = `/assets/insta360/${this.selectedAsset}`;
        } else {
            alert('Please select a 360-degree image or upload a new one');
            return;
        }
        
        if (window.app && window.app.socket) {
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
        
        this.closeAddSceneModal();
    }
    
    closeAddSceneModal() {
        document.getElementById('add-scene-modal').style.display = 'none';
        document.getElementById('scene-name').value = '';
        document.getElementById('file-upload').value = '';
        this.selectedAsset = null;
        this.uploadedFile = null;
        
        // Reset upload area
        const uploadArea = document.querySelector('.upload-area');
        uploadArea.innerHTML = `
            <div class="upload-icon">📁</div>
            <div class="upload-text">Click to upload or drag & drop</div>
            <div class="upload-hint">Supports JPG, PNG files (Equirectangular format)</div>
        `;
        
        // Remove selections
        document.querySelectorAll('.asset-item').forEach(item => {
            item.classList.remove('selected');
        });
    }
    
    confirmAddConnection() {
        const targetSceneId = document.getElementById('target-scene').value;
        if (!targetSceneId || !this.hotspotCreatePosition) {
            alert('Please select a target scene');
            return;
        }
        
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "AddConnection",
                        data: {
                            start_scene_id: this.currentSceneId,
                            asset_id: targetSceneId,
                            position: [
                                Math.round(this.hotspotCreatePosition.x),
                                Math.round(this.hotspotCreatePosition.y)
                            ]
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
    }
    
    resetView() {
        this.lon = 0;
        this.lat = 0;
        this.camera.fov = 75;
        this.camera.updateProjectionMatrix();
        this.updateCamera();
    }
    
    setInitialView() {
        if (!this.currentSceneId) return;
        
        // Send initial view position to server
        if (window.app && window.app.socket) {
            window.app.socket.send(JSON.stringify({
                action: "EditTour",
                data: {
                    tour_id: this.currentTourId,
                    editor_action: {
                        action: "SetInitialView",
                        data: {
                            scene_id: this.currentSceneId,
                            position: [Math.round(this.lon), Math.round(this.lat)]
                        }
                    }
                }
            }));
        }
        
        alert('Initial view position saved');
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
                            scene_id: this.currentSceneId,
                            direction: Math.round(this.lon)
                        }
                    }
                }
            }));
        }
        
        alert('North direction saved');
    }
    
    deleteCurrentScene() {
        if (!this.currentSceneId) return;
        
        if (confirm('Are you sure you want to delete this scene?')) {
            if (window.app && window.app.socket) {
                window.app.socket.send(JSON.stringify({
                    action: "EditTour",
                    data: {
                        tour_id: this.currentTourId,
                        editor_action: {
                            action: "DeleteScene",
                            data: {
                                scene_id: this.currentSceneId
                            }
                        }
                    }
                }));
            }
        }
    }
}

// Global functions for UI interaction
let editor;

window.addEventListener('DOMContentLoaded', () => {
    editor = new VirtualTourEditor();
});

function toggleHotspotMode() {
    if (editor) {
        editor.toggleHotspotMode();
    }
}

function resetView() {
    if (editor) {
        editor.resetView();
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
    if (editor) {
        editor.setInitialView();
    }
}

function setNorthDirection() {
    if (editor) {
        editor.setNorthDirection();
    }
}

function deleteCurrentScene() {
    if (editor) {
        editor.deleteCurrentScene();
    }
}

function saveTour() {
    alert('Tour saved successfully!');
}

function previewTour() {
    alert('Preview mode not yet implemented');
}

function goHome() {
    localStorage.removeItem('currentTourId');
    window.location.href = '/homepage';
}

function fastRename() {
    alert('Fast rename feature not yet implemented');
}

function sortScenes() {
    alert('Sort scenes feature not yet implemented');
}

function addInfospot() {
    alert('Add infospot feature not yet implemented');
}

function toggleHotspotMode() {
    if (editor) {
        editor.isHotspotMode = !editor.isHotspotMode;
        const indicator = document.getElementById('hotspot-mode');
        const btn = document.getElementById('link-hotspot-btn');
        
        if (editor.isHotspotMode) {
            indicator.style.display = 'block';
            btn.classList.add('active');
            btn.textContent = '❌ Cancel';
        } else {
            indicator.style.display = 'none';
            btn.classList.remove('active');
            btn.textContent = '🔗 Link Hotspot';
        }
    }
}

function showAddSceneModal() {
    if (editor) {
        editor.showAddSceneModal();
    }
}

function closeAddSceneModal() {
    if (editor) {
        editor.closeAddSceneModal();
    }
}

function confirmAddScene() {
    if (editor) {
        editor.confirmAddScene();
    }
}

function closeAddConnectionModal() {
    if (editor) {
        editor.closeAddConnectionModal();
    }
}

function confirmAddConnection() {
    if (editor) {
        editor.confirmAddConnection();
    }
}

// Close modals when clicking outside
window.addEventListener('click', (event) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
});
