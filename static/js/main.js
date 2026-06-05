// ProctorAI Common Utilities
const API = {
    async post(url, data) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            return { error: true, message: error.message };
        }
    },
    
    async get(url) {
        try {
            const response = await fetch(url);
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            return { error: true, message: error.message };
        }
    }
};

function formatTimeRemaining(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Convert video frame to base64
function captureFrameToBase64(videoElement) {
    if (!videoElement || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 160;  // low resolution for speed
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    
    // mirror the webcam feed just like the display
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.6); // medium quality compressibility
}
