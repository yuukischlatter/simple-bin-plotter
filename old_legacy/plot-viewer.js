// plot-viewer.js - Main controller with lazy loading: immediate placeholder, background binary loading
window.PlotViewer = (function() {
    'use strict';
    
    // Shared state object passed to all modules
    const sharedState = {
        // Core plot state
        currentPlot: null,
        currentExperiment: null,
        isLoading: false,
        
        // Loading states per component
        binaryLoading: false,
        temperatureLoading: false,
        distanceLoading: false,
        
        // Metadata
        metadata: null,
        temperatureMetadata: null,
        distanceMetadata: null,
        dataRanges: null,
        
        // Data availability flags
        hasTemperatureData: false,
        hasDistanceData: false,
        
        // Visibility management
        visibleChannels: [0, 1, 2, 3, 4, 5, 6, 7],
        visibleTemperatureChannels: [0, 1, 2, 3, 4, 5, 6, 7],
        visibleDistanceChannels: [0],
        currentVisibilityState: {},
        
        // Alignment and offsets
        temporaryOffsets: {}
    };
    
    // Module references
    let dataManager = null;
    let layoutManager = null;
    let initialized = false;
    
    // Initialize all modules
    function initialize() {
        // Check if required modules are available
        if (!window.PlotDataManager || !window.PlotLayoutManager) {
            console.error('Required modules not found. Make sure plot-data-manager.js and plot-layout-manager.js are loaded.');
            return false;
        }
        
        // If already initialized, just verify modules are ready
        if (initialized) {
            console.log('PlotViewer already initialized, verifying module readiness...');
            return dataManager && layoutManager;
        }
        
        // Initialize modules with shared state
        dataManager = window.PlotDataManager;
        layoutManager = window.PlotLayoutManager;
        
        dataManager.init(sharedState);
        layoutManager.init(sharedState, dataManager);
        
        initialized = true;
        console.log('PlotViewer main controller initialized with lazy loading');
        return true;
    }
    
    // MAIN FUNCTION: Load experiment with lazy loading - now non-blocking for binary data
    async function loadExperimentPlot(folderName) {
        if (!initialize()) {
            throw new Error('Failed to initialize PlotViewer modules');
        }
        
        try {
            // Set loading state for binary data specifically
            sharedState.binaryLoading = true;
            updateDataInfo('Loading binary data in background...');
            
            // Clean up previous experiment
            await cleanupPreviousExperiment(folderName);
            
            // Reset state for new experiment
            resetExperimentState(folderName);
            
            // Load experiment metadata (fast)
            updateDataInfo('Loading experiment metadata...');
            const metadataResult = await dataManager.loadExperimentMetadata(folderName);
            
            updateDataInfo(`Building plot with ${metadataResult.hasTemperature ? ' temperature' : ''}${metadataResult.hasDistance ? ' + distance' : ''} data...`);
            
            // Build all traces (this is where the 1-minute wait happens for binary data)
            const traceResult = await dataManager.buildAllTraces(0, metadataResult.duration, 2000);
            
            // Create layout
            const layout = layoutManager.createPlotLayout();
            
            // Create plot with traces and layout
            await layoutManager.createPlot(traceResult.traces, layout);
            
            // Capture initial visibility state
            sharedState.currentVisibilityState = dataManager.captureCurrentVisibility();
            
            // Final status update
            const statusParts = [`${traceResult.totalPoints.toLocaleString()} points displayed`];
            if (metadataResult.hasTemperature) statusParts.push(`${sharedState.temperatureMetadata.totalPoints} temp points`);
            if (metadataResult.hasDistance) statusParts.push('distance data');
            
            updateDataInfo(`Plot ready: ${statusParts.join(' + ')}`);
            
            // Notify alignment controls
            if (window.AlignmentControls) {
                window.AlignmentControls.onExperimentLoaded(folderName);
            }
            
            console.log(`Successfully loaded experiment plot: ${folderName}`);
            
        } catch (error) {
            console.error('Error loading experiment plot:', error);
            updateDataInfo('Error loading binary data');
            showError('Failed to load binary data: ' + error.message);
            throw error;
        } finally {
            sharedState.binaryLoading = false;
        }
    }
    
    // Clean up previous experiment before loading new one
    async function cleanupPreviousExperiment(newFolderName) {
        // Only cleanup if we're switching to a different experiment
        if (!sharedState.currentExperiment || sharedState.currentExperiment === newFolderName) {
            return; // No cleanup needed
        }
        
        console.log(`Switching from ${sharedState.currentExperiment} to ${newFolderName} - cleaning up...`);
        
        try {
            // Clean up layout manager (removes event listeners, destroys plot)
            if (initialized && layoutManager && layoutManager.destroy) {
                layoutManager.destroy();
                console.log('Previous plot destroyed successfully');
            }
            
            // Clean up alignment controls
            if (window.AlignmentControls && window.AlignmentControls.hide) {
                window.AlignmentControls.hide();
            }
            
            // Small delay to ensure cleanup completes
            await new Promise(resolve => setTimeout(resolve, 50));
            
        } catch (error) {
            console.warn('Error during previous experiment cleanup:', error);
            // Continue anyway - don't let cleanup errors prevent new experiment loading
        }
    }
    
    // Reset state for new experiment
    function resetExperimentState(folderName) {
        console.log(`Resetting state for experiment: ${folderName}`);
        
        // Update current experiment first
        sharedState.currentExperiment = folderName;
        
        // Reset loading states
        sharedState.binaryLoading = false;
        sharedState.temperatureLoading = false;
        sharedState.distanceLoading = false;
        
        // Reset all other state
        sharedState.temporaryOffsets = {};
        sharedState.currentVisibilityState = {};
        sharedState.metadata = null;
        sharedState.temperatureMetadata = null;
        sharedState.distanceMetadata = null;
        sharedState.dataRanges = null;
        sharedState.hasTemperatureData = false;
        sharedState.hasDistanceData = false;
        sharedState.currentPlot = null;
        
        // Reset visibility arrays to defaults
        sharedState.visibleChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        sharedState.visibleTemperatureChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        sharedState.visibleDistanceChannels = [0];
        
        console.log('Experiment state reset completed');
    }
    
    // IMMEDIATE FUNCTION: Show plot placeholder without waiting for data
    function showPlotPlaceholder(experimentName) {
        const plotDiv = document.getElementById('plot');
        if (!plotDiv) {
            console.warn('Plot container not found for placeholder');
            return;
        }
        
        console.log('Showing plot placeholder while binary data loads...');
        
        plotDiv.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; 
                       flex-direction: column; color: #495057; text-align: center;">
                <div style="margin-bottom: 30px;">
                    <div class="spinner" style="margin: 0 auto 20px;"></div>
                    <h3 style="margin-bottom: 20px; color: #1E5BA8;">Loading Binary Data</h3>
                    <p style="color: #6c757d; margin-bottom: 25px;">Experiment: ${experimentName}</p>
                </div>
                
                <div style="margin-top: 25px; padding: 15px 20px; background: #e6f2ff; border-radius: 4px; border: 1px solid #1E5BA8;">
                    <p style="color: #1E5BA8; font-size: 14px; margin: 0;">
                        ⏳ <strong>Processing:</strong> Binary data loading takes ~1 minute
                    </p>
                </div>
            </div>
        `;
        
        // Clear any existing plot
        if (window.Plotly && plotDiv._fullLayout) {
            try {
                Plotly.purge('plot');
            } catch (error) {
                console.warn('Error purging existing plot:', error);
            }
        }
        
        console.log('Plot placeholder displayed');
    }
    
    // Control functions for UI
    function resetZoom() {
        if (!initialized || !layoutManager) {
            console.warn('PlotViewer not initialized');
            return;
        }
        layoutManager.resetZoom();
    }
    
    function resetYAxes() {
        if (!initialized || !layoutManager) {
            console.warn('PlotViewer not initialized');
            return;
        }
        layoutManager.resetYAxes();
    }
    
    // Channel visibility controls
    function toggleAllChannels() {
        if (sharedState.visibleChannels.length === 8) {
            sharedState.visibleChannels = [];
        } else {
            sharedState.visibleChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        }
        
        if (sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    function toggleChannel(channel) {
        const index = sharedState.visibleChannels.indexOf(channel);
        if (index > -1) {
            sharedState.visibleChannels.splice(index, 1);
        } else {
            sharedState.visibleChannels.push(channel);
        }
        
        if (sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    function setVisibleChannels(channels) {
        sharedState.visibleChannels = [...channels];
        if (sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    // Temperature channel controls
    function toggleAllTemperatureChannels() {
        if (sharedState.visibleTemperatureChannels.length === 8) {
            sharedState.visibleTemperatureChannels = [];
        } else {
            sharedState.visibleTemperatureChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        }
        
        if (sharedState.hasTemperatureData && sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    function toggleTemperatureChannel(channel) {
        const index = sharedState.visibleTemperatureChannels.indexOf(channel);
        if (index > -1) {
            sharedState.visibleTemperatureChannels.splice(index, 1);
        } else {
            sharedState.visibleTemperatureChannels.push(channel);
        }
        
        if (sharedState.hasTemperatureData && sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    function setVisibleTemperatureChannels(channels) {
        sharedState.visibleTemperatureChannels = [...channels];
        if (sharedState.hasTemperatureData && sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    // Distance channel controls
    function toggleDistanceChannel() {
        if (sharedState.visibleDistanceChannels.length === 0) {
            sharedState.visibleDistanceChannels = [0];
        } else {
            sharedState.visibleDistanceChannels = [];
        }
        
        if (sharedState.hasDistanceData && sharedState.currentExperiment) {
            reloadCurrentExperiment();
        }
    }
    
    // Alignment integration methods
    function refreshTemperatureData() {
        if (!initialized || !dataManager) {
            console.warn('PlotViewer not initialized');
            return Promise.resolve(false);
        }
        
        return dataManager.refreshTemperatureData()
            .then(success => {
                if (success) {
                    updateDataInfo('Temperature data refreshed');
                }
                return success;
            })
            .catch(error => {
                showError('Failed to refresh temperature data');
                throw error;
            });
    }
    
    function refreshDistanceData() {
        if (!initialized || !dataManager) {
            console.warn('PlotViewer not initialized');
            return Promise.resolve(false);
        }
        
        return dataManager.refreshDistanceData()
            .then(success => {
                if (success) {
                    updateDataInfo('Distance data refreshed');
                }
                return success;
            })
            .catch(error => {
                showError('Failed to refresh distance data');
                throw error;
            });
    }
    
    function refreshCurrentView() {
        if (!initialized || !layoutManager) {
            console.warn('PlotViewer not initialized');
            return Promise.resolve();
        }
        
        return layoutManager.refreshCurrentView()
            .catch(error => {
                console.error('Error refreshing current view:', error);
                showError('Failed to refresh plot view');
            });
    }
    
    function applyTemporaryOffset(dataSource, offsetUs) {
        if (!initialized || !layoutManager) {
            console.warn('PlotViewer not initialized');
            return;
        }
        
        layoutManager.applyTemporaryOffset(dataSource, offsetUs);
    }
    
    // FFT data access
    async function getFFTData(channel, startTime, endTime, maxPoints) {
        if (!initialized || !dataManager) {
            throw new Error('PlotViewer not initialized');
        }
        
        return dataManager.getFFTData(channel, startTime, endTime, maxPoints);
    }
    
    // Utility functions
    function getCurrentTimeRange() {
        if (!initialized || !layoutManager) {
            console.warn('PlotViewer not initialized');
            return { start: 0, end: 100 };
        }
        
        return layoutManager.getCurrentTimeRange();
    }
    
    function getCurrentExperiment() {
        return sharedState.currentExperiment;
    }
    
    function getMetadata() {
        return sharedState.metadata;
    }
    
    function getVisibleChannels() {
        return {
            binary: [...sharedState.visibleChannels],
            temperature: [...sharedState.visibleTemperatureChannels],
            distance: [...sharedState.visibleDistanceChannels]
        };
    }
    
    function isLoadingData() {
        return sharedState.binaryLoading || sharedState.temperatureLoading || sharedState.distanceLoading;
    }
    
    function isBinaryLoading() {
        return sharedState.binaryLoading;
    }
    
    function isTemperatureLoading() {
        return sharedState.temperatureLoading;
    }
    
    function isDistanceLoading() {
        return sharedState.distanceLoading;
    }
    
    function hasTemperatureData() {
        return sharedState.hasTemperatureData;
    }
    
    function hasDistanceData() {
        return sharedState.hasDistanceData;
    }
    
    function getTemperatureMetadata() {
        return sharedState.temperatureMetadata;
    }
    
    function getDistanceMetadata() {
        return sharedState.distanceMetadata;
    }
    
    // Helper functions
    function reloadCurrentExperiment() {
        if (sharedState.currentExperiment) {
            console.log('Reloading current experiment due to visibility change');
            loadExperimentPlot(sharedState.currentExperiment);
        }
    }
    
    function setLoadingState(loading) {
        sharedState.isLoading = loading;
        
        // Update loading overlay
        const loadingEl = document.getElementById('loadingOverlay');
        if (loadingEl) {
            loadingEl.style.display = loading ? 'flex' : 'none';
        }
        
        // Notify layout manager
        if (initialized && layoutManager) {
            layoutManager.showLoadingState(loading);
        }
    }
    
    function setBinaryLoadingState(loading) {
        sharedState.binaryLoading = loading;
        console.log(`Binary loading state: ${loading}`);
    }
    
    function setTemperatureLoadingState(loading) {
        sharedState.temperatureLoading = loading;
        console.log(`Temperature loading state: ${loading}`);
    }
    
    function setDistanceLoadingState(loading) {
        sharedState.distanceLoading = loading;
        console.log(`Distance loading state: ${loading}`);
    }
    
    function updateDataInfo(text) {
        // Delegate to orchestrator if available
        if (window.AppOrchestrator && window.AppOrchestrator.updateDataInfo) {
            window.AppOrchestrator.updateDataInfo(text);
        } else {
            console.log('Data Info:', text);
        }
    }
    
    function showError(message) {
        console.error('PlotViewer Error:', message);
        
        // Delegate to orchestrator if available
        if (window.AppOrchestrator && window.AppOrchestrator.showError) {
            window.AppOrchestrator.showError(message);
        }
    }
    
    // Debug and status functions
    function getSystemStatus() {
        return {
            initialized: initialized,
            currentExperiment: sharedState.currentExperiment,
            hasPlot: !!sharedState.currentPlot,
            loadingStates: {
                binary: sharedState.binaryLoading,
                temperature: sharedState.temperatureLoading,
                distance: sharedState.distanceLoading,
                general: sharedState.isLoading
            },
            dataAvailability: {
                binary: !!sharedState.metadata,
                temperature: sharedState.hasTemperatureData,
                distance: sharedState.hasDistanceData
            },
            visibilityState: {
                binaryChannels: sharedState.visibleChannels.length,
                temperatureChannels: sharedState.visibleTemperatureChannels.length,
                distanceChannels: sharedState.visibleDistanceChannels.length,
                tracesWithCustomVisibility: Object.keys(sharedState.currentVisibilityState).length
            },
            modules: {
                dataManager: !!dataManager,
                layoutManager: !!layoutManager
            }
        };
    }
    
    function debugInfo() {
        const status = getSystemStatus();
        console.log('=== PlotViewer Debug Info ===');
        console.log('Status:', status);
        console.log('Shared State:', sharedState);
        console.log('============================');
        return status;
    }
    
    // Cleanup function
    function destroy() {
        console.log('Destroying PlotViewer...');
        
        try {
            // Clean up layout manager
            if (initialized && layoutManager && layoutManager.destroy) {
                layoutManager.destroy();
            }
            
            // Clean up plot container
            const plotDiv = document.getElementById('plot');
            if (plotDiv) {
                plotDiv.innerHTML = '';
                if (window.Plotly && plotDiv._fullLayout) {
                    try {
                        Plotly.purge('plot');
                    } catch (error) {
                        console.warn('Error purging plot:', error);
                    }
                }
            }
            
            // Reset all state
            Object.keys(sharedState).forEach(key => {
                if (Array.isArray(sharedState[key])) {
                    sharedState[key] = [];
                } else if (typeof sharedState[key] === 'object' && sharedState[key] !== null) {
                    sharedState[key] = {};
                } else {
                    sharedState[key] = null;
                }
            });
            
            // Reset initialization flag
            initialized = false;
            dataManager = null;
            layoutManager = null;
            
        } catch (error) {
            console.error('Error during PlotViewer destruction:', error);
        }
        
        console.log('PlotViewer destroyed and cleaned up');
    }
    
    // Public interface - maintaining backward compatibility
    return {
        // Main function called by orchestrator
        loadExperiment: loadExperimentPlot,
        
        // NEW: Immediate functions for lazy loading
        showPlotPlaceholder: showPlotPlaceholder,
        
        // Control functions
        resetZoom: resetZoom,
        resetYAxes: resetYAxes,
        
        // Channel visibility controls
        toggleAllChannels: toggleAllChannels,
        toggleChannel: toggleChannel,
        setVisibleChannels: setVisibleChannels,
        
        // Temperature controls
        toggleAllTemperatureChannels: toggleAllTemperatureChannels,
        toggleTemperatureChannel: toggleTemperatureChannel,
        setVisibleTemperatureChannels: setVisibleTemperatureChannels,
        
        // Distance controls
        toggleDistanceChannel: toggleDistanceChannel,
        
        // Alignment integration
        applyTemporaryOffset: applyTemporaryOffset,
        refreshTemperatureData: refreshTemperatureData,
        refreshDistanceData: refreshDistanceData,
        refreshCurrentView: refreshCurrentView,
        
        // FFT integration
        getFFTData: getFFTData,
        
        // Utility getters
        getCurrentTimeRange: getCurrentTimeRange,
        getCurrentExperiment: getCurrentExperiment,
        getMetadata: getMetadata,
        getVisibleChannels: getVisibleChannels,
        isLoadingData: isLoadingData,
        
        // NEW: Specific loading state getters
        isBinaryLoading: isBinaryLoading,
        isTemperatureLoading: isTemperatureLoading,
        isDistanceLoading: isDistanceLoading,
        
        // NEW: Loading state setters for orchestrator
        setBinaryLoadingState: setBinaryLoadingState,
        setTemperatureLoadingState: setTemperatureLoadingState,
        setDistanceLoadingState: setDistanceLoadingState,
        
        // Data availability checks
        hasTemperatureData: hasTemperatureData,
        hasDistanceData: hasDistanceData,
        getTemperatureMetadata: getTemperatureMetadata,
        getDistanceMetadata: getDistanceMetadata,
        
        // System status and debugging
        getSystemStatus: getSystemStatus,
        debugInfo: debugInfo,
        
        // Lifecycle
        initialize: initialize,
        destroy: destroy
    };
})();