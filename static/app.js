// app.js - Simple binary file plotter frontend
class SimpleBinaryPlotter {
    constructor() {
        this.currentFile = null;
        this.metadata = null;
        this.ranges = null;
        this.currentPlot = null;
        
        this.colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
        
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.elements = {
            fileInput: document.getElementById('fileInput'),
            uploadBtn: document.getElementById('uploadBtn'),
            fileInfo: document.getElementById('fileInfo'),
            loadingDiv: document.getElementById('loading'),
            plotContainer: document.getElementById('plotContainer'),
            plot: document.getElementById('plot'),
            channelControls: document.getElementById('channelControls')
        };
    }

    setupEventListeners() {
        // File input change
        this.elements.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.name.endsWith('.bin')) {
                this.elements.uploadBtn.disabled = false;
                this.elements.uploadBtn.textContent = `Upload ${file.name}`;
            } else {
                this.elements.uploadBtn.disabled = true;
                this.elements.uploadBtn.textContent = 'Choose Binary File';
            }
        });

        // Upload button click
        this.elements.uploadBtn.addEventListener('click', () => {
            if (this.elements.fileInput.files[0]) {
                this.uploadFile();
            } else {
                this.elements.fileInput.click();
            }
        });

        // Drag and drop
        const dropZone = document.querySelector('.upload-area');
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].name.endsWith('.bin')) {
                this.elements.fileInput.files = files;
                this.elements.uploadBtn.disabled = false;
                this.elements.uploadBtn.textContent = `Upload ${files[0].name}`;
            }
        });
    }

    async uploadFile() {
        const file = this.elements.fileInput.files[0];
        if (!file) return;

        this.showLoading(true);
        this.elements.fileInfo.textContent = `Processing ${file.name}...`;

        try {
            const formData = new FormData();
            formData.append('binfile', file);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            this.currentFile = file.name;
            this.metadata = result.metadata;
            this.ranges = result.ranges;

            this.showFileInfo(result);
            this.createChannelControls();
            await this.loadPlot();

        } catch (error) {
            console.error('Upload error:', error);
            this.elements.fileInfo.innerHTML = `<span class="error">Error: ${error.message}</span>`;
        } finally {
            this.showLoading(false);
        }
    }

    showLoading(show) {
        this.elements.loadingDiv.style.display = show ? 'block' : 'none';
        this.elements.uploadBtn.disabled = show;
    }

    showFileInfo(result) {
        const duration = result.metadata.duration;
        const totalPoints = result.metadata.totalPoints;
        const channels = result.metadata.channels.length;

        this.elements.fileInfo.innerHTML = `
            <div class="file-info-content">
                <h3>📁 ${result.filename}</h3>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Channels:</span>
                        <span class="info-value">${channels}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Duration:</span>
                        <span class="info-value">${duration.toFixed(1)}s</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Total Points:</span>
                        <span class="info-value">${totalPoints.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    }

    createChannelControls() {
        if (!this.metadata) return;

        const controlsHtml = this.metadata.channels.map((channel, index) => `
            <div class="channel-control">
                <input type="checkbox" id="channel${index}" checked>
                <label for="channel${index}" style="color: ${this.colors[index]}">
                    <span class="channel-dot" style="background: ${this.colors[index]}"></span>
                    ${channel.label} [${channel.unit}]
                </label>
            </div>
        `).join('');

        this.elements.channelControls.innerHTML = `
            <h4>Channel Visibility</h4>
            <div class="controls-grid">
                ${controlsHtml}
            </div>
            <div class="control-buttons">
                <button onclick="plotter.toggleAllChannels()">Toggle All</button>
                <button onclick="plotter.resetZoom()">Reset Zoom</button>
                <button onclick="plotter.resetYAxes()">Reset Y-Axes</button>
            </div>
        `;

        // Add event listeners for checkboxes
        this.metadata.channels.forEach((channel, index) => {
            document.getElementById(`channel${index}`).addEventListener('change', () => {
                this.updatePlotVisibility();
            });
        });
    }

    async loadPlot() {
        if (!this.metadata) return;

        this.showLoading(true);
        
        try {
            // Build traces for all channels
            const traces = await this.buildAllTraces(0, this.metadata.duration, 2000);
            
            // Create layout
            const layout = this.createPlotLayout();
            
            // Create plot
            await this.createPlot(traces, layout);
            
            this.elements.plotContainer.style.display = 'block';

        } catch (error) {
            console.error('Plot error:', error);
            this.elements.fileInfo.innerHTML += `<br><span class="error">Plot error: ${error.message}</span>`;
        } finally {
            this.showLoading(false);
        }
    }

    async buildAllTraces(startTime, endTime, maxPoints) {
        const traces = [];

        for (let channel = 0; channel < 8; channel++) {
            try {
                const response = await fetch(
                    `/api/data/${channel}?start=${startTime}&end=${endTime}&maxPoints=${maxPoints}`
                );
                
                if (!response.ok) continue;
                
                const data = await response.json();
                const channelInfo = this.metadata.channels[channel];
                
                traces.push({
                    x: data.time,
                    y: data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${channelInfo.label} [${channelInfo.unit}]`,
                    line: { color: this.colors[channel], width: 1.5 },
                    yaxis: this.getYAxisForUnit(channelInfo.unit),
                    visible: true
                });

            } catch (error) {
                console.warn(`Failed to load channel ${channel}:`, error);
            }
        }

        return traces;
    }

    getYAxisForUnit(unit) {
        switch (unit) {
            case 'V': return 'y';
            case 'A': return 'y2';
            case 'Bar': return 'y3';
            default: return 'y';
        }
    }

    createPlotLayout() {
        const timeRange = [0, this.metadata.duration];
        
        return {
            title: {
                text: `${this.currentFile} - Multi-Channel Binary Data`,
                font: { size: 16, color: '#2c3e50' }
            },
            
            xaxis: { 
                title: 'Time [s]',
                range: timeRange,
                domain: [0.15, 0.95],
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)'
            },
            
            // Voltage axis (left)
            yaxis: {
                title: { text: 'Voltage [V]', font: { color: this.colors[0] }},
                side: 'left',
                position: 0.0,
                showgrid: true,
                gridcolor: 'rgba(31, 119, 180, 0.2)',
                tickfont: { color: this.colors[0] },
                range: this.ranges?.channel_0 ? [this.ranges.channel_0.min, this.ranges.channel_0.max] : null
            },
            
            // Current axis
            yaxis2: {
                title: { text: 'Current [A]', font: { color: this.colors[2] }},
                side: 'left',
                position: 0.08,
                overlaying: 'y',
                anchor: 'free',
                showgrid: true,
                gridcolor: 'rgba(44, 160, 44, 0.2)',
                tickfont: { color: this.colors[2] }
            },
            
            // Pressure axis
            yaxis3: {
                title: { text: 'Pressure [Bar]', font: { color: this.colors[6] }},
                side: 'left',
                position: 0.16,
                overlaying: 'y',
                anchor: 'free',
                showgrid: true,
                gridcolor: 'rgba(227, 119, 194, 0.2)',
                tickfont: { color: this.colors[6] }
            },
            
            legend: { 
                x: 1.02, 
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1
            },
            
            height: 600,
            margin: { l: 120, r: 50, t: 80, b: 60 },
            plot_bgcolor: 'rgba(248,249,250,0.3)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            autosize: true
        };
    }

    async createPlot(traces, layout) {
        const config = {
            responsive: true,
            displayModeBar: true,
            scrollZoom: false
        };

        this.currentPlot = await Plotly.newPlot('plot', traces, layout, config);
        
        // Setup zoom resampling
        this.elements.plot.on('plotly_relayout', (eventData) => {
            this.handleZoom(eventData);
        });
    }

    async handleZoom(eventData) {
        if (!eventData['xaxis.range[0]'] && !eventData['xaxis.range[1]']) return;
        
        const startTime = eventData['xaxis.range[0]'] || 0;
        const endTime = eventData['xaxis.range[1]'] || this.metadata.duration;
        
        console.log(`Resampling for zoom: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);
        
        try {
            const traces = await this.buildAllTraces(startTime, endTime, 3000);
            await Plotly.react('plot', traces, this.currentPlot.layout);
        } catch (error) {
            console.error('Zoom error:', error);
        }
    }

    updatePlotVisibility() {
        if (!this.currentPlot) return;

        const visibilityUpdate = {};
        this.metadata.channels.forEach((channel, index) => {
            const checkbox = document.getElementById(`channel${index}`);
            visibilityUpdate[`visible[${index}]`] = checkbox.checked;
        });

        Plotly.restyle('plot', visibilityUpdate);
    }

    toggleAllChannels() {
        if (!this.metadata) return;

        const checkboxes = this.metadata.channels.map((_, index) => 
            document.getElementById(`channel${index}`)
        );
        
        const allChecked = checkboxes.every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
        });
        
        this.updatePlotVisibility();
    }

    resetZoom() {
        if (!this.currentPlot || !this.metadata) return;
        
        const update = {
            'xaxis.range': [0, this.metadata.duration]
        };
        
        Plotly.relayout('plot', update);
    }

    resetYAxes() {
        if (!this.currentPlot) return;
        
        const update = {
            'yaxis.range': null,
            'yaxis2.range': null,
            'yaxis3.range': null
        };
        
        Plotly.relayout('plot', update);
    }
}

// Initialize when page loads
let plotter;
document.addEventListener('DOMContentLoaded', () => {
    plotter = new SimpleBinaryPlotter();
});