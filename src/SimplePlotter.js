// src/SimplePlotter.js - Binary file plotter with calculated channels support
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const BinaryReader = require('./BinaryReader');
const DataProcessor = require('./DataProcessor');

class SimplePlotter {
    constructor() {
        this.app = express();
        this.server = null;
        
        // HARDCODED FILE PATH - Change this to your .bin file location
        this.BINARY_FILE_PATH = path.join(__dirname, '..', 'data', 'J25-07-30(3).bin');
        
        this.binaryData = null;
        this.processor = null;
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use('/static', express.static(path.join(__dirname, '..', 'static')));
    }

    setupRoutes() {
        // Main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'static', 'index.html'));
        });

        // Auto-load the hardcoded binary file
        this.app.get('/api/load', async (req, res) => {
            try {
                console.log(`Loading hardcoded binary file: ${this.BINARY_FILE_PATH}`);
                
                // Check if file exists
                try {
                    await fs.access(this.BINARY_FILE_PATH);
                } catch (error) {
                    throw new Error(`Binary file not found: ${this.BINARY_FILE_PATH}`);
                }
                
                // Process the binary file
                const binaryReader = new BinaryReader(this.BINARY_FILE_PATH);
                await binaryReader.readFile();
                
                this.binaryData = binaryReader;
                this.processor = new DataProcessor(
                    binaryReader.getRawData(),
                    binaryReader.getCalculatedData(), // NEW: Pass calculated data
                    binaryReader.getMetadata()
                );

                // Return metadata including calculated channels
                const metadata = this.processor.getMetadataSummary();
                const ranges = this.processor.getDataRanges();
                const availableChannels = this.processor.getAllAvailableChannels();
                const channelsByUnit = this.processor.getChannelsByUnit();
                const defaultChannels = this.processor.getDefaultDisplayChannels();

                res.json({
                    success: true,
                    filename: path.basename(this.BINARY_FILE_PATH),
                    metadata: metadata,
                    ranges: ranges,
                    availableChannels: availableChannels,
                    channelsByUnit: channelsByUnit,
                    defaultChannels: defaultChannels
                });

            } catch (error) {
                console.error('Error loading file:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get channel data - supports both raw and calculated channels
        this.app.get('/api/data/:channelId', (req, res) => {
            try {
                const channelId = req.params.channelId;
                const startTime = parseFloat(req.query.start || 0);
                const endTime = parseFloat(req.query.end || 200);
                const maxPoints = parseInt(req.query.maxPoints || 2000);

                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                // Validate channel ID format
                if (!this.isValidChannelId(channelId)) {
                    return res.status(400).json({ error: 'Invalid channel ID format' });
                }

                // Check if channel exists
                const channelData = this.processor.getChannelById(channelId);
                if (!channelData) {
                    return res.status(404).json({ error: `Channel ${channelId} not found` });
                }

                const data = this.processor.getResampledData(channelId, startTime, endTime, maxPoints);
                
                res.json({
                    time: data.time,
                    values: data.values,
                    meta: {
                        channelId,
                        startTime,
                        endTime,
                        requestedMaxPoints: maxPoints,
                        actualPoints: data.time.length,
                        label: channelData.label,
                        unit: channelData.unit,
                        type: channelId.startsWith('calc_') ? 'calculated' : 'raw'
                    }
                });

            } catch (error) {
                console.error('Error getting channel data:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get multiple channels at once (for efficient loading)
        this.app.post('/api/data/bulk', (req, res) => {
            try {
                const { channelIds, startTime = 0, endTime = 200, maxPoints = 2000 } = req.body;

                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                if (!Array.isArray(channelIds)) {
                    return res.status(400).json({ error: 'channelIds must be an array' });
                }

                const results = {};
                
                for (const channelId of channelIds) {
                    if (!this.isValidChannelId(channelId)) {
                        results[channelId] = { error: 'Invalid channel ID format' };
                        continue;
                    }

                    const channelData = this.processor.getChannelById(channelId);
                    if (!channelData) {
                        results[channelId] = { error: 'Channel not found' };
                        continue;
                    }

                    const data = this.processor.getResampledData(channelId, startTime, endTime, maxPoints);
                    results[channelId] = {
                        time: data.time,
                        values: data.values,
                        meta: {
                            label: channelData.label,
                            unit: channelData.unit,
                            type: channelId.startsWith('calc_') ? 'calculated' : 'raw',
                            actualPoints: data.time.length
                        }
                    };
                }

                res.json({
                    success: true,
                    startTime,
                    endTime,
                    maxPoints,
                    channels: results
                });

            } catch (error) {
                console.error('Error getting bulk channel data:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get channel statistics
        this.app.get('/api/stats/:channelId', (req, res) => {
            try {
                const channelId = req.params.channelId;

                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                if (!this.isValidChannelId(channelId)) {
                    return res.status(400).json({ error: 'Invalid channel ID format' });
                }

                const stats = this.processor.getChannelStatistics(channelId);
                if (!stats) {
                    return res.status(404).json({ error: `Channel ${channelId} not found` });
                }

                res.json({
                    channelId,
                    statistics: stats
                });

            } catch (error) {
                console.error('Error getting channel statistics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get available channels organized by type
        this.app.get('/api/channels', (req, res) => {
            try {
                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                const available = this.processor.getAllAvailableChannels();
                const byUnit = this.processor.getChannelsByUnit();
                const defaults = this.processor.getDefaultDisplayChannels();

                res.json({
                    available,
                    byUnit,
                    defaults,
                    summary: {
                        rawCount: available.raw.length,
                        calculatedCount: available.calculated.length,
                        totalCount: available.raw.length + available.calculated.length
                    }
                });

            } catch (error) {
                console.error('Error getting channel info:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Health check with extended info
        this.app.get('/api/health', (req, res) => {
            const health = { 
                status: 'ok', 
                hasFile: !!this.processor,
                filePath: this.BINARY_FILE_PATH,
                timestamp: new Date().toISOString()
            };

            if (this.processor) {
                const summary = this.processor.getMetadataSummary();
                health.fileInfo = {
                    rawChannels: summary.channels.length,
                    calculatedChannels: summary.calculatedChannels.length,
                    totalPoints: summary.totalPoints,
                    duration: summary.duration,
                    samplingRate: summary.samplingRate
                };
            }

            res.json(health);
        });

        // Get time range for all data
        this.app.get('/api/timerange', (req, res) => {
            try {
                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                const timeRange = this.processor.getTimeRange();
                res.json(timeRange);

            } catch (error) {
                console.error('Error getting time range:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get data ranges for auto-scaling
        this.app.get('/api/ranges', (req, res) => {
            try {
                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                const ranges = this.processor.getDataRanges();
                res.json(ranges);

            } catch (error) {
                console.error('Error getting data ranges:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }

    // Helper method to validate channel ID format
    isValidChannelId(channelId) {
        // Support raw channels: channel_0 through channel_7
        if (/^channel_[0-7]$/.test(channelId)) {
            return true;
        }
        
        // Support calculated channels: calc_0 through calc_6
        if (/^calc_[0-6]$/.test(channelId)) {
            return true;
        }
        
        // Support legacy numeric format: 0 through 7
        if (/^[0-7]$/.test(channelId)) {
            return true;
        }
        
        return false;
    }

    async start(port = 3000) {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, (error) => {
                if (error) {
                    console.error(`Failed to start server: ${error.message}`);
                    reject(error);
                    return;
                }

                console.log(`Binary Plotter with Calculated Channels started at http://localhost:${port}`);
                console.log(`Configured to load: ${this.BINARY_FILE_PATH}`);
                console.log(`Features: Raw channels + Calculated engineering values`);
                resolve(port);
            });
        });
    }

    stop() {
        if (this.server) {
            this.server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    }
}

module.exports = SimplePlotter;