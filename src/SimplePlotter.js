// src/SimplePlotter.js - Minimal binary file plotter with hardcoded file path
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
                    binaryReader.getMetadata()
                );

                // Return metadata
                const metadata = this.processor.getMetadataSummary();
                const ranges = this.processor.getDataRanges();

                res.json({
                    success: true,
                    filename: path.basename(this.BINARY_FILE_PATH),
                    metadata: metadata,
                    ranges: ranges
                });

            } catch (error) {
                console.error('Error loading file:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get channel data
        this.app.get('/api/data/:channel', (req, res) => {
            try {
                const channel = parseInt(req.params.channel);
                const startTime = parseFloat(req.query.start || 0);
                const endTime = parseFloat(req.query.end || 200);
                const maxPoints = parseInt(req.query.maxPoints || 2000);

                if (!this.processor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                if (isNaN(channel) || channel < 0 || channel > 7) {
                    return res.status(400).json({ error: 'Invalid channel number' });
                }

                const data = this.processor.getResampledData(channel, startTime, endTime, maxPoints);
                
                res.json({
                    time: data.time,
                    values: data.values,
                    meta: {
                        channel,
                        startTime,
                        endTime,
                        requestedMaxPoints: maxPoints,
                        actualPoints: data.time.length
                    }
                });

            } catch (error) {
                console.error('Error getting channel data:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                hasFile: !!this.processor,
                filePath: this.BINARY_FILE_PATH,
                timestamp: new Date().toISOString()
            });
        });
    }

    async start(port = 3000) {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, (error) => {
                if (error) {
                    console.error(`Failed to start server: ${error.message}`);
                    reject(error);
                    return;
                }

                console.log(`Simplified Binary Plotter started at http://localhost:${port}`);
                console.log(`Configured to load: ${this.BINARY_FILE_PATH}`);
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