class StringArtGenerator {
    constructor() {
        this.steps = {
            upload: document.getElementById('upload-step'),
            crop: document.getElementById('crop-step'),
            settings: document.getElementById('settings-step'),
            generation: document.getElementById('generation-step'),
            batch: document.getElementById('batch-step')
        };

        this.state = {
            currentStep: 'upload',
            image: null,
            crop: {
                x: 0, y: 0, scale: 1,
                canvasSize: 400 // Viewport size for cropper
            },
            settings: {
                nails: 288,
                lines: 3000,
                opacity: 0.5
            },
            // Batch State
            batchQueue: [],
            isBatchMode: false,
            batchResults: [],

            sourcePixels: null, // Uint8Array of grayscale values
            width: 0,
            height: 0,
            pins: [], // Single mode pins
            sequence: [], // Single mode sequence
            isGenerating: false
        };

        this.initEventListeners();
    }

    initEventListeners() {
        // Upload
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.handleFile(e.target.files[0]);
        });

        // Crop Controls
        document.getElementById('crop-cancel').addEventListener('click', () => this.goToStep('upload'));
        document.getElementById('crop-confirm').addEventListener('click', () => this.finishCrop());

        // Settings Controls
        document.getElementById('settings-back').addEventListener('click', () => this.goToStep('crop'));
        document.getElementById('generate-btn').addEventListener('click', () => this.startGeneration());
        document.getElementById('batch-btn').addEventListener('click', () => this.startBatchGeneration());

        document.getElementById('batch-back-btn').addEventListener('click', () => {
            this.state.isGenerating = false; // Cancel batch
            this.goToStep('settings');
        });

        document.getElementById('detail-back-btn').addEventListener('click', () => {
            document.getElementById('detail-back-btn').classList.add('hidden');
            this.goToStep('batch');
        });

        // Inputs
        document.getElementById('nails-input').addEventListener('change', (e) => this.state.settings.nails = parseInt(e.target.value));
        document.getElementById('lines-input').addEventListener('change', (e) => this.state.settings.lines = parseInt(e.target.value));
        document.getElementById('opacity-input').addEventListener('input', (e) => {
            this.state.settings.opacity = parseFloat(e.target.value);
            // Re-render preview if we were doing a live preview, but for now just update state
        });

        // Generation Controls
        document.getElementById('reset-btn').addEventListener('click', () => {
            this.state.isGenerating = false;
            this.goToStep('upload');
        });
        document.getElementById('download-btn').addEventListener('click', () => this.downloadImage());
        document.getElementById('save-gallery-btn').addEventListener('click', () => this.saveToGallery());
        document.getElementById('download-seq-btn').addEventListener('click', () => this.downloadSequence());

        // Result Opacity
        const resOpInput = document.getElementById('result-opacity');
        resOpInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.state.settings.opacity = val;
            document.getElementById('result-opacity-val').innerText = val.toFixed(2);
            this.redrawResult();
        });

        this.loadGallery();
    }

    goToStep(stepName) {
        // Hide all
        Object.values(this.steps).forEach(el => el.classList.remove('active'));
        // Show target (with a small timeout for animation if needed, but CSS handles standard trans)
        setTimeout(() => {
            Object.values(this.steps).forEach(el => {
                if (el.id !== stepName + '-step') el.classList.add('hidden');
            });
            this.steps[stepName].classList.remove('hidden');
            // triggering reflow for animation
            void this.steps[stepName].offsetWidth;
            this.steps[stepName].classList.add('active');
        }, 300); // Wait for exit animation

        // Immediate toggle for now to keep it snappy for first version
        Object.values(this.steps).forEach(el => {
            if (el.id === stepName + '-step') {
                el.classList.remove('hidden');
                el.classList.add('active');
            } else {
                el.classList.add('hidden');
                el.classList.remove('active');
            }
        });

        this.state.currentStep = stepName;

        if (stepName === 'crop') this.initCropper();
    }

    handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.state.image = img;
                this.goToStep('crop');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- Cropper Logic ---
    initCropper() {
        const canvas = document.getElementById('crop-canvas');
        const ctx = canvas.getContext('2d');
        const size = 400; // Fixed size for the editor
        canvas.width = size;
        canvas.height = size;

        // Initial fit
        const img = this.state.image;
        const scale = Math.max(size / img.width, size / img.height);

        this.state.crop = {
            scale: scale,
            x: (size - img.width * scale) / 2,
            y: (size - img.height * scale) / 2,
            canvasSize: size,
            isDragging: false,
            lastX: 0,
            lastY: 0
        };

        this.drawCropper();

        // Mouse Events for Pan/Zoom
        canvas.onmousedown = (e) => {
            this.state.crop.isDragging = true;
            this.state.crop.lastX = e.clientX;
            this.state.crop.lastY = e.clientY;
        };

        window.onmouseup = () => {
            this.state.crop.isDragging = false;
        };

        window.onmousemove = (e) => {
            if (!this.state.crop.isDragging || this.state.currentStep !== 'crop') return;
            const dx = e.clientX - this.state.crop.lastX;
            const dy = e.clientY - this.state.crop.lastY;
            this.state.crop.lastX = e.clientX;
            this.state.crop.lastY = e.clientY;

            this.state.crop.x += dx;
            this.state.crop.y += dy;
            this.drawCropper();
        };

        canvas.onwheel = (e) => {
            e.preventDefault();
            const zoomSpeed = 0.001;
            const newScale = this.state.crop.scale * (1 - e.deltaY * zoomSpeed);
            if (newScale > 0.1 && newScale < 10) {
                // Zoom towards center
                // Current center relative to image
                const cx = (this.state.crop.canvasSize / 2 - this.state.crop.x) / this.state.crop.scale;
                const cy = (this.state.crop.canvasSize / 2 - this.state.crop.y) / this.state.crop.scale;

                this.state.crop.scale = newScale;

                // New Position
                this.state.crop.x = this.state.crop.canvasSize / 2 - cx * newScale;
                this.state.crop.y = this.state.crop.canvasSize / 2 - cy * newScale;

                this.drawCropper();
            }
        };
    }

    drawCropper() {
        const canvas = document.getElementById('crop-canvas');
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        const cropState = this.state.crop;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw Image
        ctx.save();
        ctx.translate(cropState.x, cropState.y);
        ctx.scale(cropState.scale, cropState.scale);
        ctx.drawImage(this.state.image, 0, 0);
        ctx.restore();

        // Overlay
        const cx = width / 2;
        const cy = height / 2;
        const radius = width / 2 - 20; // Padding

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.arc(cx, cy, radius, 0, Math.PI * 2, true); // Cut out
        ctx.fill();

        // Border
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    finishCrop() {
        // Extract the circular area to a new internal canvas for processing
        const size = 500; // Processing resolution
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = size;
        tempCanvas.height = size;
        const ctx = tempCanvas.getContext('2d');

        const cropState = this.state.crop;
        const scale = cropState.scale;

        // We need to map the circle from screen space to image space
        // Screen circle center: (200, 200), Radius: 180 (400/2 - 20)
        // We want to draw the image into 500x500 such that the circle fills it.

        const screenRadius = cropState.canvasSize / 2 - 20;
        const screenCx = cropState.canvasSize / 2;
        const screenCy = cropState.canvasSize / 2;

        // Where is the image relative to the screen circle center?
        // Image corner on screen: cropState.x, cropState.y
        // Vector from Screen Center to Image Corner: (cropState.x - screenCx, cropState.y - screenCy)
        // In image pixels, that is / scale.

        const imgX = (screenCx - cropState.x) / scale;
        const imgY = (screenCy - cropState.y) / scale;
        const imgRadius = screenRadius / scale;

        // Now draw the valid part of image onto tempCanvas
        // We want source rectangle: center (imgX, imgY), radius imgRadius
        // Destination: center (250, 250), radius 250

        ctx.drawImage(
            this.state.image,
            imgX - imgRadius, imgY - imgRadius, imgRadius * 2, imgRadius * 2,
            0, 0, size, size
        );

        // Apply circular mask (optional, but good for algorithm to ignore outside)
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Get Pixel Data for Algorithm
        // Convert to grayscale
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        this.state.sourcePixels = new Uint8Array(size * size);
        this.state.width = size;
        this.state.height = size;

        for (let i = 0; i < data.length; i += 4) {
            // Simple grayscale: 0.299R + 0.587G + 0.114B
            // We invert it: 0 = white, 255 = black (amount of string needed)
            const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            this.state.sourcePixels[i / 4] = 255 - brightness;
        }

        // Setup Preview for Step 3
        const prevCanvas = document.getElementById('preview-canvas');
        prevCanvas.width = 300;
        prevCanvas.height = 300;
        const prevCtx = prevCanvas.getContext('2d');
        prevCtx.drawImage(tempCanvas, 0, 0, 300, 300);

        this.goToStep('settings');
    }

    startGeneration() {
        this.goToStep('generation');
        const canvas = document.getElementById('art-canvas');
        // High res for download, CSS scales it down
        canvas.width = 1000;
        canvas.height = 1000;
        // High res for download, CSS scales it down
        canvas.width = 1000;
        canvas.height = 1000;

        // Sync opacity slider
        const op = this.state.settings.opacity;
        document.getElementById('result-opacity').value = op;
        document.getElementById('result-opacity-val').innerText = op.toFixed(2);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1000, 1000);

        this.state.isGenerating = true;

        // Calculate Pin Positions
        const numPins = this.state.settings.nails;
        const pins = [];
        const cx = this.state.width / 2;
        const cy = this.state.height / 2;
        const radius = (this.state.width / 2) - 1;

        for (let i = 0; i < numPins; i++) {
            const angle = (2 * Math.PI * i) / numPins;
            pins.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle)
            });
        }
        this.state.pins = pins;
        this.state.sequence = [1]; // Start with first pin

        // Begin Algorithm
        this.generateStep(0, 0); // Start at pin 0
    }

    startBatchGeneration() {
        this.state.isBatchMode = true;
        this.goToStep('batch');

        // Define Kit Variations
        const variations = [
            {
                nails: 180,
                lines: 1400,
                label: 'Beginner Kit (20cm)',
                opacity: 0.6
            },
            {
                nails: 240,
                lines: 2800,
                label: 'Standard Kit (30cm)',
                opacity: 0.45
            },
            {
                nails: 300,
                lines: 6000,
                label: 'Pro Kit (40cm)',
                opacity: 0.25
            }
        ];

        this.state.batchQueue = [];
        this.state.batchResults = [];

        // Build Queue
        variations.forEach((v, index) => {
            this.state.batchQueue.push({
                id: index,
                nails: v.nails,
                lines: v.lines,
                opacity: v.opacity || 0.5, // Default or recommended
                label: v.label || null,
                sequence: [],
                pins: [],
                status: 'pending'
            });
        });

        // Setup Grid
        const grid = document.getElementById('batch-grid');
        grid.innerHTML = '';
        this.state.batchQueue.forEach(item => {
            const card = document.createElement('div');
            card.className = 'batch-card';
            card.id = `batch-card-${item.id}`;
            const title = item.label ? `<strong style="color:var(--accent-color)">${item.label}</strong><br>` : '';
            card.innerHTML = `
                <canvas width="200" height="200" id="batch-canvas-${item.id}"></canvas>
                <div class="batch-info">${title}${item.nails} Nails, ${item.lines} Lines</div>
                <div class="batch-status" id="batch-status-${item.id}">Waiting...</div>
            `;
            // Click Handler to view
            card.addEventListener('click', () => {
                if (item.status === 'done') this.openBatchResult(item);
            });
            grid.appendChild(card);
        });

        // Start Processing
        this.processBatchQueue();
    }

    processBatchQueue() {
        if (!this.state.isBatchMode) return;

        // Find next pending
        const job = this.state.batchQueue.find(j => j.status === 'pending');
        if (!job) return; // All done

        job.status = 'processing';
        document.getElementById(`batch-status-${job.id}`).innerText = 'Processing...';

        // Precompute Pins
        const numPins = job.nails;
        const pins = [];
        const cx = this.state.width / 2;
        const cy = this.state.height / 2;
        const radius = (this.state.width / 2) - 1;

        for (let i = 0; i < numPins; i++) {
            const angle = (2 * Math.PI * i) / numPins;
            pins.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle)
            });
        }
        job.pins = pins;
        job.sequence = [1];

        // We use a clone of sourcePixels for each job so errors accumulate per job
        const jobPixels = new Uint8Array(this.state.sourcePixels);
        const ctx = document.getElementById(`batch-canvas-${job.id}`).getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 200, 200);

        this.runBatchJob(job, jobPixels, 0);
    }

    runBatchJob(job, pixels, currentLine) {
        if (!this.state.isBatchMode) return;

        // Process chunk
        const CHUNK = 100; // Faster chunk for batch
        const scale = 200 / this.state.width; // Thumbnail scale
        const ctx = document.getElementById(`batch-canvas-${job.id}`).getContext('2d');

        let currentPin = job.sequence[job.sequence.length - 1] - 1;

        // Use job's recommended opacity or default for thumbnail
        // Thumbnail usually darker to be visible at small size
        const thumbOpacity = job.opacity ? job.opacity : 0.3;
        ctx.strokeStyle = `rgba(0,0,0,${thumbOpacity})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        for (let k = 0; k < CHUNK; k++) {
            if (currentLine >= job.lines) break;

            let bestPin = -1;
            let maxDarkness = -1;

            for (let i = 0; i < job.pins.length; i++) {
                if (i === currentPin) continue;
                const dist = Math.abs(currentPin - i);
                if (dist < 5 || dist > job.pins.length - 5) continue;

                // Custom brightness check using local jobPixels
                const lineScore = this.getLineScoreGeneric(currentPin, i, job.pins, pixels);
                if (lineScore > maxDarkness) {
                    maxDarkness = lineScore;
                    bestPin = i;
                }
            }

            if (bestPin !== -1) {
                const p1 = job.pins[currentPin];
                const p2 = job.pins[bestPin];
                ctx.moveTo(p1.x * scale, p1.y * scale);
                ctx.lineTo(p2.x * scale, p2.y * scale);

                this.subtractLineGeneric(currentPin, bestPin, job.pins, pixels);
                job.sequence.push(bestPin + 1);
                currentPin = bestPin;
                currentLine++;
            } else {
                currentPin = Math.floor(Math.random() * job.pins.length); // Jump
            }
        }
        ctx.stroke();

        if (currentLine < job.lines) {
            // Update UI status occasionally
            if (currentLine % 500 === 0) document.getElementById(`batch-status-${job.id}`).innerText = `${Math.round(currentLine / job.lines * 100)}%`;

            // Allow UI to breathe
            setTimeout(() => this.runBatchJob(job, pixels, currentLine), 0);
        } else {
            job.status = 'done';
            document.getElementById(`batch-status-${job.id}`).innerText = 'Done (Click to View)';
            this.processBatchQueue(); // Next
        }
    }

    // Generic Helper versions
    getLineScoreGeneric(p1Idx, p2Idx, pins, pixels) {
        const p1 = pins[p1Idx];
        const p2 = pins[p2Idx];
        let x0 = Math.floor(p1.x), y0 = Math.floor(p1.y);
        let x1 = Math.floor(p2.x), y1 = Math.floor(p2.y);
        let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        let tot = 0, cnt = 0;
        while (true) {
            const idx = y0 * this.state.width + x0;
            if (idx >= 0 && idx < pixels.length) { tot += pixels[idx]; cnt++; }
            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
        return cnt > 0 ? tot / cnt : 0;
    }

    subtractLineGeneric(p1Idx, p2Idx, pins, pixels) {
        const p1 = pins[p1Idx];
        const p2 = pins[p2Idx];
        let x0 = Math.floor(p1.x), y0 = Math.floor(p1.y);
        let x1 = Math.floor(p2.x), y1 = Math.floor(p2.y);
        let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        const reduce = 50;
        while (true) {
            const idx = y0 * this.state.width + x0;
            if (idx >= 0 && idx < pixels.length) {
                let val = pixels[idx];
                pixels[idx] = Math.max(0, val - reduce);
            }
            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    openBatchResult(job) {
        this.goToStep('generation');
        document.getElementById('detail-back-btn').classList.remove('hidden');

        // Ensure main canvas is sized correctly
        const canvas = document.getElementById('art-canvas');
        canvas.width = 1000;
        canvas.height = 1000;

        // Load job data into main state
        this.state.pins = job.pins;
        this.state.sequence = job.sequence;
        this.state.settings.nails = job.nails;
        this.state.settings.lines = job.lines;

        // Apply Recommended Opacity if present
        if (job.opacity) {
            this.state.settings.opacity = job.opacity;
            const resOpInput = document.getElementById('result-opacity');
            resOpInput.value = job.opacity;
            document.getElementById('result-opacity-val').innerText = job.opacity.toFixed(2);
        } else {
            // Default check
            this.state.settings.opacity = 0.5;
            document.getElementById('result-opacity').value = 0.5;
            document.getElementById('result-opacity-val').innerText = '0.50';
        }

        // Re-render large result
        this.redrawResult();
        const lbl = job.label ? ` (${job.label})` : '';
        document.getElementById('status-text').innerText = `Viewing: ${job.nails} nails, ${job.lines} lines${lbl}`;
    }

    generateStep(currentPinIndex, linesDrawn) {
        if (!this.state.isGenerating) return;
        if (linesDrawn >= this.state.settings.lines) {
            this.finishGeneration();
            return;
        }

        const BATCH_SIZE = 10; // Draw mutiple lines per frame for speed
        const ctx = document.getElementById('art-canvas').getContext('2d');
        const scale = 1000 / this.state.width; // Scale from process space to render space

        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(0, 0, 0, ${this.state.settings.opacity})`;
        ctx.beginPath();
        let current = currentPinIndex;

        for (let b = 0; b < BATCH_SIZE; b++) {
            if (linesDrawn >= this.state.settings.lines) break;

            let bestPin = -1;
            let maxDarkness = -1;

            // Look for best connection
            // We skip adjacent pins to avoid hugging the border
            // Simplified "Greedy" search

            // To optimize, could skip already visited pairs, but for now simple greedy
            for (let i = 0; i < this.state.pins.length; i++) {
                if (i === current) continue;
                // Avoid minimal jumps
                const dist = Math.abs(current - i);
                if (dist < 5 || dist > this.state.pins.length - 5) continue;

                const lineScore = this.getLineScore(current, i);

                if (lineScore > maxDarkness) {
                    maxDarkness = lineScore;
                    bestPin = i;
                }
            }

            if (bestPin !== -1) {
                // Determine point coordinates
                const p1 = this.state.pins[current];
                const p2 = this.state.pins[bestPin];

                // Draw on canvas
                ctx.moveTo(p1.x * scale, p1.y * scale);
                ctx.lineTo(p2.x * scale, p2.y * scale);

                // Subtract from error image
                this.subtractLine(current, bestPin);

                this.state.sequence.push(bestPin + 1);
                current = bestPin;
                linesDrawn++;
            } else {
                // If no good move, break? or random jump?
                // Random jump to avoid stuck loop
                current = Math.floor(Math.random() * this.state.pins.length);
            }
        }
        ctx.stroke();

        // Update UI
        document.getElementById('status-text').innerText = `${linesDrawn} lines drawn`;
        document.getElementById('progress-fill').style.width = `${(linesDrawn / this.state.settings.lines) * 100}%`;

        // Next Frame
        requestAnimationFrame(() => this.generateStep(current, linesDrawn));
    }

    // Brensenham's Line Algorithm to sample pixels
    getLineScore(p1Idx, p2Idx) {
        const p1 = this.state.pins[p1Idx];
        const p2 = this.state.pins[p2Idx];

        let x0 = Math.floor(p1.x);
        let y0 = Math.floor(p1.y);
        let x1 = Math.floor(p2.x);
        let y1 = Math.floor(p2.y);

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let totalBrightness = 0;
        let pixelCount = 0;

        while (true) {
            const idx = y0 * this.state.width + x0;
            if (idx >= 0 && idx < this.state.sourcePixels.length) {
                totalBrightness += this.state.sourcePixels[idx];
                pixelCount++;
            }

            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }

        return pixelCount > 0 ? totalBrightness / pixelCount : 0; // Average darkness
    }

    subtractLine(p1Idx, p2Idx) {
        const p1 = this.state.pins[p1Idx];
        const p2 = this.state.pins[p2Idx];

        let x0 = Math.floor(p1.x);
        let y0 = Math.floor(p1.y);
        let x1 = Math.floor(p2.x);
        let y1 = Math.floor(p2.y);

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        const reduceAmount = 50; // How much to "whitewash" the path

        while (true) {
            const idx = y0 * this.state.width + x0;
            if (idx >= 0 && idx < this.state.sourcePixels.length) {
                // Lower values = lighter = less attractive for future lines
                let val = this.state.sourcePixels[idx];
                val = Math.max(0, val - reduceAmount);
                this.state.sourcePixels[idx] = val;
            }

            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    finishGeneration() {
        this.state.isGenerating = false;
        document.getElementById('status-text').innerText = `Finished! ${this.state.settings.lines} lines.`;
        document.getElementById('download-btn').disabled = false;
        document.getElementById('save-gallery-btn').disabled = false;
        document.getElementById('download-seq-btn').disabled = false;
    }

    downloadImage() {
        const link = document.createElement('a');
        link.download = 'string-art.png';
        link.href = document.getElementById('art-canvas').toDataURL();
        link.click();
    }

    saveToGallery() {
        const canvas = document.getElementById('art-canvas');
        try {
            const imageData = canvas.toDataURL('image/jpeg', 0.8); // Compress to save space
            const item = {
                id: Date.now(),
                date: new Date().toLocaleString(),
                image: imageData,
                sequence: this.state.sequence,
                settings: this.state.settings
            };

            const gallery = this.getGalleryData();
            gallery.unshift(item); // Add to beginning

            // Limit to last 20 to prevent LocalStorage quota excess
            if (gallery.length > 20) gallery.pop();

            localStorage.setItem('stringArtGallery', JSON.stringify(gallery));
            this.loadGallery();
            alert('Saved to Gallery!');
        } catch (e) {
            console.error(e);
            alert('Storage full! Delete some images from the gallery.');
        }
    }

    getGalleryData() {
        try {
            return JSON.parse(localStorage.getItem('stringArtGallery')) || [];
        } catch (e) {
            return [];
        }
    }

    loadGallery() {
        const grid = document.getElementById('gallery-grid');
        const gallery = this.getGalleryData();

        if (gallery.length === 0) {
            grid.innerHTML = '<p class="empty-gallery-text">No saved art yet.</p>';
            return;
        }

        grid.innerHTML = '';
        gallery.forEach(item => {
            const div = document.createElement('div');
            div.className = 'gallery-item';
            div.innerHTML = `
                <img src="${item.image}" alt="String Art">
                <span class="gallery-date">${item.date}</span>
                <div class="gallery-actions">
                    <button class="gallery-btn download-btn">Download</button>
                    <button class="gallery-btn seq-btn">Seq</button>
                    <button class="gallery-btn delete-btn">Del</button>
                </div>
            `;

            // Attach Events
            div.querySelector('.download-btn').addEventListener('click', () => {
                const link = document.createElement('a');
                link.download = `string-art-${item.id}.jpg`;
                link.href = item.image;
                link.click();
            });

            div.querySelector('.seq-btn').addEventListener('click', () => {
                this.downloadSequenceData(item.sequence, item.id);
            });

            div.querySelector('.delete-btn').addEventListener('click', () => {
                if (confirm('Delete this artwork?')) {
                    this.deleteFromGallery(item.id);
                }
            });

            grid.appendChild(div);
        });
    }

    deleteFromGallery(id) {
        let gallery = this.getGalleryData();
        gallery = gallery.filter(item => item.id !== id);
        localStorage.setItem('stringArtGallery', JSON.stringify(gallery));
        this.loadGallery();
    }

    downloadSequence() {
        if (this.state.sequence.length === 0) return;
        this.downloadSequenceData(this.state.sequence, Date.now());
    }

    downloadSequenceData(sequence, id) {
        const text = sequence.join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `sequence-${id}.txt`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }

    redrawResult() {
        if (!this.state.pins.length || !this.state.sequence.length) return;

        const canvas = document.getElementById('art-canvas');
        const ctx = canvas.getContext('2d');

        // Clear
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw properties
        const scale = 1000 / this.state.width;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(0, 0, 0, ${this.state.settings.opacity})`;
        ctx.beginPath();

        // Reconstruct path
        let currentIdx = this.state.sequence[0] - 1; // 1-based to 0-based
        if (currentIdx < 0) currentIdx = 0; // safety

        const pStart = this.state.pins[currentIdx];
        if (pStart) ctx.moveTo(pStart.x * scale, pStart.y * scale);

        for (let i = 1; i < this.state.sequence.length; i++) {
            const pinIdx = this.state.sequence[i] - 1;
            const p = this.state.pins[pinIdx];
            if (p) ctx.lineTo(p.x * scale, p.y * scale);
        }
        ctx.stroke();
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    new StringArtGenerator();
});
