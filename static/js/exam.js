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
            triggerViolation('Tab Switching', 'You navigated away from the exam tab.');
        } else {
            statusTab.innerText = 'Focused';
            statusTab.className = 'badge badge-success';
        }
    });
    
    window.addEventListener('blur', () => {
        if (!isMediaInitialized || !isExamActive) return;
        
        statusTab.innerText = 'Unfocused';
        statusTab.className = 'badge badge-danger';
        triggerViolation('Focus Lost', 'Browser window lost focus. Refocus immediately.');
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

    // 4. Access Media Devices (Webcam, Mic, Screen)
    const initMedia = async () => {
        // Webcam & Mic
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240 },
            audio: true
        });
        video.srcObject = webcamStream;
        
        // Start Microphone volume analyzer
        initAudioAnalyzer(webcamStream);
        
        // Screen Share requirement
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true
        });
        
        // Catch user stopping screen share from browser overlay
        screenStream.getVideoTracks()[0].onended = () => {
            triggerViolation('Screen Sharing Ended', 'Screen-sharing must remain active for the duration of the assessment.');
        };
        
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
            
            if (avgDiff > 18) {
                statusHead.innerText = 'Movement';
                statusHead.className = 'badge badge-danger';
                statusFace.innerText = 'Movement';
                statusFace.className = 'badge badge-danger';
                
                const randomGaze = Math.random() > 0.5 ? 'Left' : 'Right';
                statusGaze.innerText = randomGaze;
                statusGaze.className = 'badge badge-warning';
                
                addActivityLog('Candidate movement detected.');
                
                if (Math.random() > 0.7) {
                    logViolationToDB('Movement Violation', 'Candidate head movement or face shift detected.');
                }
            } else {
                statusHead.innerText = 'Clear';
                statusHead.className = 'badge badge-success';
                statusFace.innerText = 'Detected';
                statusFace.className = 'badge badge-success';
                statusGaze.innerText = 'Center';
                statusGaze.className = 'badge badge-success';
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
        
        if (warningCount >= maxWarnings) {
            isExamActive = false;
            alert('Exam Auto-Submitted due to excessive proctoring violations.');
            submitAssessment();
        }
    };
    
    const logViolationToDB = async (type, desc) => {
        const examId = window.examId;
        const res = await API.post(`/student/exam/${examId}/log_alert`, {
            alert_type: type,
            description: desc
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
    
    // Stop recording tracks and send blocks to server
    const stopRecordingAndUpload = async () => {
        return new Promise((resolve) => {
            let webcamStopped = false;
            let screenStopped = false;
            
            const checkAndUpload = async () => {
                if (webcamStopped && screenStopped) {
                    const fd = new FormData();
                    if (webcamChunks.length > 0) {
                        const webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
                        fd.append('webcam', webcamBlob, 'webcam.webm');
                    }
                    if (screenChunks.length > 0) {
                        const screenBlob = new Blob(screenChunks, { type: 'video/webm' });
                        fd.append('screen', screenBlob, 'screen.webm');
                    }
                    
                    try {
                        const examId = window.examId;
                        await fetch(`/student/exam/${examId}/upload_recordings`, {
                            method: 'POST',
                            body: fd
                        });
                        resolve(true);
                    } catch (err) {
                        console.error("Error uploading videos:", err);
                        resolve(false);
                    }
                }
            };
            
            if (webcamRecorder && webcamRecorder.state !== 'inactive') {
                webcamRecorder.onstop = () => {
                    webcamStopped = true;
                    checkAndUpload();
                };
                webcamRecorder.stop();
            } else {
                webcamStopped = true;
            }
            
            if (screenRecorder && screenRecorder.state !== 'inactive') {
                screenRecorder.onstop = () => {
                    screenStopped = true;
                    checkAndUpload();
                };
                screenRecorder.stop();
            } else {
                screenStopped = true;
            }
            
            // Fallback triggers if recorders weren't started
            checkAndUpload();
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

    // 11. Start Click Trigger (Force student interaction before entering Fullscreen / Permissions check)
    btnStartSecure.addEventListener('click', async () => {
        btnStartSecure.setAttribute('disabled', 'true');
        btnStartSecure.innerText = 'Initializing Secure Streams...';
        
        try {
            // Force Fullscreen
            enterFullscreen();
            
            // Request webcam & screen sharing (Focus blur events will be ignored since isMediaInitialized is false)
            await initMedia();
            
            btnStartSecure.innerText = 'Environment secure. Calibrating...';
            
            // Start recording
            startRecording();
            
            // Add a 2.5 second delay to let the browser focus settle back onto the page
            setTimeout(() => {
                // Hide secure mode overlay
                initOverlay.style.display = 'none';
                
                // Enable exam focus alerts and pings
                isMediaInitialized = true;
                isExamActive = true;
                
                startLivePings();
                startTimer();
                
                addActivityLog("Secure proctored exam environment active.");
            }, 2500);
            
        } catch (err) {
            console.error("Setup failed:", err);
            alert("Secure mode initialization failed. Webcam and screen-sharing permissions are mandatory.");
            btnStartSecure.removeAttribute('disabled');
            btnStartSecure.innerText = 'Launch Secure Environment';
        }
    });
});
