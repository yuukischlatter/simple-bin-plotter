class DataProcessor {
    constructor(rawData, metadata) {
        this.rawData = rawData;
        this.metadata = metadata;
    }

    // Dynamic data resampling for zoom levels
    getResampledData(channel, startTime, endTime, maxPoints = 2000) {
        const channelData = this.rawData[`channel_${channel}`];
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
                const timeStep = (this.metadata.samplingInterval / 1e9) * this.rawData[`channel_${channel}`].downsampling;
                
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

    // Calculate data ranges for auto-scaling
    getDataRanges() {
        const ranges = {};
        
        for (let i = 0; i < 8; i++) {
            const channelData = this.rawData[`channel_${i}`];
            if (!channelData) continue;
            
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
            
            ranges[`channel_${i}`] = {
                min: min - padding,
                max: max + padding,
                unit: channelData.unit,
                label: channelData.label
            };
        }
        
        return ranges;
    }

    // Generate metadata summary for client
    getMetadataSummary() {
        const summary = {
            channels: [],
            totalPoints: 0,
            duration: 0,
            samplingRate: 1e9 / this.metadata.samplingInterval
        };
        
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            summary.channels.push({
                index: i,
                label: ch.label,
                unit: ch.unit,
                points: ch.points,
                duration: ch.time[ch.time.length - 1]
            });
            summary.totalPoints += ch.points;
            summary.duration = Math.max(summary.duration, ch.time[ch.time.length - 1]);
        }
        
        return summary;
    }

    // Get time range for all channels
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            minTime = Math.min(minTime, ch.time[0]);
            maxTime = Math.max(maxTime, ch.time[ch.time.length - 1]);
        }
        
        return { min: minTime, max: maxTime };
    }
}

module.exports = DataProcessor;