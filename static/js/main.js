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

// Convert video frame to base64 using a module-level cached canvas
let cachedCaptureCanvas = null;
let cachedCaptureCtx = null;

function captureFrameToBase64(videoElement) {
    if (!videoElement || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
        return null;
    }
    if (!cachedCaptureCanvas) {
        cachedCaptureCanvas = document.createElement('canvas');
        cachedCaptureCanvas.width = 160;  // low resolution for speed
        cachedCaptureCanvas.height = 120;
        cachedCaptureCtx = cachedCaptureCanvas.getContext('2d');
    }
    
    cachedCaptureCtx.save();
    cachedCaptureCtx.clearRect(0, 0, cachedCaptureCanvas.width, cachedCaptureCanvas.height);
    // mirror the webcam feed just like the display
    cachedCaptureCtx.translate(cachedCaptureCanvas.width, 0);
    cachedCaptureCtx.scale(-1, 1);
    cachedCaptureCtx.drawImage(videoElement, 0, 0, cachedCaptureCanvas.width, cachedCaptureCanvas.height);
    cachedCaptureCtx.restore();
    
    return cachedCaptureCanvas.toDataURL('image/jpeg', 0.6); // medium quality compressibility
}

// Web Audio API Sound Synthesizer for Critical alerts
function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Professional double chime
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
        gain1.gain.setValueAtTime(0, ctx.currentTime);
        gain1.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.35);
        
        setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
            gain2.gain.setValueAtTime(0, ctx.currentTime);
            gain2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
            gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            
            osc2.start(ctx.currentTime);
            osc2.stop(ctx.currentTime + 0.4);
        }, 120);
        
    } catch (err) {
        console.warn("Audio Context sound failed:", err);
    }
}

// Toast Notification Spawner
function showLiveToast(alert) {
    // Create container if not exists
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    // Create toast
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${alert.severity.toLowerCase()}`;
    
    // Check severity and add icon
    let iconClass = 'fa-circle-info text-primary';
    if (alert.severity === 'Critical') iconClass = 'fa-circle-radiation text-danger';
    else if (alert.severity === 'High') iconClass = 'fa-triangle-exclamation text-warning';
    else if (alert.severity === 'Medium') iconClass = 'fa-circle-exclamation';
    
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">
                <i class="fa-solid ${iconClass}"></i>
                ${alert.severity === 'Critical' ? 'Critical Violation Detected' : 'Malpractice Alert'}
            </span>
            <span class="toast-time">${alert.timestamp}</span>
        </div>
        <div class="toast-body">
            <strong>Candidate:</strong> ${alert.candidate_name}<br>
            <strong>Violation:</strong> ${alert.violation_type}<br>
            <strong>Exam:</strong> ${alert.exam_name}
        </div>
        <div class="toast-footer">
            <button class="btn btn-secondary" style="font-size:0.75rem; padding:4px 8px; height:auto;" onclick="window.location.href='/admin/reports'">View Candidate</button>
            <button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px; height:auto; background-color:#ef4444; border-color:#ef4444;" onclick="this.closest('.toast-notification').remove()">Dismiss</button>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px) scale(0.95)';
        setTimeout(() => toast.remove(), 250);
    }, 8000);
}

// Update badges and trigger navbar effects
function updateNotificationBadgeCount(count) {
    const badges = document.querySelectorAll('.notification-badge-count');
    badges.forEach(badge => {
        if (count > 0) {
            badge.innerText = count;
            badge.style.display = 'inline-block';
            badge.classList.add('badge-pulse');
        } else {
            badge.style.display = 'none';
            badge.classList.remove('badge-pulse');
        }
    });
}

function triggerNavbarBellAlert() {
    const bell = document.getElementById('navbar-bell-icon');
    if (bell) {
        bell.classList.add('bell-shake');
        setTimeout(() => {
            bell.classList.remove('bell-shake');
        }, 650);
    }
}

// Initialize admin alerts listener via SSE
document.addEventListener('DOMContentLoaded', () => {
    const isPageAdmin = !!document.getElementById('navbar-bell-icon') || window.location.pathname.startsWith('/admin');
    
    if (isPageAdmin) {
        // Fetch current active counts
        fetch('/admin/notifications/data')
            .then(res => res.json())
            .then(data => {
                if (data.unread_count !== undefined) {
                    updateNotificationBadgeCount(data.unread_count);
                }
            })
            .catch(err => console.error("Error loading notification count:", err));
            
        // Start EventSource stream
        const stream = new EventSource('/admin/notifications/stream');
        
        stream.onmessage = (event) => {
            try {
                const alertData = JSON.parse(event.data);
                
                // 1. Play sound for High / Critical events
                if (alertData.severity === 'Critical' || alertData.severity === 'High') {
                    playAlertSound();
                }
                
                // 2. Shake Navbar Bell
                triggerNavbarBellAlert();
                
                // 3. Show Toast Popup
                showLiveToast(alertData);
                
                // 4. Update dynamic counts
                if (alertData.unread_count !== undefined) {
                    updateNotificationBadgeCount(alertData.unread_count);
                }
                const customEvt = new CustomEvent('malpractice-alert', { 
                    detail: { alert: alertData, unread_count: alertData.unread_count } 
                });
                window.dispatchEvent(customEvt);
            } catch (err) {
                console.error("Error parsing real-time message:", err);
            }
        };
        
        stream.onerror = (err) => {
            console.warn("Real-time stream connection temporarily lost. Reconnecting...");
        };
    }
});
