// plot-layout-manager.js - Layout creation with simplified loading
window.PlotLayoutManager = (function() {
    'use strict';
    
    // Configuration constants
    const colors = window.appConfig?.colors || ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
    const temperatureColors = ['#ff4444', '#ff6b35', '#f7931e', '#ffd700', '#ff1493', '#ff69b4', '#dda0dd', '#9370db'];
    const distanceColors = ['#00bfff', '#1e90ff', '#4169e1', '#0000ff'];
    
    // Private state - will be shared with other modules
    let sharedState = null;
    let dataManager = null;
    
    // UI revision ID for state preservation
    const uiRevisionId = 'plot-ui-v1';
    
    // Event handling state
    let isHandlingZoom = false;
    let zoomTimeout = null;
    
    // Simple loading state
    let isLoading = false;
    
    // Initialize with shared state and data manager
    function init(stateObject, dataManagerRef) {
        sharedState = stateObject;
        dataManager = dataManagerRef;
        isLoading = false;
        console.log('PlotLayoutManager initialized');
    }
    
    // Simple plot placeholder
    function showPlotPlaceholder(experimentName) {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv) {
            console.warn('Plot container not found for placeholder');
            return;
        }
        
        console.log('Showing simple plot placeholder...');
        isLoading = true;
        
        // Clear any existing plot first
        clearExistingPlot(plotDiv);
        
        plotDiv.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; 
                       flex-direction: column; color: #495057; text-align: center;">
                <div class="spinner" style="margin: 0 auto 20px;"></div>
                <h3 style="margin-bottom: 10px; color: #1E5BA8;">Loading experiment data...</h3>
                <p style="color: #6c757d;">${experimentName}</p>
            </div>
        `;
        
        console.log('Simple plot placeholder displayed');
    }
    
    // Clear existing plot safely
    function clearExistingPlot(plotDiv) {
        try {
            if (window.Plotly && plotDiv._fullLayout) {
                console.log('Purging existing Plotly plot...');
                Plotly.purge('plot');
            }
        } catch (error) {
            console.warn('Error purging existing plot:', error);
        }
        
        // Reset plot div properties
        plotDiv.innerHTML = '';
        plotDiv.style.width = '100%';
        plotDiv.style.height = '600px';
        plotDiv.className = '';
    }
    
    // Create complete plot layout with all axes
    function createPlotLayout() {
        if (!sharedState.metadata) {
            throw new Error('Metadata not available for layout creation');
        }
        
        const timeRange = [0, sharedState.metadata.duration];
        
        // Calculate left margin based on number of left axes
        const numLeftAxes = 4 + (sharedState.hasTemperatureData ? 1 : 0);
        const leftMargin = 80 + (numLeftAxes - 1) * 40;
        
        // Get axis ranges from data manager
        const axisRanges = dataManager.calculateAxisRanges();
        
        const layout = {
            title: {
                text: `${sharedState.currentExperiment} - Multi-Channel Data${sharedState.hasTemperatureData ? ' + Temperature' : ''}${sharedState.hasDistanceData ? ' + Distance' : ''}`,
                font: { size: 16, color: '#2c3e50' }
            },
            
            // Add uirevision for state preservation
            uirevision: uiRevisionId,
            
            // X-axis configuration
            xaxis: { 
                title: 'Time [s]',
                range: timeRange,
                domain: [0.26, 0.94], // Adjusted for multiple axes
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                automargin: true
            },
            
            // Voltage axis (leftmost - y)
            yaxis: createYAxisConfig({
                title: 'Voltage [V]',
                color: colors[0],
                side: 'left',
                position: 0.0,
                range: axisRanges.voltage,
                gridColor: 'rgba(31, 119, 180, 0.2)',
                zerolineColor: 'rgba(31, 119, 180, 0.7)'
            }),
            
            // Current axis (second from left - y2)
            yaxis2: createYAxisConfig({
                title: 'Current [A]',
                color: colors[2],
                side: 'left',
                position: 0.08,
                range: axisRanges.current,
                gridColor: 'rgba(44, 160, 44, 0.2)',
                zerolineColor: 'rgba(44, 160, 44, 0.7)',
                anchor: 'free',
                overlaying: 'y'
            }),
            
            // Pressure axis (third from left - y3)
            yaxis3: createYAxisConfig({
                title: 'Pressure [Bar]',
                color: colors[6],
                side: 'left',
                position: 0.16,
                range: axisRanges.pressure,
                gridColor: 'rgba(227, 119, 194, 0.2)',
                zerolineColor: 'rgba(227, 119, 194, 0.7)',
                anchor: 'free',
                overlaying: 'y'
            }),
            
            legend: { 
                x: 1.02, 
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1,
                groupclick: 'toggleitem',
                uirevision: uiRevisionId
            },
            
            height: 600,
            margin: { 
                l: leftMargin, 
                r: sharedState.hasDistanceData ? 100 : 50, 
                t: 80, 
                b: 60 
            },
            plot_bgcolor: 'rgba(248,249,250,0.3)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            autosize: true
        };
        
        // Add temperature axis if available
        if (sharedState.hasTemperatureData) {
            layout.yaxis4 = createYAxisConfig({
                title: 'Temperature [°C]',
                color: temperatureColors[0],
                side: 'left',
                position: 0.24,
                range: axisRanges.temperature,
                gridColor: 'rgba(255, 68, 68, 0.15)',
                zerolineColor: null,
                anchor: 'free',
                overlaying: 'y'
            });
        }
        
        // Add distance axis if available (right side)
        if (sharedState.hasDistanceData) {
            layout.yaxis5 = createYAxisConfig({
                title: 'Distance [mm]',
                color: distanceColors[0],
                side: 'right',
                position: 1.0,
                range: axisRanges.distance,
                gridColor: 'rgba(0, 191, 255, 0.15)',
                zerolineColor: null,
                anchor: 'free',
                overlaying: 'y'
            });
        }
        
        return layout;
    }
    
    // Helper function to create consistent Y-axis configurations
    function createYAxisConfig(options) {
        const config = {
            title: {
                text: options.title,
                font: { color: options.color, size: 14, family: 'Arial Black' },
                standoff: 12
            },
            tickfont: { color: options.color, size: 12 },
            side: options.side,
            position: options.position,
            showgrid: true,
            gridcolor: options.gridColor,
            gridwidth: 1,
            automargin: true,
            linecolor: options.color,
            linewidth: 3,
            showline: true
        };
        
        // Add range if provided
        if (options.range) {
            config.range = options.range;
        }
        
        // Add zeroline configuration
        if (options.zerolineColor) {
            config.zeroline = true;
            config.zerolinecolor = options.zerolineColor;
            config.zerolinewidth = 2;
        } else {
            config.zeroline = false;
        }
        
        // Add anchor and overlaying for secondary axes
        if (options.anchor) {
            config.anchor = options.anchor;
        }
        if (options.overlaying) {
            config.overlaying = options.overlaying;
        }
        
        return config;
    }
    
    // Create initial plot with all traces and event handlers
    async function createPlot(traces, layout) {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv) {
            throw new Error('Plot container not found');
        }
        
        const config = {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToAdd: ['pan2d', 'select2d', 'lasso2d'],
            scrollZoom: false
        };
        
        try {
            // Clear any existing content
            if (isLoading) {
                clearExistingPlot(plotDiv);
                isLoading = false;
            }
            
            // Create the plot
            sharedState.currentPlot = await Plotly.newPlot('plot', traces, layout, config);
            
            // Setup all event listeners
            setupEventListeners();
            
            console.log('Complete plot created successfully with event handlers');
            return sharedState.currentPlot;
            
        } catch (error) {
            console.error('Error creating plot:', error);
            throw error;
        }
    }
    
    // Setup all plot event listeners
    function setupEventListeners() {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv) return;
        
        // Remove existing listeners
        plotDiv.removeAllListeners('plotly_relayout');
        plotDiv.removeAllListeners('plotly_restyle');
        
        // Add zoom/pan handler
        plotDiv.on('plotly_relayout', handleZoomEvent);
        
        // Add visibility change handler
        plotDiv.on('plotly_restyle', handleVisibilityEvent);
        
        // Add Y-axis scroll zoom
        setupYAxisScrollZoom();
        
        console.log('Plot event listeners setup complete');
    }
    
    // Handle zoom/pan events with debouncing and visibility preservation
    async function handleZoomEvent(eventData) {
        if (isHandlingZoom) return;
        if (!eventData['xaxis.range[0]'] && !eventData['xaxis.range[1]']) return;
        if (!sharedState.currentExperiment || !dataManager) return;
        
        const startTime = eventData['xaxis.range[0]'] || 0;
        const endTime = eventData['xaxis.range[1]'] || sharedState.metadata.duration;
        
        // Debounce rapid zoom events
        if (zoomTimeout) {
            clearTimeout(zoomTimeout);
        }
        
        zoomTimeout = setTimeout(async () => {
            await performZoomResample(startTime, endTime);
        }, 150); // 150ms debounce
    }
    
    // Perform the actual zoom resampling
    async function performZoomResample(startTime, endTime) {
        if (isHandlingZoom) return;
        
        try {
            isHandlingZoom = true;
            
            // IMPORTANT: Capture current visibility state before rebuilding
            const savedVisibilityState = dataManager.captureCurrentVisibility();
            
            console.log(`Resampling data for zoom: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);
            
            // Build new traces with higher resolution for zoomed area
            const result = await dataManager.buildAllTraces(startTime, endTime, 3000);
            
            // IMPORTANT: Restore visibility state to new traces
            dataManager.restoreVisibilityState(result.traces, savedVisibilityState);
            
            // Update plot with preserved visibility
            await Plotly.react('plot', result.traces, sharedState.currentPlot.layout);
            
            // Notify alignment controls about time range change
            if (window.AlignmentControls && window.AlignmentControls.updateTimeRange) {
                window.AlignmentControls.updateTimeRange({
                    start: startTime,
                    end: endTime
                });
            }
            
        } catch (error) {
            console.error('Error during zoom resampling:', error);
        } finally {
            isHandlingZoom = false;
        }
    }
    
    // Handle visibility changes from legend clicks
    function handleVisibilityEvent(eventData) {
        if (eventData && eventData[0] && eventData[0].hasOwnProperty('visible')) {
            console.log('Visibility changed via legend:', eventData);
            
            // Update internal visibility state after a short delay
            setTimeout(() => {
                sharedState.currentVisibilityState = dataManager.captureCurrentVisibility();
            }, 100);
        }
    }
    
    // Setup Y-axis scroll zoom functionality
    function setupYAxisScrollZoom() {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv) return;
        
        // Remove existing wheel listeners
        plotDiv.removeEventListener('wheel', handleWheelZoom);
        plotDiv.removeEventListener('mousemove', handleMouseMove);
        
        // Add new listeners
        plotDiv.addEventListener('wheel', handleWheelZoom, { passive: false });
        plotDiv.addEventListener('mousemove', handleMouseMove);
        
        console.log('Y-axis scroll zoom setup complete');
    }
    
    // Handle wheel events for Y-axis zooming
    function handleWheelZoom(e) {
        const svg = e.target.closest('.plotly .svg-container > svg');
        if (!svg) return;
        
        const plotBounds = svg.getBoundingClientRect();
        const mouseX = e.clientX - plotBounds.left;
        const plotWidth = plotBounds.width;
        
        // Calculate axis zones
        const axisZones = calculateAxisZones(plotWidth);
        const targetAxis = determineTargetAxis(mouseX, axisZones);
        
        if (targetAxis && sharedState.currentPlot && sharedState.currentPlot.layout[targetAxis.id]?.range) {
            e.preventDefault();
            
            const currentRange = sharedState.currentPlot.layout[targetAxis.id].range;
            const center = (currentRange[1] + currentRange[0]) / 2;
            const span = currentRange[1] - currentRange[0];
            const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
            const newSpan = span * zoomFactor;
            const newRange = [center - newSpan/2, center + newSpan/2];
            
            const update = {};
            update[targetAxis.id + '.range'] = newRange;
            Plotly.relayout('plot', update);
        }
    }
    
    // Handle mouse movement for cursor feedback
    function handleMouseMove(e) {
        const svg = e.target.closest('.plotly .svg-container > svg');
        if (!svg) return;
        
        const plotBounds = svg.getBoundingClientRect();
        const mouseX = e.clientX - plotBounds.left;
        const plotWidth = plotBounds.width;
        
        const axisZones = calculateAxisZones(plotWidth);
        const targetAxis = determineTargetAxis(mouseX, axisZones);
        
        const plotDiv = document.getElementById('plot');
        if (targetAxis) {
            plotDiv.style.cursor = 'ns-resize';
            plotDiv.title = `Scroll to zoom ${targetAxis.name} axis`;
        } else {
            plotDiv.style.cursor = 'default';
            plotDiv.title = '';
        }
    }
    
    // Calculate axis zone positions based on plot width
    function calculateAxisZones(plotWidth) {
        return {
            voltage: { start: plotWidth * 0.10, end: plotWidth * 0.15, id: 'yaxis', name: 'Voltage' },
            current: { start: plotWidth * 0.15, end: plotWidth * 0.20, id: 'yaxis2', name: 'Current' },
            pressure: { start: plotWidth * 0.20, end: plotWidth * 0.25, id: 'yaxis3', name: 'Pressure' },
            temperature: sharedState.hasTemperatureData ? 
                { start: plotWidth * 0.25, end: plotWidth * 0.30, id: 'yaxis4', name: 'Temperature' } : null,
            distance: sharedState.hasDistanceData ? 
                { start: plotWidth * 0.90, end: plotWidth * 1.0, id: 'yaxis5', name: 'Distance' } : null
        };
    }
    
    // Determine which axis the mouse is over
    function determineTargetAxis(mouseX, zones) {
        for (const [key, zone] of Object.entries(zones)) {
            if (zone && mouseX >= zone.start && mouseX < zone.end) {
                return zone;
            }
        }
        return null;
    }
    
    // Reset zoom to full view with proper axis ranges
    function resetZoom() {
        if (!sharedState.metadata || !sharedState.currentPlot) return;
        
        const axisRanges = dataManager.calculateAxisRanges();
        const update = { 'xaxis.range': [0, sharedState.metadata.duration] };
        
        // Reset all Y-axis ranges
        if (axisRanges.voltage) update['yaxis.range'] = axisRanges.voltage;
        if (axisRanges.current) update['yaxis2.range'] = axisRanges.current;
        if (axisRanges.pressure) update['yaxis3.range'] = axisRanges.pressure;
        if (axisRanges.temperature) update['yaxis4.range'] = axisRanges.temperature;
        if (axisRanges.distance) update['yaxis5.range'] = axisRanges.distance;
        
        Plotly.relayout('plot', update);
        
        // Notify alignment controls
        if (window.AlignmentControls && window.AlignmentControls.updateTimeRange) {
            window.AlignmentControls.updateTimeRange({
                start: 0,
                end: sharedState.metadata.duration
            });
        }
    }
    
    // Reset Y-axes to auto-range
    function resetYAxes() {
        if (!sharedState.currentPlot) return;
        
        const resetUpdate = {
            'yaxis.range': null,
            'yaxis2.range': null,
            'yaxis3.range': null
        };
        
        if (sharedState.hasTemperatureData) {
            resetUpdate['yaxis4.range'] = null;
        }
        
        if (sharedState.hasDistanceData) {
            resetUpdate['yaxis5.range'] = null;
        }
        
        Plotly.relayout('plot', resetUpdate);
    }
    
    // Apply temporary offset for real-time preview (used by alignment controls)
    function applyTemporaryOffset(dataSource, offsetUs) {
        console.log(`Applying temporary ${dataSource} offset: ${offsetUs} µs`);
        
        // Store temporary offset
        if (!sharedState.temporaryOffsets) {
            sharedState.temporaryOffsets = {};
        }
        sharedState.temporaryOffsets[dataSource] = offsetUs;
    }
    
    // Get current time range from plot
    function getCurrentTimeRange() {
        try {
            const plotDiv = document.getElementById('plot');
            if (plotDiv && plotDiv.layout && plotDiv.layout.xaxis && plotDiv.layout.xaxis.range) {
                const range = plotDiv.layout.xaxis.range;
                return { start: range[0], end: range[1] };
            }
        } catch (error) {
            console.warn('Could not get current time range from plot:', error);
        }
        
        // Fallback to metadata or default
        if (sharedState.metadata) {
            return { start: 0, end: sharedState.metadata.duration };
        }
        
        return { start: 0, end: 100 };
    }
    
    // Refresh plot while maintaining current view (for alignment changes)
    async function refreshCurrentView() {
        if (!sharedState.currentPlot || !sharedState.currentPlot.layout || !sharedState.currentPlot.layout.xaxis) {
            console.warn('Cannot refresh current view - plot not ready');
            return;
        }
        
        const currentRange = sharedState.currentPlot.layout.xaxis.range;
        if (currentRange) {
            console.log('Refreshing current view with range:', currentRange);
            await performZoomResample(currentRange[0], currentRange[1]);
        }
    }
    
    // Check if plot is ready for interaction
    function isPlotReady() {
        return !isLoading && !!sharedState.currentPlot;
    }
    
    // Destroy plot and clean up event listeners
    function destroy() {
        const plotDiv = document.getElementById('plot');
        if (plotDiv) {
            // Remove event listeners
            plotDiv.removeAllListeners('plotly_relayout');
            plotDiv.removeAllListeners('plotly_restyle');
            plotDiv.removeEventListener('wheel', handleWheelZoom);
            plotDiv.removeEventListener('mousemove', handleMouseMove);
            
            // Clear plot
            if (window.Plotly) {
                try {
                    Plotly.purge('plot');
                } catch (error) {
                    console.warn('Error purging plot during destroy:', error);
                }
            }
            
            // Clear content
            plotDiv.innerHTML = '';
        }
        
        // Clear timeouts
        if (zoomTimeout) {
            clearTimeout(zoomTimeout);
            zoomTimeout = null;
        }
        
        // Reset state
        isHandlingZoom = false;
        isLoading = false;
        sharedState.currentPlot = null;
        
        console.log('Plot layout manager destroyed and cleaned up');
    }
    
    // Public interface
    return {
        // Initialization
        init,
        
        // Simplified loading functions
        showPlotPlaceholder,
        
        // Plot creation and management
        createPlotLayout,
        createPlot,
        setupEventListeners,
        
        // Event handling
        handleZoomEvent,
        handleVisibilityEvent,
        
        // User interactions
        resetZoom,
        resetYAxes,
        applyTemporaryOffset,
        
        // Utilities
        getCurrentTimeRange,
        refreshCurrentView,
        
        // Status
        isPlotReady,
        
        // Lifecycle
        destroy
    };
})();