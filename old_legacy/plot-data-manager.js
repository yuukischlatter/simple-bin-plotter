// plot-data-manager.js - Data fetching with simplified loading
window.PlotDataManager = (function() {
    'use strict';
    
    // Configuration constants
    const colors = window.appConfig?.colors || ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
    const temperatureColors = ['#ff4444', '#ff6b35', '#f7931e', '#ffd700', '#ff1493', '#ff69b4', '#dda0dd', '#9370db'];
    const distanceColors = ['#00bfff', '#1e90ff', '#4169e1', '#0000ff'];
    
    // Private state - will be shared with other modules
    let sharedState = null;
    
    // Initialize with shared state object
    function init(stateObject) {
        sharedState = stateObject;
        console.log('PlotDataManager initialized');
    }
    
    // API helper function
    async function fetchApi(endpoint) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    }
    
    // Load experiment metadata and ranges
    async function loadExperimentMetadata(folderName) {
        try {
            // Reset shared state for new experiment
            resetSharedStateForNewExperiment();
            
            // Get binary metadata
            sharedState.metadata = await fetchApi(`/api/experiment/${folderName}/metadata`);
            sharedState.dataRanges = await fetchApi(`/api/experiment/${folderName}/ranges`);
            
            // Check for temperature data availability
            sharedState.hasTemperatureData = await checkDataAvailability(folderName, 'temperature');
            if (sharedState.hasTemperatureData) {
                sharedState.temperatureMetadata = await fetchApi(`/api/experiment/${folderName}/temperature/metadata`);
            }
            
            // Check for distance sensor data availability
            sharedState.hasDistanceData = await checkDataAvailability(folderName, 'distance');
            if (sharedState.hasDistanceData) {
                sharedState.distanceMetadata = await fetchApi(`/api/experiment/${folderName}/distance/metadata`);
            }
            
            return {
                hasTemperature: sharedState.hasTemperatureData,
                hasDistance: sharedState.hasDistanceData,
                duration: sharedState.metadata.duration
            };
            
        } catch (error) {
            console.error('Error loading experiment metadata:', error);
            throw error;
        }
    }
    
    // Reset shared state for new experiment
    function resetSharedStateForNewExperiment() {
        sharedState.metadata = null;
        sharedState.temperatureMetadata = null;
        sharedState.distanceMetadata = null;
        sharedState.dataRanges = null;
        sharedState.hasTemperatureData = false;
        sharedState.hasDistanceData = false;
    }
    
    // Check if specific data type is available
    async function checkDataAvailability(folderName, dataType) {
        try {
            const response = await fetch(`/api/experiment/${folderName}/${dataType}/metadata`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    // Build all traces for initial plot
    async function buildAllTraces(startTime = 0, endTime = null, maxPoints = 2000) {
        if (!sharedState.metadata || !sharedState.currentExperiment) {
            throw new Error('Metadata not loaded');
        }
        
        const finalEndTime = endTime || sharedState.metadata.duration;
        const traces = [];
        let totalDisplayPoints = 0;
        
        try {
            // Build binary channel traces
            const binaryResult = await buildBinaryTraces(startTime, finalEndTime, maxPoints);
            traces.push(...binaryResult.traces);
            totalDisplayPoints += binaryResult.points;
            
            // Build temperature traces if available
            if (sharedState.hasTemperatureData) {
                const tempResult = await buildTemperatureTraces(startTime, finalEndTime, Math.floor(maxPoints / 2));
                traces.push(...tempResult.traces);
                totalDisplayPoints += tempResult.points;
            }
            
            // Build distance traces if available
            if (sharedState.hasDistanceData) {
                const distanceResult = await buildDistanceTraces(startTime, finalEndTime, Math.floor(maxPoints / 4));
                traces.push(...distanceResult.traces);
                totalDisplayPoints += distanceResult.points;
            }
            
            return {
                traces: traces,
                totalPoints: totalDisplayPoints,
                info: {
                    binary: traces.filter(t => t.legendgroup === 'binary').length,
                    temperature: traces.filter(t => t.legendgroup === 'temperature').length,
                    distance: traces.filter(t => t.legendgroup === 'distance').length
                }
            };
            
        } catch (error) {
            console.error('Error building traces:', error);
            throw error;
        }
    }
    
    // Build binary channel traces
    async function buildBinaryTraces(startTime, endTime, maxPoints) {
        const traces = [];
        let totalPoints = 0;
        
        for (let channel = 0; channel < 8; channel++) {
            if (!sharedState.visibleChannels.includes(channel)) continue;
            
            try {
                const data = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/data/${channel}?start=${startTime}&end=${endTime}&maxPoints=${maxPoints}`);
                const ch = sharedState.metadata.channels[channel];
                
                traces.push({
                    x: data.time,
                    y: data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${ch.label} [${ch.unit}]`,
                    line: { color: colors[channel], width: 1.5 },
                    yaxis: getYAxisForUnit(ch.unit),
                    visible: true,
                    legendgroup: 'binary',
                    showlegend: true
                });
                
                totalPoints += data.time.length;
                
            } catch (error) {
                console.warn(`Failed to load binary channel ${channel}:`, error.message);
            }
        }
        
        return { traces, points: totalPoints };
    }
    
    // Build temperature traces
    async function buildTemperatureTraces(startTime, endTime, maxPoints) {
        const traces = [];
        let totalPoints = 0;
        
        try {
            const startTimeUs = startTime * 1000000;
            const endTimeUs = endTime * 1000000;
            
            // Use the consolidated temperature endpoint
            const allTempData = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/temperature/data?start=${startTimeUs}&end=${endTimeUs}&maxPoints=${maxPoints}`);
            
            // Process each temperature channel
            const channelNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
            for (let tempChannel = 0; tempChannel < 8; tempChannel++) {
                if (!sharedState.visibleTemperatureChannels.includes(tempChannel)) continue;
                
                const channelKey = channelNames[tempChannel];
                const tempChannelData = allTempData.channels[channelKey];
                
                // Only add trace if we have actual data
                if (tempChannelData && tempChannelData.time && tempChannelData.time.length > 0) {
                    traces.push({
                        x: tempChannelData.time,
                        y: tempChannelData.values,
                        type: 'scatter',
                        mode: 'lines',
                        name: `${channelKey} [°C]`,
                        line: { color: temperatureColors[tempChannel], width: 2.0 },
                        yaxis: 'y4', // Temperature axis
                        visible: true,
                        legendgroup: 'temperature',
                        showlegend: true
                    });
                    
                    totalPoints += tempChannelData.time.length;
                }
            }
            
        } catch (error) {
            console.warn('Could not load temperature data:', error.message);
        }
        
        return { traces, points: totalPoints };
    }
    
    // Build distance traces
    async function buildDistanceTraces(startTime, endTime, maxPoints) {
        const traces = [];
        let totalPoints = 0;
        
        try {
            const distanceData = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/distance/data?start=${startTime}&end=${endTime}&maxPoints=${maxPoints}`);
            
            // Only add trace if we have actual data and it's visible
            if (distanceData && distanceData.time && distanceData.time.length > 0 && sharedState.visibleDistanceChannels.includes(0)) {
                traces.push({
                    x: distanceData.time,
                    y: distanceData.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Distance [mm]',
                    line: { color: distanceColors[0], width: 2.0 },
                    yaxis: 'y5', // Distance axis
                    visible: true,
                    legendgroup: 'distance',
                    showlegend: true
                });
                
                totalPoints += distanceData.time.length;
            }
            
        } catch (error) {
            console.warn('Could not load distance sensor data:', error.message);
        }
        
        return { traces, points: totalPoints };
    }
    
    // Capture current visibility state from plot
    function captureCurrentVisibility() {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv || !plotDiv.data) {
            return {};
        }
        
        const visibilityState = {};
        plotDiv.data.forEach((trace, index) => {
            if (trace.name) {
                // Store visibility by trace name for consistency
                visibilityState[trace.name] = trace.visible !== false && trace.visible !== 'legendonly';
            }
        });
        
        return visibilityState;
    }
    
    // Restore visibility state to new traces
    function restoreVisibilityState(traces, savedVisibilityState) {
        if (!savedVisibilityState || Object.keys(savedVisibilityState).length === 0) {
            return traces; // No saved state, return traces as-is
        }
        
        traces.forEach(trace => {
            if (trace.name && savedVisibilityState.hasOwnProperty(trace.name)) {
                const wasVisible = savedVisibilityState[trace.name];
                trace.visible = wasVisible ? true : 'legendonly';
            }
        });
        
        return traces;
    }
    
    // Get trace indices for specific data source
    function getDataSourceTraceIndices(dataSource) {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv || !plotDiv.data) return [];
        
        const indices = [];
        plotDiv.data.forEach((trace, index) => {
            if (!trace.name) return;
            
            const traceName = trace.name.toLowerCase();
            switch (dataSource) {
                case 'temperature':
                    if (traceName.includes('t1') || traceName.includes('t2') || traceName.includes('t3') || 
                        traceName.includes('t4') || traceName.includes('t5') || traceName.includes('t6') || 
                        traceName.includes('t7') || traceName.includes('t8')) {
                        indices.push(index);
                    }
                    break;
                case 'distance':
                    if (traceName.includes('distance')) {
                        indices.push(index);
                    }
                    break;
                case 'binary':
                    // Binary channels are voltage, current, pressure
                    if (traceName.includes('[v]') || traceName.includes('[a]') || traceName.includes('[bar]')) {
                        indices.push(index);
                    }
                    break;
            }
        });
        
        return indices;
    }
    
    // Selective refresh for temperature data only
    async function refreshTemperatureData() {
        if (!sharedState.hasTemperatureData || !sharedState.currentExperiment) {
            console.warn('No temperature data to refresh');
            return false;
        }
        
        try {
            const timeRange = getCurrentTimeRange();
            const startTimeUs = timeRange.start * 1000000;
            const endTimeUs = timeRange.end * 1000000;
            
            // Get temperature trace indices
            const tempIndices = getDataSourceTraceIndices('temperature');
            if (tempIndices.length === 0) {
                console.warn('No temperature traces found to refresh');
                return false;
            }
            
            // Fetch new temperature data
            const allTempData = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/temperature/data?start=${startTimeUs}&end=${endTimeUs}&maxPoints=1000`);
            
            // Update only temperature traces
            const updateData = { x: [], y: [] };
            const channelNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
            
            tempIndices.forEach((traceIndex, i) => {
                const channelKey = channelNames[i % 8]; // Map trace index to channel
                const tempChannelData = allTempData.channels[channelKey];
                
                if (tempChannelData && tempChannelData.time && tempChannelData.time.length > 0) {
                    updateData.x.push(tempChannelData.time);
                    updateData.y.push(tempChannelData.values);
                } else {
                    // Provide empty data if channel not available
                    updateData.x.push([]);
                    updateData.y.push([]);
                }
            });
            
            // Use Plotly.restyle to update only temperature traces
            await Plotly.restyle('plot', updateData, tempIndices);
            
            return true;
            
        } catch (error) {
            console.error('Error refreshing temperature data:', error);
            throw error;
        }
    }
    
    // Selective refresh for distance data only
    async function refreshDistanceData() {
        if (!sharedState.hasDistanceData || !sharedState.currentExperiment) {
            console.warn('No distance data to refresh');
            return false;
        }
        
        try {
            const timeRange = getCurrentTimeRange();
            
            // Get distance trace indices
            const distanceIndices = getDataSourceTraceIndices('distance');
            if (distanceIndices.length === 0) {
                console.warn('No distance traces found to refresh');
                return false;
            }
            
            // Fetch new distance data
            const distanceData = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/distance/data?start=${timeRange.start}&end=${timeRange.end}&maxPoints=1000`);
            
            if (distanceData && distanceData.time && distanceData.time.length > 0) {
                // Use Plotly.restyle to update only distance traces
                const updateData = {
                    x: [distanceData.time],
                    y: [distanceData.values]
                };
                
                await Plotly.restyle('plot', updateData, distanceIndices);
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('Error refreshing distance data:', error);
            throw error;
        }
    }
    
    // Get FFT-specific data with proper sampling
    async function getFFTData(channel, startTime, endTime, maxPoints) {
        try {
            if (!sharedState.metadata) {
                throw new Error('Metadata not available for FFT');
            }
            
            const channelInfo = sharedState.metadata.channels[channel];
            
            // Get data for FFT analysis
            const data = await fetchApi(`/api/experiment/${sharedState.currentExperiment}/fft-data/${channel}?start=${startTime}&end=${endTime}&maxPoints=${maxPoints}`);
            
            return {
                time: data.time,
                values: data.values,
                samplingRate: data.samplingRate,
                channel: {
                    index: channel,
                    label: channelInfo.label,
                    unit: channelInfo.unit
                },
                meta: data.meta || {
                    timeRange: { start: startTime, end: endTime },
                    actualPoints: data.values.length,
                    requestedMaxPoints: maxPoints
                }
            };
            
        } catch (error) {
            console.error(`Error preparing FFT data for channel ${channel}:`, error.message);
            throw error;
        }
    }
    
    // Calculate data ranges for auto-scaling
    function calculateAxisRanges() {
        if (!sharedState.dataRanges) return {};
        
        const ranges = {};
        
        // Temperature range calculation
        if (sharedState.hasTemperatureData) {
            let minTemp = Infinity;
            let maxTemp = -Infinity;
            
            for (let i = 0; i < 8; i++) {
                const tempRangeKey = `temperature_${i}`;
                if (sharedState.dataRanges[tempRangeKey]) {
                    minTemp = Math.min(minTemp, sharedState.dataRanges[tempRangeKey].min);
                    maxTemp = Math.max(maxTemp, sharedState.dataRanges[tempRangeKey].max);
                }
            }
            
            if (minTemp !== Infinity) {
                const padding = (maxTemp - minTemp) * 0.1;
                ranges.temperature = [minTemp - padding, maxTemp + padding];
            } else {
                ranges.temperature = [0, 100];
            }
        }
        
        // Distance range calculation
        if (sharedState.hasDistanceData && sharedState.dataRanges.distance_0) {
            ranges.distance = [sharedState.dataRanges.distance_0.min, sharedState.dataRanges.distance_0.max];
        } else if (sharedState.hasDistanceData) {
            ranges.distance = [0, 50]; // Fallback range
        }
        
        // Binary channel ranges
        if (sharedState.dataRanges) {
            ranges.voltage = [sharedState.dataRanges.channel_0?.min || -1, sharedState.dataRanges.channel_0?.max || 1];
            ranges.current = [
                Math.min(sharedState.dataRanges.channel_2?.min || 0, sharedState.dataRanges.channel_3?.min || 0, 
                        sharedState.dataRanges.channel_4?.min || 0, sharedState.dataRanges.channel_5?.min || 0),
                Math.max(sharedState.dataRanges.channel_2?.max || 1, sharedState.dataRanges.channel_3?.max || 1,
                        sharedState.dataRanges.channel_4?.max || 1, sharedState.dataRanges.channel_5?.max || 1)
            ];
            ranges.pressure = [
                Math.min(sharedState.dataRanges.channel_6?.min || 0, sharedState.dataRanges.channel_7?.min || 0),
                Math.max(sharedState.dataRanges.channel_6?.max || 1, sharedState.dataRanges.channel_7?.max || 1)
            ];
        }
        
        return ranges;
    }
    
    // Utility: Get Y-axis assignment based on unit
    function getYAxisForUnit(unit) {
        switch (unit) {
            case 'V': return 'y';
            case 'A': return 'y2';
            case 'Bar': return 'y3';
            case '°C': return 'y4';
            case 'mm': return 'y5';
            default: return 'y';
        }
    }
    
    // Utility: Get current time range (fallback method)
    function getCurrentTimeRange() {
        try {
            const plotDiv = document.getElementById('plot');
            if (plotDiv && plotDiv.layout && plotDiv.layout.xaxis && plotDiv.layout.xaxis.range) {
                const range = plotDiv.layout.xaxis.range;
                return { start: range[0], end: range[1] };
            }
        } catch (error) {
            console.warn('Could not get current time range:', error);
        }
        
        // Fallback to metadata or default
        if (sharedState.metadata) {
            return { start: 0, end: sharedState.metadata.duration };
        }
        
        return { start: 0, end: 100 };
    }
    
    // Public interface
    return {
        // Initialization
        init,
        
        // Enhanced metadata loading
        loadExperimentMetadata,
        checkDataAvailability,
        
        // Trace building
        buildAllTraces,
        buildBinaryTraces,
        buildTemperatureTraces,
        buildDistanceTraces,
        
        // Visibility management
        captureCurrentVisibility,
        restoreVisibilityState,
        getDataSourceTraceIndices,
        
        // Selective refresh
        refreshTemperatureData,
        refreshDistanceData,
        
        // Specialized data
        getFFTData,
        
        // Utilities
        calculateAxisRanges,
        getYAxisForUnit,
        getCurrentTimeRange,
        
        // Direct API access
        fetchApi
    };
})();