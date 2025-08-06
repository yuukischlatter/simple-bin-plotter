// SimpleServer.js - Minimal server for binary file plotting
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const BinaryReader = require('./BinaryReader');
const DataProcessor = require('./DataProcessor');

class SimpleServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.currentBinaryData = null;
        this.currentProcessor = null;
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Parse JSON bodies
        this.app.use(express.json());
        
        // Serve static files
        this.app.use('/static', express.static(path.join(__dirname, '..', 'static')));
        
        // Setup multer for file uploads
        this.upload = multer({
            storage: multer.memoryStorage(),
            fileFilter: (req, file, cb) => {
                if (file.originalname.endsWith('.bin')) {
                    cb(null, true);
                } else {
                    cb(new Error('Only .bin files are allowed'), false);
                }
            },
            limits: {
                fileSize: 100 * 1024 * 1024 // 100MB limit
            }
        });
    }

    setupRoutes() {
        // Main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'static', 'index.html'));
        });

        // Upload binary file
        this.app.post('/api/upload', this.upload.single('binfile'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'No file uploaded' });
                }

                console.log(`Processing uploaded file: ${req.file.originalname}`);
                
                // Write file to temp location
                const tempPath = path.join(__dirname, '..', 'temp_' + Date.now() + '.bin');
                await fs.writeFile(tempPath, req.file.buffer);
                
                // Process the binary file
                const binaryReader = new BinaryReader(tempPath);
                await binaryReader.readFile();
                
                this.currentBinaryData = binaryReader;
                this.currentProcessor = new DataProcessor(
                    binaryReader.getRawData(),
                    binaryReader.getMetadata()
                );

                // Clean up temp file
                await fs.unlink(tempPath);

                // Return metadata
                const metadata = this.currentProcessor.getMetadataSummary();
                const ranges = this.currentProcessor.getDataRanges();

                res.json({
                    success: true,
                    filename: req.file.originalname,
                    metadata: metadata,
                    ranges: ranges
                });

            } catch (error) {
                console.error('Error processing file:', error);
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

                if (!this.currentProcessor) {
                    return res.status(404).json({ error: 'No file loaded' });
                }

                if (isNaN(channel) || channel < 0 || channel > 7) {
                    return res.status(400).json({ error: 'Invalid channel number' });
                }

                const data = this.currentProcessor.getResampledData(channel, startTime, endTime, maxPoints);
                
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

        // Get current metadata
        this.app.get('/api/metadata', (req, res) => {
            if (!this.currentProcessor) {
                return res.status(404).json({ error: 'No file loaded' });
            }

            const metadata = this.currentProcessor.getMetadataSummary();
            const ranges = this.currentProcessor.getDataRanges();

            res.json({
                metadata: metadata,
                ranges: ranges
            });
        });

        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                hasFile: !!this.currentProcessor,
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

                console.log(`Simple Binary Plotter Server started at http://localhost:${port}`);
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

module.exports = SimpleServer;