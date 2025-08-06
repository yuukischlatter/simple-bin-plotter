const fs = require('fs');
const { convertAdcToPhysical } = require('./utils');

class BinaryReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.rawData = {};
    }

    readCSharpString(buffer, offset) {
        // Read 7-bit encoded length (C# BinaryReader.ReadString format)
        let length = 0;
        let shift = 0;
        let currentOffset = offset;
        
        while (true) {
            const byteVal = buffer.readUInt8(currentOffset++);
            length |= (byteVal & 0x7F) << shift;
            if ((byteVal & 0x80) === 0) break;
            shift += 7;
        }
        
        if (length === 0) {
            return { value: '', newOffset: currentOffset };
        }
        
        const str = buffer.subarray(currentOffset, currentOffset + length).toString('utf8');
        return { value: str, newOffset: currentOffset + length };
    }

    // Convert .NET DateTime.ToBinary() format to Unix milliseconds
    convertBinaryTimestampToUnixMs(startTimeBinary) {
        try {
            // .NET DateTime.ToBinary() format analysis
            let ticks;
            
            if (startTimeBinary >= 0) {
                // UTC time - ticks are in the lower 62 bits
                ticks = startTimeBinary & 0x3FFFFFFFFFFFFFFFn;
            } else {
                // Local time - need to extract ticks differently
                const ticksMask = 0x3FFFFFFFFFFFFFFFn; // 62-bit mask
                ticks = startTimeBinary & ticksMask;
                
                if (ticks < 0) {
                    const absValue = startTimeBinary < 0 ? -startTimeBinary : startTimeBinary;
                    ticks = absValue & ticksMask;
                }
            }
            
            // Convert .NET ticks to Unix milliseconds
            const dotNetEpochTicks = 621355968000000000n;
            
            if (ticks > dotNetEpochTicks) {
                const unixTicks = ticks - dotNetEpochTicks;
                const unixMs = Number(unixTicks / 10000n); // Convert to milliseconds
                
                // Validate the result
                if (unixMs > 0 && unixMs < Date.now() + (365 * 24 * 3600 * 1000)) {
                    return unixMs;
                }
            }
            
        } catch (e) {
            console.log(`Error in timestamp conversion: ${e.message}`);
        }
        
        // Fallback: return 0 to disable alignment
        console.log(`WARNING: Could not convert DateTime.ToBinary() format, returning 0 (alignment disabled)`);
        return 0;
    }

    async readFile() {
        console.log(`Reading binary file: ${this.filename}`);
        const startTime = process.hrtime.bigint();
        
        try {
            // Read entire file into buffer
            const buffer = await fs.promises.readFile(this.filename);
            console.log(`File loaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
            
            let offset = 0;
            
            // Read header
            const headerResult = this.readCSharpString(buffer, offset);
            const header = headerResult.value;
            offset = headerResult.newOffset;
            console.log(`Header: ${header}`);
            
            // Read metadata
            const bufferSize = buffer.readUInt32LE(offset); offset += 4;
            const startTimeBinary = buffer.readBigInt64LE(offset); offset += 8;
            const maxAdcValue = buffer.readInt16LE(offset); offset += 2;
            
            // Convert binary timestamp to Unix timestamp in milliseconds
            const binaryUnixMs = this.convertBinaryTimestampToUnixMs(startTimeBinary);
            
            // Read channel ranges (8x Int32)
            const channelRanges = [];
            for (let i = 0; i < 8; i++) {
                channelRanges.push(buffer.readInt32LE(offset));
                offset += 4;
            }
            
            // Read channel scaling (8x Int16)
            const channelScaling = [];
            for (let i = 0; i < 8; i++) {
                channelScaling.push(buffer.readInt16LE(offset));
                offset += 2;
            }
            
            // Read sampling interval
            const samplingInterval = buffer.readUInt32LE(offset); offset += 4;
            
            // Read downsampling factors (8x int)
            const downsampling = [];
            for (let i = 0; i < 8; i++) {
                downsampling.push(buffer.readInt32LE(offset));
                offset += 4;
            }
            
            // Read units (8x string)
            const units = [];
            for (let i = 0; i < 8; i++) {
                const result = this.readCSharpString(buffer, offset);
                units.push(result.value);
                offset = result.newOffset;
            }
            
            // Read labels (8x string)
            const labels = [];
            for (let i = 0; i < 8; i++) {
                const result = this.readCSharpString(buffer, offset);
                labels.push(result.value);
                offset = result.newOffset;
            }
            
            // Create readable date for logging
            const readDateTime = new Date(binaryUnixMs);
            
            // Store metadata
            this.metadata = {
                header,
                bufferSize,
                startTimeBinary,
                binaryUnixMs,           // *** NEW: Unix timestamp in milliseconds ***
                readDateTime,           // *** NEW: JavaScript Date object ***
                maxAdcValue,
                channelRanges,
                channelScaling,
                samplingInterval,
                downsampling,
                units,
                labels
            };
            
            console.log(`Buffer size: ${bufferSize.toLocaleString()}`);
            console.log(`Sampling interval: ${samplingInterval} ns`);
            
            // Read the actual data
            console.log('Reading data...');
            const dataStartTime = process.hrtime.bigint();
            await this.readChannelData(buffer, offset, bufferSize, downsampling);
            const dataEndTime = process.hrtime.bigint();
            
            const totalEndTime = process.hrtime.bigint();
            
            console.log(`Data reading completed in: ${Number(dataEndTime - dataStartTime) / 1e9} seconds`);
            console.log(`Total file processing time: ${Number(totalEndTime - startTime) / 1e9} seconds`);
            
        } catch (error) {
            console.error('Error reading file:', error);
            throw error;
        }
    }

    async readChannelData(buffer, startOffset, bufferSize, downsampling) {
        // Pre-calculate total data points and allocate arrays
        const channelDataArrays = [];
        const expectedPoints = [];
        
        for (let channel = 0; channel < 8; channel++) {
            const points = Math.floor(bufferSize / downsampling[channel]);
            expectedPoints.push(points);
            channelDataArrays.push(new Float32Array(points));
        }
        
        // Read all data with direct buffer access
        let dataOffset = startOffset;
        const channelIndices = new Array(8).fill(0);
        
        // Process data exactly like C# - but faster with direct buffer access
        for (let j = 0; j < bufferSize; j++) {
            for (let channel = 0; channel < 8; channel++) {
                if (j % downsampling[channel] === 0) {
                    // Direct buffer read
                    const rawAdc = buffer.readInt16LE(dataOffset);
                    dataOffset += 2;
                    
                    // Convert ADC to physical value
                    const physicalValue = convertAdcToPhysical(
                        rawAdc, 
                        this.metadata.maxAdcValue,
                        this.metadata.channelRanges[channel],
                        this.metadata.channelScaling[channel]
                    );
                    
                    // Direct array assignment
                    channelDataArrays[channel][channelIndices[channel]++] = physicalValue;
                }
            }
        }
        
        // Create time axes and store data
        for (let channel = 0; channel < 8; channel++) {
            const actualPoints = channelIndices[channel];
            const dataArray = channelDataArrays[channel].slice(0, actualPoints);
            
            // Create time axis
            const dtSeconds = (this.metadata.samplingInterval * downsampling[channel]) / 1e9;
            const timeArray = new Float32Array(actualPoints);
            for (let i = 0; i < actualPoints; i++) {
                timeArray[i] = i * dtSeconds;
            }
            
            this.rawData[`channel_${channel}`] = {
                time: timeArray,
                values: dataArray,
                label: this.metadata.labels[channel],
                unit: this.metadata.units[channel],
                downsampling: downsampling[channel],
                points: actualPoints
            };
        }
    }

    getMetadata() {
        return this.metadata;
    }

    getRawData() {
        return this.rawData;
    }

    getChannelData(channel) {
        return this.rawData[`channel_${channel}`];
    }
}

module.exports = BinaryReader;