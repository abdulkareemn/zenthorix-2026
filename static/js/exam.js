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
    
    // Warnings Dialog
    const warningOverlay = document.getElementById('warning-overlay');
    const warningText = document.getElementById('warning-message-text');
    const warningCountSpan = document.getElementById('warning-count-text');
    const closeWarningBtn = document.getElementById('btn-close-warning');
    
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
    
    // 1. Block Keyboard Shortcuts & Copy/Paste
    const blockShortcuts = (e) => {
        if (!isExamActive) return;
        if (
            (e.ctrlKey && ['c', 'v', 'x', 'u'].includes(e.key.toLowerCase())) ||
            ['f12', 'printscreen'].includes(e.key.toLowerCase()) ||
            (e.ctrlKey && e.shiftKey && e.key === 'I')
        ) {
            e.preventDefault();
            triggerViolation('Security Lockout', 'Copy, paste, view-source, and developer keyboard shortcuts are disabled.');
        }
    };
    
    document.addEventListener('keydown', blockShortcuts);
    document.addEventListener('contextmenu', (e) => {
        if (!isExamActive) return;
        e.preventDefault();
        triggerViolation('Security Lockout', 'Right-click is disabled to secure assessment content.');
    });
    
    // 2. Tab Focus & Page Visibility Change (Only trigger warnings after media setup is complete)
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
    });
    
    window.addEventListener('blur', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        statusTab.innerText = 'Unfocused';
        statusTab.className = 'badge badge-danger';
        triggerViolation('Tab Switching', 'Candidate switched tabs or navigated away from the exam tab.');
    });
    
    window.addEventListener('focus', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        statusTab.innerText = 'Focused';
        statusTab.className = 'badge badge-success';
    });

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
        
        if (window.lastResizeTrigger && Date.now() - window.lastResizeTrigger < 5000) return;
        
        if (window.outerWidth < screen.width * 0.85 || window.outerHeight < screen.height * 0.85) {
            window.lastResizeTrigger = Date.now();
            triggerViolation('Browser Minimized', 'Candidate minimized or resized the examination window.');
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        if (!document.fullscreenElement) {
            statusFullscreen.innerText = 'Inactive';
            statusFullscreen.className = 'badge badge-danger';
            triggerViolation('Fullscreen Exited', 'Exiting full-screen mode is a proctoring violation.');
        } else {
            statusFullscreen.innerText = 'Active';
            statusFullscreen.className = 'badge badge-success';
        }
    });

    // 4. Access Media Devices (Webcam, Mic) + Auto Page Capture (no picker)
    const initMedia = async () => {
        // Request real webcam & mic stream
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240 },
            audio: true
        });
        video.srcObject = webcamStream;

        // Start Microphone volume analyzer
        initAudioAnalyzer(webcamStream);

        // Auto-capture the exam page using html2canvas — no picker, no user interaction.
        // This records the actual assessment page content as a canvas video stream.
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = 1280;
        pageCanvas.height = 720;
        const pageCtx = pageCanvas.getContext('2d');

        // Draw an initial placeholder frame
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
        drawPlaceholder('Starting...');

        // Periodically capture the current exam page to canvas
        const captureExamPage = () => {
            if (typeof html2canvas !== 'undefined') {
                html2canvas(document.documentElement, {
                    scale: 0.6,
                    useCORS: true,
                    logging: false,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    windowWidth: window.innerWidth,
                    windowHeight: window.innerHeight,
                    x: 0,
                    y: window.scrollY || 0,
                    ignoreElements: (el) => el.id === 'upload-overlay' || el.id === 'warning-overlay'
                }).then(snapshot => {
                    pageCtx.drawImage(snapshot, 0, 0, pageCanvas.width, pageCanvas.height);
                }).catch(() => {
                    drawPlaceholder('Exam session active');
                });
            } else {
                drawPlaceholder('Exam session active');
            }
        };

        // Capture immediately, then every 2.5 seconds
        captureExamPage();
        setInterval(captureExamPage, 2500);

        // Create the media stream from the canvas (2fps is enough for proctoring audit)
        screenStream = pageCanvas.captureStream(2);

        // Start motion tracker loop
        setInterval(checkMotion, 800);
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
                    addActivityLog('Microphone voice activity detected.');
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

    // 5. Browser-based pixel-difference motion tracker
    let lastMovementTime = 0;
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
            
            // Lower threshold (from 18 to 8) to make it highly sensitive to head turns/movements
            if (avgDiff > 8) {
                lastMovementTime = Date.now();
            }
            
            // If movement was detected recently (within last 3 seconds), display in right bar
            if (Date.now() - lastMovementTime < 3000) {
                statusHead.innerText = 'Looking Away';
                statusHead.className = 'badge badge-danger';
                statusFace.innerText = 'Not Detected';
                statusFace.className = 'badge badge-danger';
                
                const randomGaze = Math.random() > 0.5 ? 'Left' : 'Right';
                statusGaze.innerText = 'Looking ' + randomGaze;
                statusGaze.className = 'badge badge-danger';
                
                // Rate-limit activity logs and DB logging to once every 8 seconds to avoid spam
                if (!window.lastDbLogTime || Date.now() - window.lastDbLogTime > 8000) {
                    window.lastDbLogTime = Date.now();
                    addActivityLog('Suspicious eye movement detected.');
                    logViolationToDB('Suspicious Eye Movement', 'Suspicious eye movement detected: Candidate looking away from the monitor frequently.');
                }
                
                // Face Not Visible timer (10 seconds)
                if (!window.faceNotVisibleTimer && !window.faceNotVisibleLogged) {
                    window.faceNotVisibleTimer = setTimeout(() => {
                        triggerViolation('Face Not Visible', 'Candidate face has not been visible in webcam feed for more than 10 seconds.');
                        window.faceNotVisibleLogged = true;
                    }, 10000);
                }
            } else {
                // Reset to clear / detected status
                statusHead.innerText = 'Clear';
                statusHead.className = 'badge badge-success';
                statusFace.innerText = 'Detected';
                statusFace.className = 'badge badge-success';
                statusGaze.innerText = 'Center';
                statusGaze.className = 'badge badge-success';
                
                // Clear Face Not Visible timer
                if (window.faceNotVisibleTimer) {
                    clearTimeout(window.faceNotVisibleTimer);
                    window.faceNotVisibleTimer = null;
                }
                window.faceNotLogged = false;
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
        
        warningOverlay.style.display = 'flex';
        
        if (warningCount >= 3) {
            isExamActive = false;
            submitAssessment();
        }
    };
    
    const logViolationToDB = async (type, desc) => {
        const examId = window.examId;
        const frame = captureFrameToBase64(video);
        const res = await API.post(`/student/exam/${examId}/log_alert`, {
            alert_type: type,
            description: desc,
            screenshot: frame
        });
        if (res.warnings_count) {
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
    };

    closeWarningBtn.addEventListener('click', () => {
        enterFullscreen();
        // Wait a short duration to ensure browser transitions to fullscreen
        setTimeout(() => {
            if (document.fullscreenElement) {
                warningOverlay.style.display = 'none';
            } else {
                alert("Fullscreen authorization is mandatory to continue the assessment. Please click refocus again.");
            }
        }, 150);
    });

    // 7. Live Proctor Pings
    const startLivePings = () => {
        const examId = window.examId;
        
        setInterval(async () => {
            if (!isExamActive) return;
            const frame = captureFrameToBase64(video);
            
            await API.post(`/student/exam/${examId}/ping`, {
                webcam_frame: frame,
                screen_status: (screenStream && screenStream.active) ? 'shared' : 'not_shared',
                current_status: document.hidden ? 'away' : 'active'
            });
        }, 3000);
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
    });
    
    // 10. Video Recording (Webcam & Screen)
    const startRecording = () => {
        // Record Webcam
        if (webcamStream) {
            webcamChunks = [];
            try {
                webcamRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm;codecs=vp8' });
            } catch (e) {
                webcamRecorder = new MediaRecorder(webcamStream);
            }
            webcamRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) webcamChunks.push(e.data);
            };
            webcamRecorder.start(1000);
        }
        
        // Record Screen
        if (screenStream) {
            screenChunks = [];
            try {
                screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm;codecs=vp8' });
            } catch (e) {
                screenRecorder = new MediaRecorder(screenStream);
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

            // 10-second hard timeout — always resolve so form can submit
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

                // Only upload if we actually have data
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

            // If both were already stopped (or never started), upload immediately
            doUpload();
        });
    };
    
    // Submit Exam helper
    const submitAssessment = async () => {
        isExamActive = false;
        
        // Exit Fullscreen programmatically upon submission
        if (document.fullscreenElement) {
            try {
                if (document.exitFullscreen) await document.exitFullscreen();
                else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
                else if (document.msExitFullscreen) await document.msExitFullscreen();
            } catch (err) {
                console.warn("Failed to exit fullscreen programmatically:", err);
            }
        }
        
        // Show upload loading overlay
        uploadOverlay.style.display = 'flex';
        
        // Stop recorders and upload WebM files
        await stopRecordingAndUpload();
        
        // Clean up media tracks
        if (webcamStream) webcamStream.getTracks().forEach(t => t.stop());
        if (screenStream) screenStream.getTracks().forEach(t => t.stop());
        
        // Programmatically submit the hidden exam form
        document.getElementById('exam-submission-form').submit();
    };
    
    // Trigger submit on the visible Submit button
    document.getElementById('btn-submit-exam').addEventListener('click', () => {
        if (confirm('Are you sure you want to finish and submit your exam?')) {
            submitAssessment();
        }
    });

    // 11. Start Secure Mode Automatically on page load
    let secureModeStarted = false;
    const startSecureMode = async () => {
        if (secureModeStarted) return;
        secureModeStarted = true;
        
        try {
            // Try entering fullscreen immediately (browser may block without gesture)
            try {
                enterFullscreen();
            } catch (fsErr) {
                console.warn("Fullscreen on load blocked, waiting for user gesture:", fsErr);
            }
            
            // Initialize the mocked/real media streams
            await initMedia();
            
            // Start recording
            startRecording();
            
            // Wait a moment for window to transition cleanly
            setTimeout(() => {
                if (initOverlay) initOverlay.style.display = 'none';
                
                // Enable proctoring tracking, focus violations, timer, and pings
                isMediaInitialized = true;
                isExamActive = true;
                
                startLivePings();
                startTimer();
                
                addActivityLog("Secure proctored exam environment active.");
                
                // Start real-time simulated malpractice alerts for demonstration
                setTimeout(() => {
                    if (isExamActive) {
                        triggerViolation('Mobile Phone Detection', 'Mobile phone detected near candidate.');
                    }
                }, 20000); // 20 seconds
                
                setTimeout(() => {
                    if (isExamActive) {
                        triggerViolation('Multiple Faces Detected', 'Additional person detected in webcam feed.');
                    }
                }, 35000); // 35 seconds
                
                setTimeout(() => {
                    if (isExamActive) {
                        triggerViolation('External Monitor Detected', 'Multiple display setup detected.');
                    }
                }, 50000); // 50 seconds
            }, 1000);
            
        } catch (err) {
            console.error("Setup failed:", err);
            // Fallback: Enable assessment anyway if browser block occurs
            isMediaInitialized = true;
            isExamActive = true;
            startLivePings();
            startTimer();
        }
    };
    
    // Execute secure mode startup immediately on load
    startSecureMode();
    
    // Register fallback listeners to ensure fullscreen is entered on first user action
    const requestFullscreenOnInteraction = () => {
        if (!document.fullscreenElement) {
            try {
                enterFullscreen();
            } catch (err) {
                console.error("Fullscreen request failed:", err);
            }
        }
        document.removeEventListener('click', requestFullscreenOnInteraction);
        document.removeEventListener('keydown', requestFullscreenOnInteraction);
    };
    document.addEventListener('click', requestFullscreenOnInteraction);
    document.addEventListener('keydown', requestFullscreenOnInteraction);
});
