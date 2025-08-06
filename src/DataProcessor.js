class DataProcessor {
    constructor(rawData, calculatedData, metadata) {
        this.rawData = rawData;
        this.calculatedData = calculatedData;
        this.metadata = metadata;
    }

    // Dynamic data resampling for zoom levels - supports both raw and calculated channels
    getResampledData(channelId, startTime, endTime, maxPoints = 2000) {
        let channelData = null;
        
        // Determine if it's a raw or calculated channel
        if (channelId.startsWith('calc_')) {
            channelData = this.calculatedData[channelId];
        } else if (channelId.startsWith('channel_')) {
            channelData = this.rawData[channelId];
        } else {
            // Support legacy numeric channel access (assume raw)
            channelData = this.rawData[`channel_${channelId}`];
        }
        
        if (!channelData) return { time: [], values: [] };
        
        // Find indices for time range
        const startIdx = this.findTimeIndex(channelData.time, startTime);
        const endIdx = this.findTimeIndex(channelData.time, endTime);
        
        const totalPoints = endIdx - startIdx;
        if (totalPoints <= maxPoints) {
            // Return raw data if within limits
            return {
                time: Array.from(channelData.time.slice(startIdx, endIdx)),
                values: Array.from(channelData.values.slice(startIdx, endIdx))
            };
        }
        
        // Resample using MinMax-LTTB algorithm (simplified)
        const step = Math.floor(totalPoints / maxPoints);
        const resampledTime = [];
        const resampledValues = [];
        
        for (let i = startIdx; i < endIdx; i += step) {
            // Take min, max, and average in each bucket for better representation
            let min = channelData.values[i];
            let max = channelData.values[i];
            let sum = 0;
            let count = 0;
            
            for (let j = 0; j < step && i + j < endIdx; j++) {
                const val = channelData.values[i + j];
                min = Math.min(min, val);
                max = Math.max(max, val);
                sum += val;
                count++;
            }
            
            // Include min, max, and average for spike preservation
            if (count > 0) {
                const avg = sum / count;
                const time = channelData.time[i];
                const timeStep = this.getChannelTimeStep(channelId);
                
                if (Math.abs(max - min) > Math.abs(avg) * 0.1) {
                    // Significant variation - include min and max
                    resampledTime.push(time, time + timeStep, time + timeStep * 0.5);
                    resampledValues.push(min, max, avg);
                } else {
                    // Small variation - just average
                    resampledTime.push(time);
                    resampledValues.push(avg);
                }
            }
        }
        
        return { time: resampledTime, values: resampledValues };
    }

    // Get the time step for a specific channel
    getChannelTimeStep(channelId) {
        let channelData = null;
        
        if (channelId.startsWith('calc_')) {
            channelData = this.calculatedData[channelId];
        } else if (channelId.startsWith('channel_')) {
            channelData = this.rawData[channelId];
        } else {
            channelData = this.rawData[`channel_${channelId}`];
        }
        
        if (!channelData || !channelData.downsampling) {
            return (this.metadata.samplingInterval / 1e9); // Default sampling interval
        }
        
        return (this.metadata.samplingInterval * channelData.downsampling) / 1e9;
    }
    
    findTimeIndex(timeArray, targetTime) {
        // Binary search for efficiency
        let left = 0;
        let right = timeArray.length - 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (timeArray[mid] < targetTime) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return Math.max(0, Math.min(timeArray.length - 1, left));
    }

    // Calculate data ranges for auto-scaling - includes both raw and calculated channels
    getDataRanges() {
        const ranges = {};
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const channelData = this.rawData[`channel_${i}`];
            if (!channelData) continue;
            
            const channelRange = this.calculateChannelRange(channelData);
            ranges[`channel_${i}`] = {
                ...channelRange,
                type: 'raw'
            };
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const channelData = this.calculatedData[`calc_${i}`];
            if (!channelData) continue;
            
            const channelRange = this.calculateChannelRange(channelData);
            ranges[`calc_${i}`] = {
                ...channelRange,
                type: 'calculated'
            };
        }
        
        return ranges;
    }

    // Helper method to calculate min/max range for a single channel
    calculateChannelRange(channelData) {
        const values = channelData.values;
        
        // Calculate min/max for this channel
        let min = values[0];
        let max = values[0];
        for (let j = 1; j < values.length; j++) {
            if (values[j] < min) min = values[j];
            if (values[j] > max) max = values[j];
        }
        
        // Add some padding (5%) for better visualization
        const padding = (max - min) * 0.05;
        
        return {
            min: min - padding,
            max: max + padding,
            unit: channelData.unit,
            label: channelData.label
        };
    }

    // Generate metadata summary for client - includes calculated channels
    getMetadataSummary() {
        const summary = {
            channels: [], // Raw channels
            calculatedChannels: [], // Calculated channels
            totalPoints: 0,
            duration: 0,
            samplingRate: 1e9 / this.metadata.samplingInterval
        };
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            summary.channels.push({
                index: i,
                id: `channel_${i}`,
                label: ch.label,
                unit: ch.unit,
                points: ch.points,
                duration: ch.time[ch.time.length - 1],
                type: 'raw'
            });
            summary.totalPoints += ch.points;
            summary.duration = Math.max(summary.duration, ch.time[ch.time.length - 1]);
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch) continue;
            
            summary.calculatedChannels.push({
                index: i,
                id: `calc_${i}`,
                label: ch.label,
                unit: ch.unit,
                points: ch.points,
                duration: ch.time[ch.time.length - 1],
                sourceChannels: ch.sourceChannels,
                type: 'calculated'
            });
            summary.totalPoints += ch.points;
            summary.duration = Math.max(summary.duration, ch.time[ch.time.length - 1]);
        }
        
        return summary;
    }

    // Get time range for all channels (raw and calculated)
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        // Check raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            minTime = Math.min(minTime, ch.time[0]);
            maxTime = Math.max(maxTime, ch.time[ch.time.length - 1]);
        }
        
        // Check calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch) continue;
            
            minTime = Math.min(minTime, ch.time[0]);
            maxTime = Math.max(maxTime, ch.time[ch.time.length - 1]);
        }
        
        return { min: minTime, max: maxTime };
    }

    // Get channel data by ID (supports both raw and calculated)
    getChannelById(channelId) {
        if (channelId.startsWith('calc_')) {
            return this.calculatedData[channelId];
        } else if (channelId.startsWith('channel_')) {
            return this.rawData[channelId];
        } else {
            // Support legacy numeric access
            return this.rawData[`channel_${channelId}`];
        }
    }

    // Get all available channels organized by type
    getAllAvailableChannels() {
        const available = {
            raw: [],
            calculated: []
        };
        
        // Add raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (ch) {
                available.raw.push({
                    id: `channel_${i}`,
                    index: i,
                    label: ch.label,
                    unit: ch.unit,
                    points: ch.points
                });
            }
        }
        
        // Add calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (ch) {
                available.calculated.push({
                    id: `calc_${i}`,
                    index: i,
                    label: ch.label,
                    unit: ch.unit,
                    points: ch.points,
                    sourceChannels: ch.sourceChannels
                });
            }
        }
        
        return available;
    }

    // Get channels grouped by unit type for Y-axis assignment
    getChannelsByUnit() {
        const byUnit = {};
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            if (!byUnit[ch.unit]) byUnit[ch.unit] = [];
            byUnit[ch.unit].push({
                id: `channel_${i}`,
                label: ch.label,
                type: 'raw'
            });
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch) continue;
            
            if (!byUnit[ch.unit]) byUnit[ch.unit] = [];
            byUnit[ch.unit].push({
                id: `calc_${i}`,
                label: ch.label,
                type: 'calculated'
            });
        }
        
        return byUnit;
    }

    // Get calculated channels that should be displayed by default
    getDefaultDisplayChannels() {
        const defaultChannels = [
            'calc_5', // U_DC*
            'calc_3', // I_DC_GR1*
            'calc_4', // I_DC_GR2*
            'calc_6'  // F_Schlitten*
        ];
        
        return defaultChannels.filter(channelId => this.calculatedData[channelId]);
    }

    // Get raw channels (for optional display)
    getRawChannelIds() {
        const rawChannels = [];
        for (let i = 0; i < 8; i++) {
            if (this.rawData[`channel_${i}`]) {
                rawChannels.push(`channel_${i}`);
            }
        }
        return rawChannels;
    }

    // Enhanced data statistics
    getChannelStatistics(channelId) {
        const channelData = this.getChannelById(channelId);
        if (!channelData) return null;
        
        const values = channelData.values;
        const n = values.length;
        
        // Basic statistics
        let min = values[0];
        let max = values[0];
        let sum = 0;
        let sumSquares = 0;
        
        for (let i = 0; i < n; i++) {
            const val = values[i];
            min = Math.min(min, val);
            max = Math.max(max, val);
            sum += val;
            sumSquares += val * val;
        }
        
        const mean = sum / n;
        const variance = (sumSquares / n) - (mean * mean);
        const stdDev = Math.sqrt(variance);
        
        return {
            min,
            max,
            mean,
            stdDev,
            rms: Math.sqrt(sumSquares / n),
            count: n,
            unit: channelData.unit,
            label: channelData.label
        };
    }
}

module.exports = DataProcessor;