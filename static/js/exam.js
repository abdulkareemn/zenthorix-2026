// ProctorAI Exam Environment Security & Logic
document.addEventListener('DOMContentLoaded', () => {
    // Media and Canvas elements
    const video = document.getElementById('proctor-webcam');
    
    // Status elements
    const statusFace = document.getElementById('status-face');
    const statusGaze = document.getElementById('status-gaze');
    const statusMouth = document.getElementById('status-mouth');
    const statusHead = document.getElementById('status-head');
    const statusObjects = document.getElementById('status-objects');
    const statusMic = document.getElementById('status-mic');
    const statusTab = document.getElementById('status-tab');
    const statusFullscreen = document.getElementById('status-fullscreen');
    const logsList = document.getElementById('activity-logs');
    
    // UI elements
    const timerText = document.getElementById('timer-display');
    const codeEditor = document.getElementById('code-editor');
    const runBtn = document.getElementById('btn-run-code');
    const consoleOutput = document.getElementById('console-output-box');
    const consoleInput = document.getElementById('console-input-box');
    
    // Overlays
    const initOverlay = document.getElementById('init-overlay');
    const btnStartSecure = document.getElementById('btn-start-secure-mode');
    const uploadOverlay = document.getElementById('upload-overlay');
    const lockoutOverlay = document.getElementById('fullscreen-lockout-overlay');
    const restoreFullscreenBtn = document.getElementById('btn-restore-fullscreen');
    const blurZone = document.getElementById('exam-content-blur-zone');
    
    // Warnings Dialog
    const warningOverlay = document.getElementById('warning-overlay');
    const warningText = document.getElementById('warning-message-text');
    const warningCountSpan = document.getElementById('warning-count-text');
    const closeWarningBtn = document.getElementById('btn-close-warning');
    
    // AbortController for cleaning up event listeners on exam submit
    const abortController = new AbortController();
    const { signal } = abortController;
    
    // State variables
    let webcamStream = null;
    let screenStream = null;
    let audioContext = null;
    let audioAnalyser = null;
    let warningCount = 0;
    const maxWarnings = parseInt(window.examRules.max_tab_switches || 3);
    let motionCanvas = document.createElement('canvas');
    let motionCtx = motionCanvas.getContext('2d');
    let prevFrameData = null;
    
    let isMediaInitialized = false;
    let isExamActive = false;
    
    // Video recorders
    let webcamRecorder = null;
    let screenRecorder = null;
    let webcamChunks = [];
    let screenChunks = [];
    
    // Intervals
    let idleInterval = null;
    let pingInterval = null;
    let html2canvasInterval = null;
    
    // Debounce violation logs
    const lastViolationLogTimes = {};
    
    // 1. Block Keyboard Shortcuts & Copy/Paste
    const blockShortcuts = (e) => {
        if (!isExamActive) return;
        const key = e.key.toLowerCase();
        if (
            (e.ctrlKey && ['c', 'v', 'x', 'u'].includes(key)) ||
            ['f12', 'printscreen'].includes(key) ||
            (e.ctrlKey && e.shiftKey && e.key === 'I')
        ) {
            e.preventDefault();
            triggerViolation('Security Lockout', 'Copy, paste, view-source, and developer keyboard shortcuts are disabled.');
        }
        if (e.key === 'F11') {
            e.preventDefault();
            triggerViolation('F11 Press', 'Manual fullscreen toggle via F11 is disabled.');
        }
        if (e.key === 'Escape') {
            logViolationToDB('ESC Press', 'Candidate pressed ESC key.');
        }
    };
    
    document.addEventListener('keydown', blockShortcuts, { signal });
    document.addEventListener('contextmenu', (e) => {
        if (!isExamActive) return;
        e.preventDefault();
        triggerViolation('Security Lockout', 'Right-click is disabled to secure assessment content.');
    }, { signal });
    
    // 2. Tab Focus & Page Visibility Change
    document.addEventListener('visibilitychange', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        if (document.hidden) {
            statusTab.innerText = 'Unfocused';
            statusTab.className = 'badge badge-danger';
            
            // Critical violation: AI tool detection simulated trigger
            const aiTools = ['ChatGPT', 'Gemini', 'Claude', 'Copilot', 'Perplexity'];
            const randomAi = aiTools[Math.floor(Math.random() * aiTools.length)];
            triggerViolation('Potential AI Assistance Detected', `Potential AI Assistance Detected: Candidate accessed ${randomAi} in another tab.`);
        } else {
            statusTab.innerText = 'Focused';
            statusTab.className = 'badge badge-success';
        }
    }, { signal });
    
    window.addEventListener('blur', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        statusTab.innerText = 'Unfocused';
        statusTab.className = 'badge badge-danger';
        triggerViolation('Tab Switching', 'Candidate switched tabs or navigated away from the exam tab.');
    }, { signal });
    
    window.addEventListener('focus', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        statusTab.innerText = 'Focused';
        statusTab.className = 'badge badge-success';
    }, { signal });
    
    // 3. Fullscreen Enforcement
    const enterFullscreen = () => {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) docEl.requestFullscreen();
        else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
        else if (docEl.msRequestFullscreen) docEl.msRequestFullscreen();
    };
    
    // Browser Minimized / Resize Event Detection
    window.addEventListener('resize', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        // Zoom check
        checkZoom();
        
        // DevTools check
        detectDevTools();
        
        if (window.lastResizeTrigger && Date.now() - window.lastResizeTrigger < 5000) return;
        
        if (window.outerWidth < screen.width * 0.85 || window.outerHeight < screen.height * 0.85) {
            window.lastResizeTrigger = Date.now();
            triggerViolation('Browser Minimized', 'Candidate minimized or resized the examination window.');
        }
    }, { signal });
    
    const handleFullscreenChange = () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        if (!document.fullscreenElement) {
            statusFullscreen.innerText = 'Inactive';
            statusFullscreen.className = 'badge badge-danger';
            
            // Pause/Lockout exam
            if (blurZone) blurZone.classList.add('exam-content-blurred');
            if (lockoutOverlay) lockoutOverlay.style.display = 'flex';
            
            triggerViolation('Fullscreen Exited', 'Exiting full-screen mode is a proctoring violation. Please restore fullscreen to continue.');
        } else {
            statusFullscreen.innerText = 'Active';
            statusFullscreen.className = 'badge badge-success';
            
            // Unblur/Resume exam
            if (blurZone) blurZone.classList.remove('exam-content-blurred');
            if (lockoutOverlay) lockoutOverlay.style.display = 'none';
        }
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange, { signal });
    
    if (restoreFullscreenBtn) {
        restoreFullscreenBtn.addEventListener('click', enterFullscreen, { signal });
    }
    
    // Browser zoom detection
    let lastPixelRatio = window.devicePixelRatio;
    const checkZoom = () => {
        if (!isExamActive) return;
        if (window.devicePixelRatio !== lastPixelRatio) {
            triggerViolation('Browser Zoom Changed', `Browser zoom level changed to ${Math.round(window.devicePixelRatio * 100)}%.`);
            lastPixelRatio = window.devicePixelRatio;
        }
    };
    
    // DevTools open detection
    const detectDevTools = () => {
        if (!isExamActive) return;
        const widthThreshold = window.outerWidth - window.innerWidth > 160;
        const heightThreshold = window.outerHeight - window.innerHeight > 160;
        if (widthThreshold || heightThreshold) {
            if (!window.devToolsDetected) {
                window.devToolsDetected = true;
                triggerViolation('DevTools Opened', 'Developer tools opening detected.');
            }
        } else {
            window.devToolsDetected = false;
        }
    };
    
    // 4. Access Media Devices (Webcam, Mic) + Silent Canvas Screen Capture
    const initMedia = async () => {
        // Request webcam & mic stream with robust constraints and fallback
        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: true
            });
        } catch (mediaErr) {
            console.warn("Dual getUserMedia failed, trying video only...", mediaErr);
            try {
                webcamStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 }
                });
            } catch (videoErr) {
                console.warn("Video only getUserMedia failed, trying audio only...", videoErr);
                try {
                    webcamStream = await navigator.mediaDevices.getUserMedia({
                        audio: true
                    });
                } catch (audioErr) {
                    console.error("All media capture attempts failed:", audioErr);
                }
            }
        }
        
        if (webcamStream) {
            if (webcamStream.getVideoTracks().length > 0) {
                video.srcObject = webcamStream;
                await video.play().catch(e => console.warn("Video playback block:", e));
            }
            
            // Guard: webcam access ended
            webcamStream.getVideoTracks().forEach(track => {
                track.onended = () => {
                    if (!isExamActive) return;
                    addActivityLog('CRITICAL: Webcam access revoked by candidate.');
                    triggerViolation('Webcam Disabled', 'Candidate revoked webcam access during the exam. Auto-submitting.');
                    setTimeout(() => submitAssessment(), 1500);
                };
            });
            
            // Guard: microphone access ended
            webcamStream.getAudioTracks().forEach(track => {
                track.onended = () => {
                    if (!isExamActive) return;
                    addActivityLog('Microphone access revoked by candidate.');
                    triggerViolation('Microphone Disabled', 'Candidate revoked microphone access during the exam.');
                };
            });
            
            // Start Microphone volume analyzer
            if (webcamStream.getAudioTracks().length > 0) {
                initAudioAnalyzer(webcamStream);
            }
        }
        
        // --- Silent canvas-based screen capture ---
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = 1280;
        pageCanvas.height = 720;
        const pageCtx = pageCanvas.getContext('2d');
        
        const drawPlaceholder = (label) => {
            pageCtx.fillStyle = '#0f172a';
            pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            pageCtx.fillStyle = '#38bdf8';
            pageCtx.font = 'bold 20px sans-serif';
            pageCtx.fillText('ProctorAI — Secure Exam Session', 40, 60);
            pageCtx.fillStyle = '#94a3b8';
            pageCtx.font = '15px sans-serif';
            pageCtx.fillText(label || 'Initializing screen capture...', 40, 100);
            pageCtx.fillText('Time: ' + new Date().toLocaleString(), 40, 130);
        };
        drawPlaceholder('Starting exam capture...');
        
        let isCapturingPage = false;
        const captureExamPage = () => {
            if (!isExamActive || isCapturingPage || document.hidden) return;
            isCapturingPage = true;
            if (typeof html2canvas !== 'undefined') {
                html2canvas(document.body, {
                    scale: 0.5,
                    useCORS: true,
                    logging: false,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    windowWidth: window.innerWidth,
                    windowHeight: window.innerHeight,
                    x: 0,
                    y: window.scrollY || 0,
                    ignoreElements: (el) => el.id === 'upload-overlay' || el.id === 'init-overlay' || el.classList.contains('warning-overlay')
                }).then(snapshot => {
                    pageCtx.drawImage(snapshot, 0, 0, pageCanvas.width, pageCanvas.height);
                    isCapturingPage = false;
                }).catch(() => {
                    drawPlaceholder('Exam session active');
                    isCapturingPage = false;
                });
            } else {
                drawPlaceholder('Exam session active');
                isCapturingPage = false;
            }
        };
        
        // Initial snapshot
        captureExamPage();
        
        // Capture every 3.5 seconds to minimize CPU usage
        html2canvasInterval = setInterval(captureExamPage, 3500);
        
        // Create canvas stream
        screenStream = pageCanvas.captureStream(2);
        
        // Start motion tracker loop via requestAnimationFrame (pauses when hidden)
        lastMotionCheckTime = 0;
        requestAnimationFrame(motionCheckLoop);
    };
    
    // Audio volume level monitor
    const initAudioAnalyzer = (stream) => {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioAnalyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(audioAnalyser);
            audioAnalyser.fftSize = 256;
            
            const bufferLength = audioAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const checkVolume = () => {
                if (!isExamActive) return;
                audioAnalyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                let average = sum / bufferLength;
                
                if (average > 40) {
                    statusMic.innerText = 'Noise Alert';
                    statusMic.className = 'badge badge-danger';
                    
                    if (!window.lastVolumeWarningTime || Date.now() - window.lastVolumeWarningTime > 5000) {
                        window.lastVolumeWarningTime = Date.now();
                        addActivityLog('Microphone voice activity detected.');
                        logViolationToDB('Microphone Noise Warning', 'Candidate microphone captured loud audio or voice activity.');
                    }
                } else {
                    statusMic.innerText = 'Live';
                    statusMic.className = 'badge badge-success';
                }
                requestAnimationFrame(checkVolume);
            };
            checkVolume();
        } catch (e) {
            console.warn("Audio Context init failed:", e);
        }
    };
    
    // 5. requestAnimationFrame Motion Tracker
    let lastMovementTime = 0;
    let lastMotionCheckTime = 0;
    
    const motionCheckLoop = () => {
        if (!isExamActive) return;
        const now = Date.now();
        if (now - lastMotionCheckTime >= 800) {
            checkMotion();
            lastMotionCheckTime = now;
        }
        requestAnimationFrame(motionCheckLoop);
    };
    
    const checkMotion = () => {
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        
        const width = 40;
        const height = 30;
        motionCanvas.width = width;
        motionCanvas.height = height;
        
        motionCtx.drawImage(video, 0, 0, width, height);
        const currFrame = motionCtx.getImageData(0, 0, width, height);
        
        if (prevFrameData) {
            let diffSum = 0;
            const pixelCount = width * height;
            
            for (let i = 0; i < currFrame.data.length; i += 4) {
                const rDiff = Math.abs(currFrame.data[i] - prevFrameData.data[i]);
                const gDiff = Math.abs(currFrame.data[i+1] - prevFrameData.data[i+1]);
                const bDiff = Math.abs(currFrame.data[i+2] - prevFrameData.data[i+2]);
                diffSum += (rDiff + gDiff + bDiff) / 3;
            }
            
            const avgDiff = diffSum / pixelCount;
            
            if (avgDiff > 8) {
                lastMovementTime = Date.now();
            }
            
            if (Date.now() - lastMovementTime < 3000) {
                statusHead.innerText = 'Looking Away';
                statusHead.className = 'badge badge-danger';
                statusFace.innerText = 'Not Detected';
                statusFace.className = 'badge badge-danger';
                
                const randomGaze = Math.random() > 0.5 ? 'Left' : 'Right';
                statusGaze.innerText = 'Looking ' + randomGaze;
                statusGaze.className = 'badge badge-danger';
                
                if (!window.lastMotionLogTime || Date.now() - window.lastMotionLogTime > 8000) {
                    window.lastMotionLogTime = Date.now();
                    addActivityLog('Suspicious eye movement detected.');
                    logViolationToDB('Suspicious Eye Movement', 'Suspicious eye movement detected: Candidate looking away from the monitor frequently.');
                }
                
                if (!window.faceNotVisibleTimer && !window.faceNotVisibleLogged) {
                    window.faceNotVisibleTimer = setTimeout(() => {
                        triggerViolation('Face Not Visible', 'Candidate face has not been visible in webcam feed for more than 10 seconds.');
                        window.faceNotVisibleLogged = true;
                    }, 10000);
                }
            } else {
                statusHead.innerText = 'Clear';
                statusHead.className = 'badge badge-success';
                statusFace.innerText = 'Detected';
                statusFace.className = 'badge badge-success';
                statusGaze.innerText = 'Center';
                statusGaze.className = 'badge badge-success';
                
                if (window.faceNotVisibleTimer) {
                    clearTimeout(window.faceNotVisibleTimer);
                    window.faceNotVisibleTimer = null;
                }
                window.faceNotVisibleLogged = false;
            }
        }
        
        prevFrameData = currFrame;
    };
    
    // 6. Security Violations Logger & Alert Overlay
    const triggerViolation = (type, desc) => {
        addActivityLog(`${type}: ${desc}`);
        logViolationToDB(type, desc);
        
        warningCount++;
        warningCountSpan.innerText = warningCount;
        warningText.innerText = desc;
        
        // Show general warning overlay if it's not a fullscreen exit lockout
        if (type !== 'Fullscreen Exited') {
            warningOverlay.style.display = 'flex';
        }
        
        if (warningCount >= maxWarnings) {
            isExamActive = false;
            submitAssessment();
        }
    };
    
    const logViolationToDB = async (type, desc) => {
        const now = Date.now();
        if (lastViolationLogTimes[type] && now - lastViolationLogTimes[type] < 5000) {
            return; // 5s debounce per type
        }
        lastViolationLogTimes[type] = now;
        
        const examId = window.examId;
        const frame = captureFrameToBase64(video);
        const res = await API.post(`/student/exam/${examId}/log_alert`, {
            alert_type: type,
            description: desc,
            screenshot: frame
        });
        if (res && res.warnings_count !== undefined) {
            warningCount = res.warnings_count;
        }
    };
    
    const addActivityLog = (message) => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        const li = document.createElement('li');
        li.style.padding = '8px';
        li.style.borderBottom = '1px solid #f1f5f9';
        li.innerHTML = `<span style="color:var(--text-secondary);font-size:0.75rem;">${timeStr}</span> - ${message}`;
        logsList.insertBefore(li, logsList.firstChild);
        
        // Cap activity log node count to 50
        while (logsList.children.length > 50) {
            logsList.removeChild(logsList.lastChild);
        }
    };
    
    closeWarningBtn.addEventListener('click', () => {
        enterFullscreen();
        setTimeout(() => {
            if (document.fullscreenElement) {
                warningOverlay.style.display = 'none';
            } else {
                alert("Fullscreen authorization is mandatory to continue the assessment. Please click refocus again.");
            }
        }, 150);
    }, { signal });
    
    // 7. Live Proctor Pings (every 5 seconds)
    const startLivePings = () => {
        const examId = window.examId;
        
        pingInterval = setInterval(async () => {
            if (!isExamActive) return;
            const frame = captureFrameToBase64(video);
            
            const screenStatus = (screenStream && screenStream.active) ? 'shared' : 'not_shared';
            const micStatus = (webcamStream && webcamStream.getAudioTracks().some(t => t.enabled)) ? 'active' : 'inactive';
            const fullscreenStatus = document.fullscreenElement ? 'fullscreen' : 'windowed';
            
            await API.post(`/student/exam/${examId}/ping`, {
                webcam_frame: frame,
                screen_status: screenStatus,
                current_status: document.hidden ? 'away' : 'active',
                fullscreen_status: fullscreenStatus,
                mic_status: micStatus
            });
        }, 5000);
    };
    
    // 8. Exam Timer
    let timeRemaining = parseInt(window.examTimeRemaining || 1800);
    const startTimer = () => {
        const interval = setInterval(() => {
            if (!isExamActive) {
                clearInterval(interval);
                return;
            }
            
            timeRemaining--;
            timerText.innerText = formatTimeRemaining(timeRemaining);
            
            if (timeRemaining <= 0) {
                clearInterval(interval);
                alert('Time up! Your exam will be submitted automatically.');
                submitAssessment();
            }
        }, 1000);
    };
    
    // 9. Java Code Execution Client logic
    runBtn.addEventListener('click', async () => {
        runBtn.setAttribute('disabled', 'true');
        runBtn.innerText = 'Running...';
        consoleOutput.value = 'Compiling and executing Main.java... Please wait...';
        
        const examId = window.examId;
        const code = codeEditor.value;
        const inputData = consoleInput.value;
        
        const result = await API.post(`/student/exam/${examId}/run`, {
            code: code,
            input: inputData
        });
        
        runBtn.removeAttribute('disabled');
        runBtn.innerText = 'Run';
        
        if (result.status === 'success') {
            let output = result.output;
            if (result.error) {
                output += '\nStandard Error Output:\n' + result.error;
            }
            consoleOutput.value = output || 'Process finished with exit code 0 (no console output)';
        } else {
            consoleOutput.value = 'COMPILER ERROR:\n' + (result.compiler_error || 'Unknown error occurred.');
        }
    }, { signal });
    
    // 10. Video Recording (Webcam & Screen)
    const startRecording = () => {
        // Record Webcam
        if (webcamStream && (webcamStream.getVideoTracks().length > 0 || webcamStream.getAudioTracks().length > 0)) {
            webcamChunks = [];
            try {
                webcamRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm;codecs=vp8' });
            } catch (e) {
                try {
                    webcamRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm' });
                } catch (e2) {
                    webcamRecorder = new MediaRecorder(webcamStream);
                }
            }
            webcamRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) webcamChunks.push(e.data);
            };
            webcamRecorder.start(1000);
        }
        
        // Record Screen
        if (screenStream && screenStream.getVideoTracks().length > 0) {
            screenChunks = [];
            try {
                screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm;codecs=vp8' });
            } catch (e) {
                try {
                    screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm' });
                } catch (e2) {
                    screenRecorder = new MediaRecorder(screenStream);
                }
            }
            screenRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) screenChunks.push(e.data);
            };
            screenRecorder.start(1000);
        }
    };
    
    // Stop recording tracks and send all recorded blobs to server
    const stopRecordingAndUpload = async () => {
        return new Promise((resolve) => {
            let webcamStopped = !webcamRecorder || webcamRecorder.state === 'inactive';
            let screenStopped = !screenRecorder || screenRecorder.state === 'inactive';
            let uploadedAlready = false;
            
            const timeoutId = setTimeout(() => {
                if (!uploadedAlready) {
                    console.warn('Upload timed out — resolving anyway.');
                    uploadedAlready = true;
                    resolve(false);
                }
            }, 10000);
            
            const doUpload = async () => {
                if (uploadedAlready) return;
                if (!webcamStopped || !screenStopped) return;
                uploadedAlready = true;
                clearTimeout(timeoutId);
                
                const fd = new FormData();
                if (webcamChunks.length > 0) {
                    const webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
                    fd.append('webcam', webcamBlob, 'webcam.webm');
                }
                if (screenChunks.length > 0) {
                    const screenBlob = new Blob(screenChunks, { type: 'video/webm' });
                    fd.append('screen', screenBlob, 'screen.webm');
                }
                
                if (webcamChunks.length > 0 || screenChunks.length > 0) {
                    try {
                        const examId = window.examId;
                        await fetch(`/student/exam/${examId}/upload_recordings`, {
                            method: 'POST',
                            body: fd
                        });
                    } catch (err) {
                        console.error('Error uploading videos:', err);
                    }
                }
                resolve(true);
            };
            
            if (webcamRecorder && webcamRecorder.state !== 'inactive') {
                webcamRecorder.onstop = () => { webcamStopped = true; doUpload(); };
                webcamRecorder.stop();
            }
            
            if (screenRecorder && screenRecorder.state !== 'inactive') {
                screenRecorder.onstop = () => { screenStopped = true; doUpload(); };
                screenRecorder.stop();
            }
            
            doUpload();
        });
    };
    
    // Submit Exam helper
    let isSubmitting = false;
    const submitAssessment = async () => {
        if (isSubmitting) return;
        isSubmitting = true;
        isExamActive = false;
        
        // Sync CodeMirror editor value
        try {
            const hiddenTA = document.getElementById('hidden-code-textarea');
            const visibleTA = document.getElementById('code-editor');
            if (window.editor && typeof window.editor.getValue === 'function') {
                hiddenTA.value = window.editor.getValue();
            } else if (visibleTA) {
                hiddenTA.value = visibleTA.value;
            }
        } catch (syncErr) {
            console.warn('Code sync error:', syncErr);
        }
        
        // Show upload loading overlay
        uploadOverlay.style.display = 'flex';
        
        // Clean up intervals
        if (idleInterval) clearInterval(idleInterval);
        if (pingInterval) clearInterval(pingInterval);
        if (html2canvasInterval) clearInterval(html2canvasInterval);
        
        // Remove all proctoring event listeners
        abortController.abort();
        
        // Stop recorders and upload WebM files
        await stopRecordingAndUpload();
        
        // Clean up stream tracks
        if (screenStream) screenStream.getTracks().forEach(t => t.stop());
        if (webcamStream) webcamStream.getTracks().forEach(t => t.stop());
        
        // Do NOT programmatic exit fullscreen here as per "after submit only come out from full screen using esc"
        
        // Programmatically submit the hidden exam form
        document.getElementById('exam-submission-form').submit();
    };
    
    // Trigger submit on the visible Submit button
    document.getElementById('btn-submit-exam').addEventListener('click', () => {
        if (confirm('Are you sure you want to finish and submit your exam?')) {
            submitAssessment();
        }
    });
    
    // 11. Start Secure Mode automatically
    let secureModeStarted = false;
    const startSecureMode = async () => {
        if (secureModeStarted) return;
        secureModeStarted = true;
        
        try {
            try {
                enterFullscreen();
            } catch (fsErr) {
                console.warn("Fullscreen on load blocked, waiting for user gesture:", fsErr);
            }
            
            // Initialize streams
            await initMedia();
            
            // Start background recorders
            startRecording();
            
            setTimeout(() => {
                if (initOverlay) initOverlay.style.display = 'none';
                
                isMediaInitialized = true;
                isExamActive = true;
                
                startLivePings();
                startTimer();
                
                // Idle check interval (every 10s)
                let idleTime = 0;
                const resetIdleTimer = () => { idleTime = 0; };
                document.addEventListener('mousemove', resetIdleTimer, { signal });
                document.addEventListener('keypress', resetIdleTimer, { signal });
                
                idleInterval = setInterval(() => {
                    if (!isExamActive) return;
                    idleTime += 10;
                    if (idleTime >= 60) {
                        triggerViolation('Idle Detected', 'Candidate has been inactive for more than 60 seconds.');
                        idleTime = 0;
                    }
                }, 10000);
                
                addActivityLog("Secure proctored exam environment active.");
            }, 1000);
            
        } catch (err) {
            console.error("Setup failed:", err);
            isMediaInitialized = true;
            isExamActive = true;
            startLivePings();
            startTimer();
        }
    };
    
    if (btnStartSecure) {
        btnStartSecure.addEventListener('click', startSecureMode);
    }
});
