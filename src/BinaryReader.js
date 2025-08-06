const fs = require('fs');
const { convertAdcToPhysical } = require('./utils');

class BinaryReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.rawData = {};
        this.calculatedData = {};
        
        // Constants for calculations (from C# code)
        this.TRAFO_STROM_MULTIPLIER = 35;
        this.FORCE_COEFF_1 = 6.2832;
        this.FORCE_COEFF_2 = 5.0108;
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
                binaryUnixMs,
                readDateTime,
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
            
            // Compute calculated channels
            console.log('Computing calculated channels...');
            const calcStartTime = process.hrtime.bigint();
            this.computeCalculatedChannels();
            const calcEndTime = process.hrtime.bigint();
            
            const totalEndTime = process.hrtime.bigint();
            
            console.log(`Data reading completed in: ${Number(dataEndTime - dataStartTime) / 1e9} seconds`);
            console.log(`Calculated channels computed in: ${Number(calcEndTime - calcStartTime) / 1e9} seconds`);
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

    computeCalculatedChannels() {
        // Define calculated channel metadata
        const calcChannelDefs = {
            0: { label: 'UL3L1*', unit: 'V', sourceChannels: [0, 1] },
            1: { label: 'IL2GR1*', unit: 'V', sourceChannels: [2, 3] },
            2: { label: 'IL2GR2*', unit: 'V', sourceChannels: [4, 5] },
            3: { label: 'I_DC_GR1*', unit: 'A', sourceChannels: [2, 3] },
            4: { label: 'I_DC_GR2*', unit: 'A', sourceChannels: [4, 5] },
            5: { label: 'U_DC*', unit: 'V', sourceChannels: [0, 1] },
            6: { label: 'F_Schlitten*', unit: 'kN', sourceChannels: [6, 7] }
        };

        // Compute each calculated channel
        for (const [calcIndex, def] of Object.entries(calcChannelDefs)) {
            try {
                const result = this.computeSingleCalculatedChannel(parseInt(calcIndex), def);
                if (result) {
                    this.calculatedData[`calc_${calcIndex}`] = result;
                }
            } catch (error) {
                console.error(`Error computing calculated channel ${calcIndex}:`, error);
            }
        }
        
        console.log(`Computed ${Object.keys(this.calculatedData).length} calculated channels`);
    }

    computeSingleCalculatedChannel(calcIndex, def) {
        const sourceChannels = def.sourceChannels;
        
        // Validate source channels exist
        for (const srcCh of sourceChannels) {
            if (!this.rawData[`channel_${srcCh}`]) {
                console.warn(`Source channel ${srcCh} not found for calculated channel ${calcIndex}`);
                return null;
            }
        }

        // Get the primary source channel (first one) for time reference
        const primaryChannel = sourceChannels[0];
        const primaryData = this.rawData[`channel_${primaryChannel}`];
        const numPoints = primaryData.points;
        
        // Create arrays for calculated channel
        const timeArray = new Float32Array(primaryData.time);
        const valuesArray = new Float32Array(numPoints);
        
        // Perform calculations based on channel index
        switch (calcIndex) {
            case 0: // UL3L1* = -channel[0] - channel[1]
                this.calculateDifferential(valuesArray, 0, 1, numPoints, -1, -1);
                break;
                
            case 1: // IL2GR1* = -channel[2] - channel[3]
                this.calculateDifferential(valuesArray, 2, 3, numPoints, -1, -1);
                break;
                
            case 2: // IL2GR2* = -channel[4] - channel[5]
                this.calculateDifferential(valuesArray, 4, 5, numPoints, -1, -1);
                break;
                
            case 3: // I_DC_GR1* = TRAFO_MULTIPLIER * (|ch[2]| + |ch[3]| + |IL2GR1*|)
                this.calculateDCCurrent(valuesArray, 2, 3, 1, numPoints);
                break;
                
            case 4: // I_DC_GR2* = TRAFO_MULTIPLIER * (|ch[4]| + |ch[5]| + |IL2GR2*|)
                this.calculateDCCurrent(valuesArray, 4, 5, 2, numPoints);
                break;
                
            case 5: // U_DC* = (|ch[0]| + |ch[1]| + |UL3L1*|) / TRAFO_MULTIPLIER
                this.calculateDCVoltage(valuesArray, 0, 1, 0, numPoints);
                break;
                
            case 6: // F_Schlitten* = ch[6] * 6.2832 - ch[7] * 5.0108
                this.calculateForce(valuesArray, 6, 7, numPoints);
                break;
                
            default:
                console.warn(`Unknown calculated channel index: ${calcIndex}`);
                return null;
        }
        
        return {
            time: timeArray,
            values: valuesArray,
            label: def.label,
            unit: def.unit,
            sourceChannels: sourceChannels,
            points: numPoints,
            downsampling: primaryData.downsampling
        };
    }

    calculateDifferential(output, ch1, ch2, numPoints, coeff1, coeff2) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        
        for (let i = 0; i < numPoints; i++) {
            output[i] = coeff1 * data1[i] + coeff2 * data2[i];
        }
    }

    calculateDCCurrent(output, ch1, ch2, diffChannelIndex, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        const diffData = this.calculatedData[`calc_${diffChannelIndex}`]?.values;
        
        if (!diffData) {
            console.warn(`Differential channel ${diffChannelIndex} not computed yet`);
            return;
        }
        
        for (let i = 0; i < numPoints; i++) {
            const sum = Math.abs(data1[i]) + Math.abs(data2[i]) + Math.abs(diffData[i]);
            output[i] = this.TRAFO_STROM_MULTIPLIER * sum;
        }
    }

    calculateDCVoltage(output, ch1, ch2, diffChannelIndex, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        const diffData = this.calculatedData[`calc_${diffChannelIndex}`]?.values;
        
        if (!diffData) {
            console.warn(`Differential channel ${diffChannelIndex} not computed yet`);
            return;
        }
        
        for (let i = 0; i < numPoints; i++) {
            const sum = Math.abs(data1[i]) + Math.abs(data2[i]) + Math.abs(diffData[i]);
            output[i] = sum / this.TRAFO_STROM_MULTIPLIER;
        }
    }

    calculateForce(output, ch1, ch2, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        
        for (let i = 0; i < numPoints; i++) {
            output[i] = data1[i] * this.FORCE_COEFF_1 - data2[i] * this.FORCE_COEFF_2;
        }
    }

    getMetadata() {
        return this.metadata;
    }

    getRawData() {
        return this.rawData;
    }

    getCalculatedData() {
        return this.calculatedData;
    }

    getChannelData(channel) {
        return this.rawData[`channel_${channel}`];
    }

    getCalculatedChannelData(channel) {
        return this.calculatedData[`calc_${channel}`];
    }

    // Get all available channels (raw + calculated)
    getAllChannels() {
        const allChannels = {
            raw: {},
            calculated: {}
        };

        // Add raw channels
        for (let i = 0; i < 8; i++) {
            if (this.rawData[`channel_${i}`]) {
                allChannels.raw[i] = this.rawData[`channel_${i}`];
            }
        }

        // Add calculated channels
        for (let i = 0; i < 7; i++) {
            if (this.calculatedData[`calc_${i}`]) {
                allChannels.calculated[i] = this.calculatedData[`calc_${i}`];
            }
        }

        return allChannels;
    }
}

module.exports = BinaryReader;